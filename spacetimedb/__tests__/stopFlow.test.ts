import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it
// via the **/__tests__/** glob.
import {
  TURN_PHASES,
  STOP_PHASES,
  gateBoundaryIndex,
  parseStops,
  serializeStops,
  toggleStop,
  firstStopInRange,
} from '../src/stopFlow';

describe('parseStops / serializeStops', () => {
  it('round-trips a csv', () => {
    expect(parseStops('upkeep,battle')).toEqual(['upkeep', 'battle']);
    expect(serializeStops(['upkeep', 'battle'])).toBe('upkeep,battle');
  });
  it('empty csv parses to empty list; empty list serializes to empty string', () => {
    expect(parseStops('')).toEqual([]);
    expect(serializeStops([])).toBe('');
  });
  it('drops unknown gates on parse (including the removed draw gate)', () => {
    expect(parseStops('upkeep,bogus,battle')).toEqual(['upkeep', 'battle']);
    expect(parseStops('draw,battle')).toEqual(['battle']); // rev-3 rows may carry 'draw'
  });
  it('serializes in canonical gate order and dedupes', () => {
    expect(serializeStops(['end', 'upkeep', 'end'])).toBe('upkeep,end');
  });
});

describe('toggleStop', () => {
  it('adds a gate', () => {
    expect(toggleStop('', 'battle', true)).toBe('battle');
    expect(toggleStop('upkeep', 'end', true)).toBe('upkeep,end');
  });
  it('removes a gate', () => {
    expect(toggleStop('upkeep,battle', 'upkeep', false)).toBe('battle');
  });
  it('is idempotent both ways', () => {
    expect(toggleStop('battle', 'battle', true)).toBe('battle');
    expect(toggleStop('', 'battle', false)).toBe('');
  });
});

describe('gateBoundaryIndex', () => {
  it('maps each gate to the boundary before its phase', () => {
    expect(gateBoundaryIndex('upkeep')).toBe(1);
    expect(gateBoundaryIndex('preparation')).toBe(2);
    expect(gateBoundaryIndex('battle')).toBe(3);
    expect(gateBoundaryIndex('discard')).toBe(4);
    expect(gateBoundaryIndex('end')).toBe(5); // between discard and the flip
  });
});

describe('firstStopInRange', () => {
  // TURN_PHASES indices: draw=0, upkeep=1, preparation=2, battle=3, discard=4.
  // Boundary b sits before TURN_PHASES[b]; b=5 is the 'end' boundary.
  it('finds the first armed gate, in order', () => {
    // draw→discard jump with gates on upkeep AND battle: upkeep wins (E1)
    expect(firstStopInRange(0, 4, 'upkeep,battle')).toBe('upkeep');
  });
  it('from is exclusive, to is inclusive', () => {
    expect(firstStopInRange(1, 3, 'upkeep')).toBeNull();   // upkeep boundary == from
    expect(firstStopInRange(1, 3, 'battle')).toBe('battle'); // battle boundary == to
  });
  it('one-shot: a tripped gate is simply absent from the csv', () => {
    expect(firstStopInRange(0, 4, 'battle')).toBe('battle');
    expect(firstStopInRange(0, 4, '')).toBeNull();
  });
  it('end-turn range (i, 5] catches the discard gate from battle, then end', () => {
    expect(firstStopInRange(3, 5, 'discard,end')).toBe('discard');
    expect(firstStopInRange(4, 5, 'end')).toBe('end');
  });
  it('there is no boundary before draw', () => {
    expect(firstStopInRange(-1, 0, 'upkeep,preparation,battle,discard,end')).toBeNull();
  });
  it('backward / empty ranges never match', () => {
    expect(firstStopInRange(3, 2, 'battle')).toBeNull();
    expect(firstStopInRange(2, 2, 'battle')).toBeNull();
  });
  it('clamps to the gate list length', () => {
    expect(firstStopInRange(3, 99, 'end')).toBe('end');
  });
  it('exports the canonical gate and phase orders', () => {
    expect([...STOP_PHASES]).toEqual(['upkeep', 'preparation', 'battle', 'discard', 'end']);
    expect([...TURN_PHASES]).toEqual(['draw', 'upkeep', 'preparation', 'battle', 'discard']);
  });
});
