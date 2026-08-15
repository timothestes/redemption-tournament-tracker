import { describe, it, expect } from 'vitest';
import { CARDS } from '../lookup';
import { cardIdentityKey, identityKeyForName } from '../cardIdentity';
import mergeGroups from './fixtures/nationals2026MergeGroups.json';

const BY_NAME = new Map(CARDS.map((c) => [c.name, c]));

function keyOf(name: string): string {
  const card = BY_NAME.get(name);
  if (!card) throw new Error(`fixture references unknown card: ${name}`);
  return cardIdentityKey(card);
}

describe('cardIdentityKey — printings that must merge', () => {
  // Every Son of God is the same Dominant; the printings differ only in art and
  // verse, and one carries a "Manger" nickname in the name.
  it('merges all Son of God printings, nickname included', () => {
    const names = [
      'Son of God (J)',
      'Son of God [K]',
      'Son of God [Fundraiser]',
      'Son of God "Manger" (Promo)',
    ];
    expect(new Set(names.map(keyOf)).size).toBe(1);
  });

  // Storehouse [IR] carries errata the Promo text predates ("discard pile").
  // Errata applies to every printing, so ability text must not split the group.
  it('merges Storehouse printings across an errata text change', () => {
    expect(new Set(['Storehouse (Promo)', 'Storehouse [IR]'].map(keyOf)).size).toBe(1);
  });

  it('merges alternate-border reprints with their original', () => {
    expect(
      new Set(['The Second Coming', 'The Second Coming (CoW AB)'].map(keyOf)).size,
    ).toBe(1);
  });
});

describe('cardIdentityKey — cards that must stay apart', () => {
  // These share a base name but are genuinely different cards. Collapsing them
  // was the failure mode of a plain "strip the trailing group" rule: the
  // bracketed part is a brigade or a distinct design, not a print run.
  it.each([
    // Brigade split.
    ['The Depraved [Black]', 'The Depraved [Brown]'],
    // Same brigade and verse, unrelated abilities — a redesign, not a reprint.
    ['Captain of the Host [II]', 'Captain of the Host (Roots)'],
    ["David's Harp (Promo)", "David's Harp [K]"],
    // Same name and characteristics, different verse and ability.
    ['Servants of the King [Sky]', 'Servants of the King [River]'],
    ['Temple Guard (RoJ)', 'Temple Guard (GoC)'],
  ])('keeps %s separate from %s', (a, b) => {
    expect(keyOf(a)).not.toBe(keyOf(b));
  });

  it('keeps Lost Souls with different identifiers apart', () => {
    expect(keyOf('Lost Soul "Stubborn" [Daniel 9:6]')).not.toBe(
      keyOf('Lost Soul "Covenant Breakers" [Daniel 9:5]'),
    );
  });

  // A Lost Soul with no special ability is its own thing — multiples of those
  // are legal, so they must not fold into a named soul that shares a verse.
  it('keeps a vanilla Lost Soul apart from a named soul', () => {
    expect(keyOf('Lost Soul (Daniel 9:6) [Fundraiser]')).not.toBe(
      keyOf('Lost Soul "Stubborn" [Daniel 9:6]'),
    );
  });
});

describe('cardIdentityKey — regression against the 2026 Nationals merge sheet', () => {
  const resolvable = (mergeGroups as { label: string; printings: string[] }[]).filter(
    (g) => g.printings.length > 1,
  );

  it('has fixture coverage', () => {
    expect(resolvable.length).toBeGreaterThan(100);
  });

  // The direction that actually corrupts a frequency table: two cards the sheet
  // counted as separate rows collapsing into one. Exactly one such pair exists,
  // and it is the sheet that is wrong — "Cherubim (PoC)" and "Cherubim [RR2]"
  // are both Silver / Ezekiel 10:14 with the same "Topdeck all evil Dominants"
  // ability, differing only in how the band clause is worded. Naming it here
  // rather than loosening to a count means a *new* fusion still fails.
  it('fuses no rows from the sheet beyond the known Cherubim reprint', () => {
    const labelsByKey = new Map<string, Set<string>>();
    for (const group of mergeGroups as { label: string; printings: string[] }[]) {
      for (const printing of group.printings) {
        const key = keyOf(printing);
        const labels = labelsByKey.get(key) ?? new Set<string>();
        labels.add(group.label);
        labelsByKey.set(key, labels);
      }
    }
    const fused = [...labelsByKey.values()]
      .filter((labels) => labels.size > 1)
      .map((labels) => [...labels].sort());
    expect(fused).toEqual([['Cherubim', 'Cherubim [RR2]']]);
  });

  // The sheet's own grouping is hand-made and imperfect (it folded four
  // different Daniel 9 souls together), so this asserts a rate, not perfection.
  it('reproduces at least 90% of the sheet groups exactly', () => {
    const intact = resolvable.filter(
      (g) => new Set(g.printings.map(keyOf)).size === 1,
    );
    expect(intact.length / resolvable.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('identityKeyForName', () => {
  it('resolves a deck_cards row by name and set', () => {
    expect(identityKeyForName('Storehouse [IR]', 'IR')).toBe(keyOf('Storehouse (Promo)'));
  });

  // Forge cards and hand-typed lists are not in the public index. They must
  // still count as themselves rather than collapsing into one "unknown" row.
  it('falls back to the raw name for a card outside the index', () => {
    const a = identityKeyForName('Totally Not A Real Card', 'ZZZ');
    const b = identityKeyForName('Another Fake Card', 'ZZZ');
    expect(a).not.toBe(b);
    expect(a).toBeTruthy();
  });
});
