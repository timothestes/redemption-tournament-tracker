import { describe, it, expect } from 'vitest';
import { planCard, listImportableSets, normalizeLedgerRow, type PlanContext, type LedgerRow } from './importSet';
import { CARDS } from '@/lib/cards/generated/cardData';

const rr2Card = CARDS.find(c => c.set === 'RR2')!; // any Roots 2 card

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return { aliasMap: new Map([['RR2', 'Roots 2']]), ledger: new Map(), existingHandles: new Set(), existingTitles: new Set(), ...overrides };
}

describe('planCard', () => {
  it('plans create for an unknown card', () => {
    const plan = planCard(rr2Card, ctx());
    expect(plan.plannedAction).toBe('create');
    expect(plan.cardKey).toBe(`${rr2Card.name}|${rr2Card.set}|${rr2Card.imgFile}`);
    expect(plan.title.endsWith('(Roots 2)')).toBe(true);
    expect(plan.warnings).not.toContain('no-price'); // suppressed at plan time
  });

  it('plans update when the ledger has a product id', () => {
    const key = `${rr2Card.name}|${rr2Card.set}|${rr2Card.imgFile}`;
    const row: LedgerRow = { card_key: key, set_code: 'RR2', shopify_product_id: 'gid://shopify/Product/9', shopify_variant_id: null, handle: 'x', status: 'created', media_attached: true, error: null };
    const plan = planCard(rr2Card, ctx({ ledger: new Map([[key, row]]) }));
    expect(plan.plannedAction).toBe('update');
  });

  it('plans skip-existing on handle collision with the store mirror', () => {
    const first = planCard(rr2Card, ctx());
    const plan = planCard(rr2Card, ctx({ existingHandles: new Set([first.handle]) }));
    expect(plan.plannedAction).toBe('skip-existing');
  });

  it('plans create (not update) when the ledger row is mock-poisoned', () => {
    const key = `${rr2Card.name}|${rr2Card.set}|${rr2Card.imgFile}`;
    const mockRow: LedgerRow = {
      card_key: key,
      set_code: 'RR2',
      shopify_product_id: 'gid://shopify/Product/mock-some-handle',
      shopify_variant_id: 'gid://shopify/ProductVariant/mock-some-handle',
      handle: 'some-handle',
      status: 'created',
      media_attached: true,
      error: null,
    };
    // Mirrors what buildPlanContext does: normalize every loaded ledger row.
    const ledger = new Map([[key, normalizeLedgerRow(mockRow)]]);
    const plan = planCard(rr2Card, ctx({ ledger }));
    expect(plan.plannedAction).toBe('create');
  });
});

describe('normalizeLedgerRow', () => {
  const realRow: LedgerRow = {
    card_key: 'x|RR2|y',
    set_code: 'RR2',
    shopify_product_id: 'gid://shopify/Product/123456',
    shopify_variant_id: 'gid://shopify/ProductVariant/654321',
    handle: 'x-roots-2',
    status: 'created',
    media_attached: true,
    error: null,
  };

  it('neutralizes a mock-poisoned row: clears ids and media_attached', () => {
    const mockRow: LedgerRow = { ...realRow, shopify_product_id: 'gid://shopify/Product/mock-x-roots-2', shopify_variant_id: 'gid://shopify/ProductVariant/mock-x-roots-2' };
    const result = normalizeLedgerRow(mockRow);
    expect(result.shopify_product_id).toBeNull();
    expect(result.shopify_variant_id).toBeNull();
    expect(result.media_attached).toBe(false);
    // Untouched fields survive.
    expect(result.card_key).toBe(mockRow.card_key);
    expect(result.handle).toBe(mockRow.handle);
    expect(result.status).toBe(mockRow.status);
  });

  it('leaves a real row untouched', () => {
    const result = normalizeLedgerRow(realRow);
    expect(result).toEqual(realRow);
  });

  it('leaves a row with a null product id untouched', () => {
    const row: LedgerRow = { ...realRow, shopify_product_id: null, shopify_variant_id: null };
    const result = normalizeLedgerRow(row);
    expect(result).toEqual(row);
  });
});

describe('listImportableSets', () => {
  it('includes RR2 with its official name and a plausible count', () => {
    const sets = listImportableSets();
    const rr2 = sets.find(s => s.code === 'RR2');
    expect(rr2).toBeDefined();
    expect(rr2!.name).toBe('Roots 2');
    expect(rr2!.count).toBeGreaterThan(200);
  });
});
