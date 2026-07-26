/**
 * YTG Shopify set import orchestrator.
 *
 * Plans and executes bulk product creation/update for a single card set,
 * writing a ledger row (`shopify_card_imports`) per card so re-runs can
 * update rather than duplicate, then reconciles the store mirror + price
 * matcher so newly-created cards get prices in the deck builder.
 */

import type { CardData } from '@/lib/cards/generated/cardData';
import { CARDS } from '@/lib/cards/generated/cardData';
import { productFromCard, cardSku } from './productFromCard';
import { productSetUpsert } from './admin-write';
import { getShopifyAccessToken } from '@/lib/pricing/shopify';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { loadSetAliases, runMatchingPipeline, computeCheapestPrices } from '@/lib/pricing/matching';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { syncShopifyProducts } from '@/lib/pricing/syncShopifyProducts';

export interface CardPlan {
  cardKey: string;
  cardName: string;
  title: string;
  handle: string;
  sku: string;
  tags: string[];
  imageUrl: string | null; // '' from getCardImageUrl is normalized to null
  plannedAction: 'create' | 'update' | 'skip-existing';
  warnings: string[];
}

export interface LedgerRow {
  card_key: string;
  set_code: string;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  handle: string | null;
  status: string;
  media_attached: boolean;
  error: string | null;
}

export interface PlanContext {
  aliasMap: Map<string, string>;
  ledger: Map<string, LedgerRow>;
  existingHandles: Set<string>;
  existingTitles: Set<string>;
}

/** Pure: given a card and the current plan context, decide what would happen. */
export function planCard(card: CardData, ctx: PlanContext): CardPlan {
  const cardKey = `${card.name}|${card.set}|${card.imgFile}`;
  const imageUrl = getCardImageUrl(card.imgFile) || null;
  const alias = ctx.aliasMap.get(card.set) ?? null;

  const built = productFromCard(card, alias, {
    price: null,
    imageUrl,
    status: 'DRAFT',
  });

  const ledgerRow = ctx.ledger.get(cardKey);

  let plannedAction: CardPlan['plannedAction'];
  if (ledgerRow?.shopify_product_id) {
    plannedAction = 'update';
  } else if (ctx.existingHandles.has(built.input.handle) || ctx.existingTitles.has(built.input.title)) {
    plannedAction = 'skip-existing';
  } else {
    plannedAction = 'create';
  }

  return {
    cardKey,
    cardName: card.name,
    title: built.input.title,
    handle: built.input.handle,
    sku: cardSku(card),
    tags: built.input.tags,
    imageUrl,
    plannedAction,
    // Prices are entered by the admin later — the 'no-price' warning would
    // otherwise fire for every single card at plan time.
    warnings: built.warnings.filter((w) => w !== 'no-price'),
  };
}

