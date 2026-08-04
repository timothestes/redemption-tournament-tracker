import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentStub: any;
vi.mock('../supabase-admin', () => ({ getSupabaseAdmin: () => currentStub }));

import { pass0Sku, cardSkuFromRow, runMatchingPipeline, writeResults } from '../matching';
import { cardSku } from '@/lib/shopify/productFromCard';
import { CARDS } from '@/lib/cards/lookup';
import { UNSOLD_SETS } from '../helpers';
import type { CardRow, ShopifyProductRow, MatchResult } from '../types';

function makeProduct(overrides: Partial<ShopifyProductRow>): ShopifyProductRow {
  return {
    id: 'p1', title: 'T', handle: 'h', tags: null, product_type: 'Single',
    price: 1, inventory_quantity: 0, raw_json: null, sku: null, body_html: null,
    last_synced_at: new Date().toISOString(), ...overrides,
  };
}
function makeCard(overrides: Partial<CardRow>): CardRow {
  return {
    name: 'N', set_code: 'S', img_file: 'N.jpg', official_set: '', type: '',
    brigade: '', rarity: '', special_ability: '', card_key: 'N|S|N.jpg', ...overrides,
  };
}
function bySkuMap(products: ShopifyProductRow[]): Map<string, ShopifyProductRow[]> {
  const m = new Map<string, ShopifyProductRow[]>();
  for (const p of products) {
    const s = (p.sku ?? '').trim();
    if (!s) continue;
    const list = m.get(s);
    if (list) list.push(p); else m.set(s, [p]);
  }
  return m;
}

/**
 * Minimal supabase stub covering every chain matching.ts uses:
 *  - from('set_aliases').select('*')                              (awaited select — thenable)
 *  - from('shopify_products').select('*').eq(...).range(...)      (loadShopifyProducts)
 *  - from('card_price_mappings').select(...).or(...).range(...)   (loadProtectedKeys)
 *  - from('card_price_mappings').select(...).in(...).range(...)   (writeResults manual refetch)
 *  - from('card_price_mappings').select(...).in(...).not(...).range(...)  (regenerateCardPrices → return [])
 *  - from('card_price_mappings').upsert(batch, opts)              (captured)
 */
function makeSupabaseStub(opts: {
  products: ShopifyProductRow[];
  mappings: { card_key: string; status: string; confidence?: number }[];
}) {
  const upserts: any[][] = [];
  function makeQuery(table: string) {
    const q: any = { _or: false, _in: null as null | { col: string; vals: string[] }, _not: false };
    const resolve = () => {
      if (table === 'set_aliases') return [];
      if (table === 'shopify_products') return opts.products;
      if (table === 'card_price_mappings') {
        if (q._not) return []; // regenerateCardPrices query → early "no confirmed mappings" return
        if (q._or) {
          return opts.mappings
            .filter(m => m.status === 'manual' || m.status === 'no_price_exists'
              || (m.status === 'auto_matched' && (m.confidence ?? 0) >= 0.95))
            .map(m => ({ card_key: m.card_key }));
        }
        if (q._in && q._in.col === 'status') {
          return opts.mappings.filter(m => q._in!.vals.includes(m.status)).map(m => ({ card_key: m.card_key }));
        }
        return [];
      }
      return [];
    };
    q.select = () => q;
    q.eq = () => q;
    q.or = () => { q._or = true; return q; };
    q.in = (col: string, vals: string[]) => { q._in = { col, vals }; return q; };
    q.not = () => { q._not = true; return q; };
    q.order = () => q;
    q.range = (from: number) => Promise.resolve({ data: from > 0 ? [] : resolve(), error: null });
    q.then = (onOk: any) => Promise.resolve({ data: resolve(), error: null }).then(onOk); // awaited-select support
    q.upsert = (batch: any[]) => { upserts.push(batch); return Promise.resolve({ error: null }); };
    q.update = () => ({ eq: () => Promise.resolve({ error: null }), not: () => Promise.resolve({ error: null }) });
    return q;
  }
  return { from: (t: string) => makeQuery(t), rpc: async () => ({ data: [], error: null }), __upserts: upserts };
}

// A real, deterministic, sellable card — pass 0 computes its sku from CARDS data.
const realCard = CARDS.find(c => !UNSOLD_SETS.has(c.set) && !/\bToken\b/.test(c.name))!;
const realKey = `${realCard.name}|${realCard.set}|${realCard.imgFile}`;
const realSku = cardSku(realCard);

