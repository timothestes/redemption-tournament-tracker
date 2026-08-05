import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { shopifyGraphQLMock } = vi.hoisted(() => ({ shopifyGraphQLMock: vi.fn() }));
vi.mock('./admin-write', () => ({ shopifyGraphQL: shopifyGraphQLMock }));

import {
  inventoryWritesEnabled, payloadFingerprint, idempotencyKey,
  getSingleLocationId, getInventoryItemIds, adjustAvailable, activateItem,
  isNotStockedError, isStaleCasError, changeIndexOf,
  type InventoryChange,
} from './inventory';

const CH = (item: string, delta: number, from: number | null): InventoryChange =>
  ({ inventoryItemId: item, delta, changeFromQuantity: from });

beforeEach(() => {
  shopifyGraphQLMock.mockReset();
  vi.stubEnv('YTG_INVENTORY_WRITES', '1');
  vi.stubEnv('SHOPIFY_WRITE_MOCK', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('write gating', () => {
  it('is disabled when YTG_INVENTORY_WRITES is not "1"', () => {
    vi.stubEnv('YTG_INVENTORY_WRITES', '');
    expect(inventoryWritesEnabled()).toBe(false);
  });
  it('is disabled when SHOPIFY_WRITE_MOCK=1 even with writes on', () => {
    vi.stubEnv('SHOPIFY_WRITE_MOCK', '1');
    expect(inventoryWritesEnabled()).toBe(false);
  });
  it('mutations short-circuit to fabricated mock success without calling Shopify', async () => {
    vi.stubEnv('YTG_INVENTORY_WRITES', '');
    const out = await adjustAvailable('tok', {
      idempotencyKey: 'sale:S:batch:0:abc', locationId: 'gid://shopify/Location/1',
      changes: [CH('gid://shopify/InventoryItem/1', -3, 10)],
    });
    expect(out).toEqual({ mock: true, userErrors: [] });
    const act = await activateItem('tok', {
      idempotencyKey: 'sale:S:activate:1', inventoryItemId: 'gid://shopify/InventoryItem/1',
      locationId: 'gid://shopify/Location/1',
    });
    expect(act).toEqual({ mock: true, userErrors: [] });
    expect(shopifyGraphQLMock).not.toHaveBeenCalled();
  });
  it('reads are never gated', async () => {
    vi.stubEnv('YTG_INVENTORY_WRITES', '');
    shopifyGraphQLMock.mockResolvedValue({
      locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'HQ', isActive: true }] },
    });
    expect(await getSingleLocationId('tok')).toBe('gid://shopify/Location/1');
    expect(shopifyGraphQLMock).toHaveBeenCalledTimes(1);
  });
});

describe('idempotency keys', () => {
  it('fingerprint is order-independent and payload-sensitive', () => {
    const a = [CH('i1', -2, 5), CH('i2', -1, 3)];
    const b = [CH('i2', -1, 3), CH('i1', -2, 5)];
    expect(payloadFingerprint(a)).toBe(payloadFingerprint(b));
    expect(payloadFingerprint([CH('i1', -2, 5)])).not.toBe(payloadFingerprint(a));
    expect(payloadFingerprint([CH('i1', -2, 6)])).not.toBe(payloadFingerprint([CH('i1', -2, 5)]));
  });
  it('key = spec base + 8-hex fingerprint', () => {
    const key = idempotencyKey('sale:S1:batch:0', [CH('i1', -2, 5)]);
    expect(key).toMatch(/^sale:S1:batch:0:[0-9a-f]{8}$/);
    expect(idempotencyKey('sale:S1:batch:0', [CH('i1', -2, 5)])).toBe(key); // deterministic
  });
});

describe('getSingleLocationId', () => {
  it('returns the single active location', async () => {
    shopifyGraphQLMock.mockResolvedValue({
      locations: { nodes: [
        { id: 'gid://shopify/Location/9', name: 'Old', isActive: false },
        { id: 'gid://shopify/Location/1', name: 'HQ', isActive: true },
      ] },
    });
    expect(await getSingleLocationId('tok')).toBe('gid://shopify/Location/1');
    expect(shopifyGraphQLMock.mock.calls[0][1]).toContain('locations(first: 5)');
  });
  it('throws loudly on zero or multiple active locations', async () => {
    shopifyGraphQLMock.mockResolvedValue({ locations: { nodes: [
      { id: 'a', name: 'A', isActive: true }, { id: 'b', name: 'B', isActive: true },
    ] } });
    await expect(getSingleLocationId('tok')).rejects.toThrow(/exactly one active/);
    shopifyGraphQLMock.mockResolvedValue({ locations: { nodes: [] } });
    await expect(getSingleLocationId('tok')).rejects.toThrow(/exactly one active/);
  });
});