async function loadExistingHandlesAndTitles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<{ existingHandles: Set<string>; existingTitles: Set<string> }> {
  const existingHandles = new Set<string>();
  const existingTitles = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('handle, title')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load shopify_products: ${error.message}`);

    for (const row of (data ?? []) as { handle: string | null; title: string | null }[]) {
      if (row.handle) existingHandles.add(row.handle);
      if (row.title) existingTitles.add(row.title);
    }

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return { existingHandles, existingTitles };
}

async function buildPlanContext(setCode: string): Promise<PlanContext> {
  const supabase = getSupabaseAdmin();

  const [aliasMap, ledgerResult, existing] = await Promise.all([
    loadSetAliases(),
    supabase.from('shopify_card_imports').select('*').eq('set_code', setCode),
    loadExistingHandlesAndTitles(supabase),
  ]);

  if (ledgerResult.error) {
    throw new Error(`Failed to load shopify_card_imports: ${ledgerResult.error.message}`);
  }

  const ledger = new Map<string, LedgerRow>();
  for (const row of (ledgerResult.data ?? []) as LedgerRow[]) {
    ledger.set(row.card_key, row);
  }

  return {
    aliasMap,
    ledger,
    existingHandles: existing.existingHandles,
    existingTitles: existing.existingTitles,
  };
}

export async function planSetImport(setCode: string): Promise<CardPlan[]> {
  const cards = CARDS.filter((c) => c.set === setCode);
  const ctx = await buildPlanContext(setCode);
  return cards.map((c) => planCard(c, ctx));
}

/** Distinct card.set values with their official set name and card count, sorted by name. */
export function listImportableSets(): { code: string; name: string; count: number }[] {
  const bySet = new Map<string, { code: string; name: string; count: number }>();
  for (const card of CARDS) {
    const existing = bySet.get(card.set);
    if (existing) {
      existing.count++;
    } else {
      bySet.set(card.set, { code: card.set, name: card.officialSet, count: 1 });
    }
  }
  return Array.from(bySet.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface ImportCardSpec {
  cardKey: string;
  price: string | null;
  include: boolean;
  titleOverride?: string;
}

export interface ImportRequest {
  setCode: string;
  status: 'DRAFT' | 'ACTIVE';
  cards: ImportCardSpec[];
}

export interface ImportResultRow {
  cardKey: string;
  action: 'created' | 'updated' | 'skipped' | 'error';
  productId: string | null;
  error: string | null;
  mock: boolean;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  reconciled: boolean;
  mock: boolean;
}

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

async function upsertLedgerRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: LedgerRow,
): Promise<void> {
  const { error } = await supabase
    .from('shopify_card_imports')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'card_key' });
  if (error) {
    console.error(`Ledger upsert failed for ${row.card_key}:`, error.message);
  }
}

export async function executeImport(
  req: ImportRequest,
): Promise<{ results: ImportResultRow[]; summary: ImportSummary }> {
  const ctx = await buildPlanContext(req.setCode);
  const supabase = getSupabaseAdmin();

  const cardByKey = new Map<string, CardData>();
  for (const c of CARDS) {
    cardByKey.set(`${c.name}|${c.set}|${c.imgFile}`, c);
  }

  const isMock = process.env.SHOPIFY_WRITE_MOCK === '1';
  const token = isMock ? 'mock' : await getShopifyAccessToken();

  const results: ImportResultRow[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const spec of req.cards) {
    if (!spec.include) continue;

    const card = cardByKey.get(spec.cardKey);
    if (!card) {
      results.push({ cardKey: spec.cardKey, action: 'error', productId: null, error: 'unknown card_key', mock: isMock });
      errors++;
      continue;
    }

    const ledgerRow = ctx.ledger.get(spec.cardKey) ?? null;

    try {
      const plan = planCard(card, ctx);

      if (plan.plannedAction === 'skip-existing') {
        results.push({ cardKey: spec.cardKey, action: 'skipped', productId: null, error: null, mock: isMock });
        await upsertLedgerRow(supabase, {
          card_key: spec.cardKey,
          set_code: req.setCode,
          shopify_product_id: null,
          shopify_variant_id: null,
          handle: plan.handle,
          status: 'skipped',
          media_attached: false,
          error: null,
        });
        skipped++;
        continue;
      }

      let price: string | null = null;
      if (spec.price !== null) {
        const trimmed = spec.price.trim();
        if (!PRICE_RE.test(trimmed)) {
          results.push({ cardKey: spec.cardKey, action: 'error', productId: null, error: 'invalid price', mock: isMock });
          await upsertLedgerRow(supabase, {
            card_key: spec.cardKey,
            set_code: req.setCode,
            shopify_product_id: ledgerRow?.shopify_product_id ?? null,
            shopify_variant_id: ledgerRow?.shopify_variant_id ?? null,
            handle: ledgerRow?.handle ?? null,
            status: 'error',
            media_attached: ledgerRow?.media_attached ?? false,
            error: 'invalid price',
          });
          errors++;
          continue;
        }
        price = Number(trimmed).toFixed(2);
      }

      const identifier = ledgerRow?.shopify_product_id ? { id: ledgerRow.shopify_product_id } : undefined;
      const includeMedia = !ledgerRow?.media_attached;
      const imageUrl = getCardImageUrl(card.imgFile) || null;
      const alias = ctx.aliasMap.get(card.set) ?? null;

      const built = productFromCard(card, alias, {
        price,
        imageUrl,
        status: req.status,
        titleOverride: spec.titleOverride,
        includeMedia,
      });
      const filesIncluded = built.input.files !== undefined;

      const outcome = await productSetUpsert(token, built.input, identifier);

      if (outcome.userErrors.length > 0) {
        const errorMsg = outcome.userErrors.map((e) => e.message).join('; ');
        results.push({ cardKey: spec.cardKey, action: 'error', productId: outcome.productId, error: errorMsg, mock: outcome.mock });
        await upsertLedgerRow(supabase, {
          card_key: spec.cardKey,
          set_code: req.setCode,
          shopify_product_id: outcome.productId,
          shopify_variant_id: outcome.variantId,
          handle: outcome.handle,
          status: 'error',
          media_attached: (ledgerRow?.media_attached ?? false) || filesIncluded,
          error: errorMsg,
        });
        errors++;
        continue;
      }

      const action: 'created' | 'updated' = identifier ? 'updated' : 'created';
      results.push({ cardKey: spec.cardKey, action, productId: outcome.productId, error: null, mock: outcome.mock });
      await upsertLedgerRow(supabase, {
        card_key: spec.cardKey,
        set_code: req.setCode,
        shopify_product_id: outcome.productId,
        shopify_variant_id: outcome.variantId,
        handle: outcome.handle,
        status: action,
        media_attached: (ledgerRow?.media_attached ?? false) || filesIncluded,
        error: null,
      });
      if (action === 'created') created++;
      else updated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ cardKey: spec.cardKey, action: 'error', productId: null, error: message, mock: isMock });
      await upsertLedgerRow(supabase, {
        card_key: spec.cardKey,
        set_code: req.setCode,
        shopify_product_id: ledgerRow?.shopify_product_id ?? null,
        shopify_variant_id: ledgerRow?.shopify_variant_id ?? null,
        handle: ledgerRow?.handle ?? null,
        status: 'error',
        media_attached: ledgerRow?.media_attached ?? false,
        error: message,
      });
      errors++;
    }
  }

  let reconciled = false;
  if (!isMock && (created > 0 || updated > 0)) {
    try {
      await syncShopifyProducts();
      await runMatchingPipeline({ setCodes: [req.setCode] });
      await computeCheapestPrices();
      reconciled = true;
    } catch (err) {
      console.error('Post-import reconcile failed:', err);
      reconciled = false;
    }
  }

  return {
    results,
    summary: { created, updated, skipped, errors, reconciled, mock: isMock },
  };
}
