import { describe, it, expect } from 'vitest';
import { planCard, listImportableSets, type PlanContext, type LedgerRow } from './importSet';
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
