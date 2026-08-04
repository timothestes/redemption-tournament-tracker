import { describe, it, expect } from 'vitest';
import { planBackfillRows, skuFromCardKey } from './skuBackfill';
import type { BackfillMappingRow, BackfillProductLite } from './skuBackfill';

const product = (id: string, variantId: number | string | null = 900): BackfillProductLite => ({
  id, sku: null,
  raw_json: variantId == null ? { variants: [] } : { variants: [{ id: variantId }] },
});
const mapping = (over: Partial<BackfillMappingRow>): BackfillMappingRow => ({
  card_key: 'Aaron|Pi|Aaron.jpg', shopify_product_id: '1',
  confidence: 1, match_method: 'exact', status: 'auto_matched', ...over,
});

describe('skuFromCardKey', () => {
  it('computes cardSku from the key parts, stripping whitespace ("RoA 3" → "RoA3-")', () => {
    expect(skuFromCardKey('Aaron|RoA 3|Aaron.jpg')).toBe('RoA3-Aaron');
  });
  it('rejects malformed keys', () => {
    expect(skuFromCardKey('not-a-key')).toBe(null);
  });
});

describe('planBackfillRows', () => {
  it('builds gids and sku for a simple confirmed mapping', () => {
    const { toWrite, skippedPermanent, blocked } = planBackfillRows(
      [mapping({})], new Map([['1', product('1', 456)]]), new Map(),
    );
    expect(blocked).toEqual([]);
    expect(skippedPermanent).toEqual([]);
    expect(toWrite).toEqual([{
      productId: '1', productGid: 'gid://shopify/Product/1',
      variantGid: 'gid://shopify/ProductVariant/456',
      cardKey: 'Aaron|Pi|Aaron.jpg', sku: 'Pi-Aaron',
    }]);
  });

  it('multi-mapping product: exact beats normalized regardless of confidence; rest skippedPermanent', () => {
    const { toWrite, skippedPermanent } = planBackfillRows([
      mapping({ card_key: 'A|Pi|A.jpg', match_method: 'normalized', confidence: 0.99 }),
      mapping({ card_key: 'B|Pi|B.jpg', match_method: 'exact', confidence: 0.9 }),
      mapping({ card_key: 'C|Pi|C.jpg', match_method: 'promo_fallback', confidence: 1.0 }),
    ], new Map([['1', product('1')]]), new Map());
    expect(toWrite).toHaveLength(1);
    expect(toWrite[0].cardKey).toBe('B|Pi|B.jpg');
    expect(skippedPermanent.map(s => s.cardKey).sort()).toEqual(['A|Pi|A.jpg', 'C|Pi|C.jpg']);
    expect(skippedPermanent[0].reason).toContain('permanent by design');
  });

  it('ties on method rank break by highest confidence', () => {
    const { toWrite } = planBackfillRows([
      mapping({ card_key: 'A|Pi|A.jpg', match_method: 'normalized', confidence: 0.90 }),
      mapping({ card_key: 'B|Pi|B.jpg', match_method: 'normalized', confidence: 0.95 }),
    ], new Map([['1', product('1')]]), new Map());
    expect(toWrite[0].cardKey).toBe('B|Pi|B.jpg');
  });

  it('missing variant in raw_json → blocked with re-sync hint', () => {
    const { toWrite, blocked } = planBackfillRows([mapping({})], new Map([['1', product('1', null)]]), new Map());
    expect(toWrite).toEqual([]);
    expect(blocked[0].reason).toContain('re-sync');
  });

  it('target sku already owned by ANOTHER product → blocked (would manufacture duplicate SKU)', () => {
    const { toWrite, blocked } = planBackfillRows(
      [mapping({})], new Map([['1', product('1')]]), new Map([['Pi-Aaron', '999']]),
    );
    expect(toWrite).toEqual([]);
    expect(blocked[0].reason).toContain('999');
  });

  it('product missing from the mirror map is ignored (mapping references a ghost)', () => {
    const { toWrite, blocked } = planBackfillRows([mapping({})], new Map(), new Map());
    expect(toWrite).toEqual([]);
    expect(blocked).toEqual([]);
  });
});
