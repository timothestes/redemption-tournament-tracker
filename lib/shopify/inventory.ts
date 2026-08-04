/**
 * Shopify inventory client for WS-4 record-sale (GraphQL Admin 2026-07 via
 * shopifyGraphQL — THROTTLED retries inherited).
 *
 * 2026-04 breaking changes (overview §Global constraints) are load-bearing:
 * - every inventory mutation carries @idempotent(key:), placed after the
 *   field arguments, before the selection set (verified on shopify.dev);
 * - every InventoryChangeInput carries changeFromQuantity — the sale path
 *   always passes the live pre-quantity as a compare-and-swap anchor
 *   (explicit null opt-out exists in the type; never used by sales).
 *
 * Write gating (spec §Record sale prerequisite): mutations short-circuit to
 * fabricated success tagged { mock: true } unless YTG_INVENTORY_WRITES=1 AND
 * SHOPIFY_WRITE_MOCK≠1. Reads are never gated.
 */
import { shopifyGraphQL } from './admin-write';

export interface InventoryUserError {
  field: string[] | null;
  message: string;
  code: string | null;
}

export interface InventoryChange {
  inventoryItemId: string;           // gid://shopify/InventoryItem/…
  delta: number;
  changeFromQuantity: number | null; // null = CAS opt-out (sale path never opts out)
}

export interface AdjustOutcome {
  mock: boolean;
  userErrors: InventoryUserError[];
}

export function inventoryWritesEnabled(): boolean {
  return process.env.YTG_INVENTORY_WRITES === '1' && process.env.SHOPIFY_WRITE_MOCK !== '1';
}

/** FNV-1a 32-bit over the canonicalized change list — order-independent. */
export function payloadFingerprint(changes: InventoryChange[]): string {
  const canon = changes
    .map((c) => `${c.inventoryItemId}:${c.delta}:${c.changeFromQuantity}`)
    .sort()
    .join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Spec base key (`sale:<id>:batch:<n>` / `undo:<id>:batch:<n>`) + payload
 * fingerprint. Identical payload ⇒ identical key, so crash-resume and
 * two-tab races dedupe server-side (the spec's intent); a pruned/changed
 * payload ⇒ new key, which Shopify requires (reusing a key with different
 * parameters is IDEMPOTENCY_KEY_PARAMETER_MISMATCH).
 */
export function idempotencyKey(base: string, changes: InventoryChange[]): string {
  return `${base}:${payloadFingerprint(changes)}`;
}

const LOCATIONS_QUERY = `
query ytgLocations {
  locations(first: 5) {
    nodes { id name isActive }
  }
}
`;

/** Single-location assumption is asserted, never assumed (spec §API contract). */
export async function getSingleLocationId(token: string): Promise<string> {
  const data = await shopifyGraphQL<{
    locations: { nodes: { id: string; name: string; isActive: boolean }[] };
  }>(token, LOCATIONS_QUERY, {});
  const active = (data.locations?.nodes ?? []).filter((n) => n.isActive);
  if (active.length !== 1) {
    throw new Error(
      `expected exactly one active Shopify location, found ${active.length}`
      + ` (${active.map((n) => n.name).join(', ') || 'none'}) — refusing to guess`,
    );
  }
  return active[0].id;
}

const VARIANT_ITEMS_QUERY = `
query ytgVariantItems($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant { id inventoryItem { id } }
  }
}
`;

/** variant GID → inventoryItem GID, chunked ≤250 ids/query. Missing/null nodes are simply absent. */
export async function getInventoryItemIds(
  token: string,
  variantGids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < variantGids.length; i += 250) {
    const chunk = variantGids.slice(i, i + 250);
    const data = await shopifyGraphQL<{
      nodes: ({ id: string; inventoryItem: { id: string } | null } | null)[];
    }>(token, VARIANT_ITEMS_QUERY, { ids: chunk });
    for (const node of data.nodes ?? []) {
      if (node && node.inventoryItem) out.set(node.id, node.inventoryItem.id);
    }
  }
  return out;
}

// Pinned mutation strings — directive placement verified against shopify.dev
// (2026-07): after the field arguments, before the selection set.
export const ADJUST_MUTATION = `
mutation ytgInventoryAdjust($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { reason }
    userErrors { field message code }
  }
}
`;

export const ACTIVATE_MUTATION = `
mutation ytgInventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int, $key: String!) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $key) {
    inventoryLevel { id }
    userErrors { field message }
  }
}
`;

export async function adjustAvailable(
  token: string,
  args: { idempotencyKey: string; locationId: string; changes: InventoryChange[] },
): Promise<AdjustOutcome> {
  if (!inventoryWritesEnabled()) return { mock: true, userErrors: [] };
  const data = await shopifyGraphQL<{
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup: { reason: string } | null;
      userErrors: InventoryUserError[];
    };
  }>(token, ADJUST_MUTATION, {
    key: args.idempotencyKey,
    input: {
      reason: 'correction',
      name: 'available',
      changes: args.changes.map((c) => ({
        inventoryItemId: c.inventoryItemId,
        locationId: args.locationId,
        delta: c.delta,
        changeFromQuantity: c.changeFromQuantity,
      })),
    },
  });
  return { mock: false, userErrors: data.inventoryAdjustQuantities?.userErrors ?? [] };
}

/** ITEM_NOT_STOCKED_AT_LOCATION remedy — activate tracked-at-zero (spec §API contract). */
export async function activateItem(
  token: string,
  args: { idempotencyKey: string; inventoryItemId: string; locationId: string },
): Promise<AdjustOutcome> {
  if (!inventoryWritesEnabled()) return { mock: true, userErrors: [] };
  const data = await shopifyGraphQL<{
    inventoryActivate: {
      inventoryLevel: { id: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(token, ACTIVATE_MUTATION, {
    key: args.idempotencyKey,
    inventoryItemId: args.inventoryItemId,
    locationId: args.locationId,
    available: 0,
  });
  return {
    mock: false,
    userErrors: (data.inventoryActivate?.userErrors ?? []).map((e) => ({
      field: e.field, message: e.message, code: null,
    })),
  };
}

export function isNotStockedError(e: InventoryUserError): boolean {
  return e.code === 'ITEM_NOT_STOCKED_AT_LOCATION'
    || /not stocked at the location/i.test(e.message);
}

export function isStaleCasError(e: InventoryUserError): boolean {
  return e.code === 'CHANGE_FROM_QUANTITY_STALE'
    || /changeFromQuantity/i.test(e.message);
}

/** userError field path → change index (['input','changes','3',…] → 3), else null. */
export function changeIndexOf(e: InventoryUserError): number | null {
  for (const part of e.field ?? []) {
    if (/^\d+$/.test(part)) return Number(part);
  }
  return null;
}
