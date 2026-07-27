import { describe, it, expect } from 'vitest';
import { statCards, countBy, sumQuantity } from '../deckStats';

interface Row {
  name: string;
  type: string;
  brigade: string;
  quantity: number;
  zone: 'main' | 'reserve' | 'maybeboard';
}

function row(name: string, zone: Row['zone'], overrides: Partial<Row> = {}): Row {
  return { name, type: 'Hero', brigade: 'Blue', quantity: 1, zone, ...overrides };
}

describe('statCards', () => {
  it('keeps main and reserve, drops maybeboard', () => {
    const cards = [row('A', 'main'), row('B', 'reserve'), row('C', 'maybeboard')];
    expect(statCards(cards).map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('returns an empty list for a maybeboard-only deck', () => {
    expect(statCards([row('A', 'maybeboard'), row('B', 'maybeboard')])).toEqual([]);
  });
});

describe('sumQuantity', () => {
  it('sums copies across main and reserve only', () => {
    const cards = [
      row('A', 'main', { quantity: 3 }),
      row('B', 'reserve', { quantity: 2 }),
      row('C', 'maybeboard', { quantity: 40 }),
    ];
    expect(sumQuantity(cards)).toBe(5);
  });
});

describe('countBy', () => {
  it('excludes maybeboard cards from single-key aggregation', () => {
    const cards = [
      row('A', 'main', { type: 'Hero', quantity: 2 }),
      row('B', 'reserve', { type: 'Hero', quantity: 1 }),
      row('C', 'maybeboard', { type: 'Hero', quantity: 9 }),
      row('D', 'maybeboard', { type: 'Evil Character', quantity: 5 }),
    ];
    expect(countBy(cards, (c) => c.type)).toEqual({ Hero: 3 });
  });

  it('counts a card once per key when the key function returns several', () => {
    const cards = [
      row('A', 'main', { brigade: 'Blue/Green', quantity: 2 }),
      row('B', 'maybeboard', { brigade: 'Red', quantity: 7 }),
    ];
    expect(countBy(cards, (c) => c.brigade.split('/'))).toEqual({ Blue: 2, Green: 2 });
  });

  it('skips cards whose key function returns null', () => {
    const cards = [row('A', 'main'), row('B', 'main', { brigade: '' })];
    expect(countBy(cards, (c) => c.brigade || null)).toEqual({ Blue: 1 });
  });

  it('returns an empty record when every card is on the maybeboard', () => {
    expect(countBy([row('A', 'maybeboard')], (c) => c.type)).toEqual({});
  });
});
