import { describe, it, expect } from 'vitest';
import { computeHandBrigades } from '../handBrigades';

const card = (overrides: {
  cardName?: string;
  brigade: string;
  alignment?: string;
  type?: string;
}) => ({
  cardName: overrides.cardName ?? 'Test Card',
  brigade: overrides.brigade,
  alignment: overrides.alignment ?? 'Good',
  type: overrides.type ?? 'Hero',
});

describe('computeHandBrigades', () => {
  it('returns zeros for an empty hand', () => {
    expect(computeHandBrigades([])).toEqual({ total: 0, good: 0, evil: 0, neutral: 0 });
  });

  it('counts a single good brigade', () => {
    expect(computeHandBrigades([card({ brigade: 'Red' })])).toEqual({
      total: 1,
      good: 1,
      evil: 0,
      neutral: 0,
    });
  });

  it('counts a single evil brigade', () => {
    expect(computeHandBrigades([card({ brigade: 'Black', alignment: 'Evil' })])).toEqual({
      total: 1,
      good: 0,
      evil: 1,
      neutral: 0,
    });
  });

  it('treats a dual-brigade card (Red/Blue) as 2 brigades', () => {
    expect(computeHandBrigades([card({ brigade: 'Red/Blue' })])).toEqual({
      total: 2,
      good: 2,
      evil: 0,
      neutral: 0,
    });
  });

  it('dedupes duplicate brigades across cards (Red/Blue + Red = 2)', () => {
    expect(
      computeHandBrigades([
        card({ brigade: 'Red/Blue' }),
        card({ brigade: 'Red' }),
      ]),
    ).toEqual({ total: 2, good: 2, evil: 0, neutral: 0 });
  });

  it('splits good vs evil correctly across a mixed hand', () => {
    expect(
      computeHandBrigades([
        card({ brigade: 'Red', alignment: 'Good' }),
        card({ brigade: 'Black', alignment: 'Evil' }),
        card({ brigade: 'Crimson', alignment: 'Evil' }),
      ]),
    ).toEqual({ total: 3, good: 1, evil: 2, neutral: 0 });
  });

  it('ignores cards with no brigade (Lost Souls, dominants without brigade)', () => {
    expect(
      computeHandBrigades([
        card({ brigade: '' }),
        card({ brigade: 'Red' }),
      ]),
    ).toEqual({ total: 1, good: 1, evil: 0, neutral: 0 });
  });

  it('normalizes alignment-aware Gold to Good Gold for Good alignment', () => {
    expect(
      computeHandBrigades([card({ brigade: 'Gold', alignment: 'Good' })]),
    ).toEqual({ total: 1, good: 1, evil: 0, neutral: 0 });
  });

  it('normalizes alignment-aware Gold to Evil Gold for Evil alignment', () => {
    expect(
      computeHandBrigades([card({ brigade: 'Gold', alignment: 'Evil' })]),
    ).toEqual({ total: 1, good: 0, evil: 1, neutral: 0 });
  });

  it('skips cards whose brigade fails to normalize (does not throw)', () => {
    expect(
      computeHandBrigades([
        card({ brigade: 'Nonsense', alignment: 'Good' }),
        card({ brigade: 'Red', alignment: 'Good' }),
      ]),
    ).toEqual({ total: 1, good: 1, evil: 0, neutral: 0 });
  });

  it('handles two-sided "Delivered" via the complex-brigade override', () => {
    // Delivered raw brigade string "Green/Teal Gold/Pale Green" can't be
    // parsed by the simple splitter; it needs the per-card override:
    // Green + Teal (good) + Evil Gold + Pale Green (evil) = 4 total.
    expect(
      computeHandBrigades([
        card({
          cardName: 'Delivered',
          brigade: 'Green/Teal Gold/Pale Green',
          alignment: 'Neutral',
        }),
      ]),
    ).toEqual({ total: 4, good: 2, evil: 2, neutral: 0 });
  });

  it('handles two-sided "Eternal Judgment" via the complex-brigade override', () => {
    // Without the override, "Green/White and Brown/Crimson" would drop the
    // post-"and" evil side (the simple splitter takes only the left side).
    expect(
      computeHandBrigades([
        card({
          cardName: 'Eternal Judgment',
          brigade: 'Green/White and Brown/Crimson',
          alignment: 'Neutral',
        }),
      ]),
    ).toEqual({ total: 4, good: 2, evil: 2, neutral: 0 });
  });

  it('routes a City brigade to neutral (Zion: Purple)', () => {
    expect(
      computeHandBrigades([
        card({ cardName: 'Zion', brigade: 'Purple', alignment: 'Neutral', type: 'City' }),
      ]),
    ).toEqual({ total: 1, good: 0, evil: 0, neutral: 1 });
  });

  it('routes a Site brigade to neutral', () => {
    expect(
      computeHandBrigades([
        card({ cardName: 'Generic Site', brigade: 'Clay', alignment: 'Neutral', type: 'Site' }),
      ]),
    ).toEqual({ total: 1, good: 0, evil: 0, neutral: 1 });
  });

  it('counts a shared brigade in both Good and Neutral, but only once in Total', () => {
    // Purple appears on both a Hero (Good) and on Zion (City/Neutral).
    // Total dedupes; Good and Neutral each get their own count.
    expect(
      computeHandBrigades([
        card({ cardName: 'Some Hero', brigade: 'Purple', alignment: 'Good', type: 'Hero' }),
        card({ cardName: 'Zion', brigade: 'Purple', alignment: 'Neutral', type: 'City' }),
      ]),
    ).toEqual({ total: 1, good: 1, evil: 0, neutral: 1 });
  });

  it('mixes Hero (Good), Evil Character, and City (Neutral) brigades', () => {
    expect(
      computeHandBrigades([
        card({ brigade: 'Red', alignment: 'Good', type: 'Hero' }),
        card({ brigade: 'Black', alignment: 'Evil', type: 'Evil Character' }),
        card({ cardName: 'Damascus (LoC)', brigade: 'Red', alignment: 'Neutral', type: 'City' }),
      ]),
    ).toEqual({ total: 2, good: 1, evil: 1, neutral: 1 });
  });
});