describe('getInventoryItemIds', () => {
  it('maps variant gid → inventoryItem gid, skipping null nodes', async () => {
    shopifyGraphQLMock.mockResolvedValue({ nodes: [
      { id: 'gid://shopify/ProductVariant/1', inventoryItem: { id: 'gid://shopify/InventoryItem/11' } },
      null,
      { id: 'gid://shopify/ProductVariant/2', inventoryItem: null },
    ] });
    const map = await getInventoryItemIds('tok', ['gid://shopify/ProductVariant/1', 'gid://shopify/ProductVariant/2', 'gid://shopify/ProductVariant/3']);
    expect(map.get('gid://shopify/ProductVariant/1')).toBe('gid://shopify/InventoryItem/11');
    expect(map.size).toBe(1);
  });
  it('chunks at 250 ids per query', async () => {
    shopifyGraphQLMock.mockResolvedValue({ nodes: [] });
    await getInventoryItemIds('tok', Array.from({ length: 501 }, (_, i) => `gid://shopify/ProductVariant/${i}`));
    expect(shopifyGraphQLMock).toHaveBeenCalledTimes(3);
    expect((shopifyGraphQLMock.mock.calls[0][2] as { ids: string[] }).ids).toHaveLength(250);
    expect((shopifyGraphQLMock.mock.calls[2][2] as { ids: string[] }).ids).toHaveLength(1);
  });
});

describe('adjustAvailable mutation construction', () => {
  it('carries the @idempotent directive after the field args, CAS numbers, and explicit null opt-outs', async () => {
    shopifyGraphQLMock.mockResolvedValue({
      inventoryAdjustQuantities: { inventoryAdjustmentGroup: { reason: 'correction' }, userErrors: [] },
    });
    const out = await adjustAvailable('tok', {
      idempotencyKey: 'sale:S1:batch:0:deadbeef',
      locationId: 'gid://shopify/Location/1',
      changes: [CH('gid://shopify/InventoryItem/11', -3, 10), CH('gid://shopify/InventoryItem/12', -1, null)],
    });
    expect(out.mock).toBe(false);
    expect(out.userErrors).toEqual([]);
    const [, query, vars] = shopifyGraphQLMock.mock.calls[0];
    expect(query).toContain('inventoryAdjustQuantities(input: $input) @idempotent(key: $key)');
    expect(query).toContain('userErrors { field message code }');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = (vars as any).input;
    expect((vars as { key: string }).key).toBe('sale:S1:batch:0:deadbeef');
    expect(input.reason).toBe('correction');
    expect(input.name).toBe('available');
    expect(input.changes[0]).toEqual({
      inventoryItemId: 'gid://shopify/InventoryItem/11',
      locationId: 'gid://shopify/Location/1', delta: -3, changeFromQuantity: 10,
    });
    // 2026-04: changeFromQuantity must be PRESENT even when opting out (explicit null)
    expect(Object.prototype.hasOwnProperty.call(input.changes[1], 'changeFromQuantity')).toBe(true);
    expect(input.changes[1].changeFromQuantity).toBeNull();
  });
  it('returns userErrors verbatim', async () => {
    shopifyGraphQLMock.mockResolvedValue({
      inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [
        { field: ['input', 'changes', '0', 'changeFromQuantity'], message: 'stale', code: 'CHANGE_FROM_QUANTITY_STALE' },
      ] },
    });
    const out = await adjustAvailable('tok', {
      idempotencyKey: 'k', locationId: 'l', changes: [CH('i', -1, 4)],
    });
    expect(out.userErrors[0].code).toBe('CHANGE_FROM_QUANTITY_STALE');
  });
});

describe('activateItem mutation construction', () => {
  it('activates with available: 0 and the @idempotent directive', async () => {
    shopifyGraphQLMock.mockResolvedValue({
      inventoryActivate: { inventoryLevel: { id: 'gid://shopify/InventoryLevel/1' }, userErrors: [] },
    });
    const out = await activateItem('tok', {
      idempotencyKey: 'sale:S1:activate:gid://shopify/InventoryItem/11',
      inventoryItemId: 'gid://shopify/InventoryItem/11', locationId: 'gid://shopify/Location/1',
    });
    expect(out.mock).toBe(false);
    const [, query, vars] = shopifyGraphQLMock.mock.calls[0];
    expect(query).toContain('inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $key)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((vars as any).available).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((vars as any).key).toBe('sale:S1:activate:gid://shopify/InventoryItem/11');
  });
});

describe('error classifiers', () => {
  it('isNotStockedError by code and by message', () => {
    expect(isNotStockedError({ field: null, message: 'x', code: 'ITEM_NOT_STOCKED_AT_LOCATION' })).toBe(true);
    expect(isNotStockedError({ field: null, message: 'The inventory item is not stocked at the location', code: null })).toBe(true);
    expect(isNotStockedError({ field: null, message: 'other', code: 'INVALID_REASON' })).toBe(false);
  });
  it('isStaleCasError by code and by message', () => {
    expect(isStaleCasError({ field: null, message: 'x', code: 'CHANGE_FROM_QUANTITY_STALE' })).toBe(true);
    expect(isStaleCasError({ field: null, message: 'The changeFromQuantity argument no longer matches', code: null })).toBe(true);
    expect(isStaleCasError({ field: null, message: 'other', code: null })).toBe(false);
  });
  it('changeIndexOf parses the numeric path segment', () => {
    expect(changeIndexOf({ field: ['input', 'changes', '3', 'delta'], message: '', code: null })).toBe(3);
    expect(changeIndexOf({ field: ['input', 'reason'], message: '', code: null })).toBeNull();
    expect(changeIndexOf({ field: null, message: '', code: null })).toBeNull();
  });
});