describe('pass0Sku (unit)', () => {
  it('matches a card to the product carrying its cardSku: method sku, confidence 1.0, auto_matched', () => {
    const card = makeCard({ name: 'Aaron', set_code: 'RoA 3', img_file: 'Aaron.jpg', card_key: 'Aaron|RoA 3|Aaron.jpg' });
    // cardSku strips ALL whitespace: "RoA 3" → "RoA3-Aaron"
    expect(cardSkuFromRow(card)).toBe('RoA3-Aaron');
    const products = [makeProduct({ id: '111', sku: 'RoA3-Aaron' })];
    const results = pass0Sku([card], bySkuMap(products));
    expect(results).toEqual([{
      card_key: 'Aaron|RoA 3|Aaron.jpg', card_name: 'Aaron', set_code: 'RoA 3',
      shopify_product_id: '111', confidence: 1.0, match_method: 'sku', status: 'auto_matched',
    }]);
  });

  it('duplicate SKU (2+ products) → needs_review / sku_duplicate / confidence 0, never auto-picks', () => {
    const card = makeCard({ name: 'Eve', set_code: 'Pi', img_file: 'Eve.jpg', card_key: 'Eve|Pi|Eve.jpg' });
    const products = [makeProduct({ id: '222', sku: 'Pi-Eve' }), makeProduct({ id: '333', sku: 'Pi-Eve' })];
    const [r] = pass0Sku([card], bySkuMap(products));
    expect(r.status).toBe('needs_review');
    expect(r.match_method).toBe('sku_duplicate');
    expect(r.confidence).toBe(0);
    expect(r.shopify_product_id).toBe('222'); // deterministic: lowest id, a review suggestion only
  });

  it('no sku hit → no result (card falls through to later passes)', () => {
    const card = makeCard({});
    expect(pass0Sku([card], bySkuMap([makeProduct({ id: '1', sku: 'Other-Sku' })]))).toEqual([]);
  });
});

describe('runMatchingPipeline pass 0 wiring (stubbed supabase)', () => {
  beforeEach(() => { currentStub = null; });

  it('CORRECTION CASE: pass 0 re-matches a protected auto_matched(≥0.95) card to a different product', async () => {
    currentStub = makeSupabaseStub({
      products: [makeProduct({ id: 'NEW-PRODUCT', sku: realSku })],
      mappings: [{ card_key: realKey, status: 'auto_matched', confidence: 0.96 }], // in loadProtectedKeys' set
    });
    await runMatchingPipeline({ passes: [0], setCodes: [realCard.set] });
    const rows = currentStub.__upserts.flat();
    const row = rows.find((r: any) => r.card_key === realKey);
    expect(row).toBeDefined(); // protection-EXEMPT: pass 0 ran despite auto_matched ≥ 0.95
    expect(row.shopify_product_id).toBe('NEW-PRODUCT');
    expect(row.match_method).toBe('sku');
    expect(row.status).toBe('auto_matched');
  });

  it('MANUAL rows are never overwritten end-to-end (writeResults refetch-filter drops them)', async () => {
    currentStub = makeSupabaseStub({
      products: [makeProduct({ id: 'NEW-PRODUCT', sku: realSku })],
      mappings: [{ card_key: realKey, status: 'manual' }],
    });
    await runMatchingPipeline({ passes: [0], setCodes: [realCard.set] });
    const rows = currentStub.__upserts.flat();
    // pass 0 produced a result for the manual card (exemption), but writeResults filtered it
    expect(rows.find((r: any) => r.card_key === realKey)).toBeUndefined();
  });

  it('writeResults (direct): filters manual + no_price_exists keys, writes the rest', async () => {
    currentStub = makeSupabaseStub({
      products: [],
      mappings: [{ card_key: 'M|S|f', status: 'manual' }, { card_key: 'NP|S|f', status: 'no_price_exists' }],
    });
    const results: MatchResult[] = [
      { card_key: 'M|S|f', card_name: 'M', set_code: 'S', shopify_product_id: '1', confidence: 1, match_method: 'sku', status: 'auto_matched' },
      { card_key: 'NP|S|f', card_name: 'NP', set_code: 'S', shopify_product_id: '2', confidence: 1, match_method: 'sku', status: 'auto_matched' },
      { card_key: 'OK|S|f', card_name: 'OK', set_code: 'S', shopify_product_id: '3', confidence: 1, match_method: 'sku', status: 'auto_matched' },
    ];
    await writeResults(results);
    const rows = currentStub.__upserts.flat();
    expect(rows.map((r: any) => r.card_key)).toEqual(['OK|S|f']);
  });
});
