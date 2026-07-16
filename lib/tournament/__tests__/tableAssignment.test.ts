import { describe, it, expect } from 'vitest';
import { assignTables } from '../tableAssignment';
import type { NumberingMode } from '../types';

const m = (order: number, p1: string, p2: string) => ({
  matchOrder: order, player1Id: p1, player2Id: p2,
});
const opts = (start = 1, mode: NumberingMode = 'tables') => ({
  startingTableNumber: start, mode,
});
const tableOf = (r: ReturnType<typeof assignTables>, id: string) =>
  r.matches.find(x => x.player1Id === id || x.player2Id === id)!.tableNumber;

describe('assignTables — tables mode', () => {
  it('no pins → identity fill from startingTableNumber in rank order', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D'), m(3, 'E', 'F')], new Map(), opts(5));
    expect(r.matches.map(x => x.tableNumber)).toEqual([5, 6, 7]);
    expect(r.overriddenPins).toEqual([]);
  });

  it('single pin places that match at the pinned table; fill skips it', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D'), m(3, 'E', 'F')],
      new Map([['C', 2]]), opts(1));
    expect(tableOf(r, 'C')).toBe(2);
    expect(tableOf(r, 'A')).toBe(1);
    expect(tableOf(r, 'E')).toBe(3);
  });

  it('sparse pin beyond match count is honored', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')], new Map([['A', 50]]), opts(1));
    expect(tableOf(r, 'A')).toBe(50);
    expect(tableOf(r, 'C')).toBe(1);
  });

  it('pin below startingTableNumber is honored', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')], new Map([['C', 3]]), opts(5));
    expect(tableOf(r, 'C')).toBe(3);
    expect(tableOf(r, 'A')).toBe(5);
  });

  it('two pinned players in one match: lower value wins, other overridden', () => {
    const r = assignTables([m(1, 'A', 'B')], new Map([['A', 7], ['B', 4]]), opts(1));
    expect(r.matches[0].tableNumber).toBe(4);
    expect(r.overriddenPins).toEqual(['A']);
  });
});

describe('assignTables — seats mode', () => {
  it('even-seat pin maps to table ceil(s/2) and forces the player2 chair', () => {
    // B pinned to seat 10 → table 5, even → player2 slot (input has B as player1).
    const r = assignTables([m(1, 'B', 'A')], new Map([['B', 10]]), opts(1, 'seats'));
    expect(r.matches[0].tableNumber).toBe(5);
    expect(r.matches[0].player1Id).toBe('A');
    expect(r.matches[0].player2Id).toBe('B');
  });

  it('odd-seat pin keeps/forces the player1 chair', () => {
    const r = assignTables([m(1, 'A', 'B')], new Map([['A', 9]]), opts(1, 'seats'));
    expect(r.matches[0].tableNumber).toBe(5);
    expect(r.matches[0].player1Id).toBe('A');
  });

  it('seats 9+10 pinned and paired together: both honored, no override', () => {
    const r = assignTables([m(1, 'X', 'Y')], new Map([['X', 10], ['Y', 9]]), opts(1, 'seats'));
    expect(r.matches[0].tableNumber).toBe(5);
    expect(r.matches[0].player1Id).toBe('Y'); // seat 9 = odd chair
    expect(r.matches[0].player2Id).toBe('X');
    expect(r.overriddenPins).toEqual([]);
  });

  it('cross-match same-table claims: lower seat wins, other bumped + overridden', () => {
    // A pinned seat 9, C pinned seat 10 — both table 5, different matches.
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')],
      new Map([['A', 9], ['C', 10]]), opts(1, 'seats'));
    expect(tableOf(r, 'A')).toBe(5);
    expect(tableOf(r, 'C')).toBe(1); // bumped to normal fill
    expect(r.overriddenPins).toEqual(['C']);
  });
});

describe('assignTables — general', () => {
  it('pin of a player not in any match (bye/dropped) claims nothing', () => {
    const r = assignTables([m(1, 'A', 'B')], new Map([['Z', 1]]), opts(1));
    expect(r.matches[0].tableNumber).toBe(1);
  });

  it('deterministic: identical inputs → identical outputs', () => {
    const ms = [m(1, 'A', 'B'), m(2, 'C', 'D'), m(3, 'E', 'F')];
    const pins = new Map([['E', 2], ['B', 7]]);
    expect(assignTables(ms, pins, opts(1))).toEqual(assignTables(ms, pins, opts(1)));
  });

  it('returns matches in matchOrder order regardless of claims', () => {
    const r = assignTables([m(1, 'A', 'B'), m(2, 'C', 'D')], new Map([['C', 1]]), opts(1));
    expect(r.matches.map(x => x.matchOrder)).toEqual([1, 2]);
  });

  it('does not mutate its inputs', () => {
    const ms = [m(1, 'B', 'A')];
    const pins = new Map([['B', 10]]);
    assignTables(ms, pins, opts(1, 'seats'));
    expect(ms[0].player1Id).toBe('B'); // swap happened on a copy
  });
});
