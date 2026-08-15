import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it
// via the **/__tests__/** glob.
import {
  STOP_PHASES,
  parseStops,
  serializeStops,
  toggleStop,
  firstStopInRange,
} from '../src/stopFlow';

describe('parseStops / serializeStops', () => {
  it('round-trips a csv', () => {
    expect(parseStops('draw,battle')).toEqual(['draw', 'battle']);
    expect(serializeStops(['draw', 'battle'])).toBe('draw,battle');
  });
  it('empty csv parses to empty list; empty list serializes to empty string', () => {
    expect(parseStops('')).toEqual([]);
    expect(serializeStops([])).toBe('');
  });
  it('drops unknown phases on parse', () => {
    expect(parseStops('draw,bogus,battle')).toEqual(['draw', 'battle']);
  });
  it('serializes in canonical phase order and dedupes', () => {
    expect(serializeStops(['battle', 'draw', 'battle'])).toBe('draw,battle');
  });
});

describe('toggleStop', () => {
  it('adds a phase', () => {
    expect(toggleStop('', 'battle', true)).toBe('battle');
    expect(toggleStop('draw', 'battle', true)).toBe('draw,battle');
  });
  it('removes a phase', () => {
    expect(toggleStop('draw,battle', 'draw', false)).toBe('battle');
  });
  it('is idempotent both ways', () => {
    expect(toggleStop('battle', 'battle', true)).toBe('battle');
    expect(toggleStop('', 'battle', false)).toBe('');
  });
});

describe('firstStopInRange', () => {
  // PHASE indices: draw=0, upkeep=1, preparation=2, battle=3, discard=4
  it('finds the first qualifying stop, in order', () => {
    // draw→discard jump with stops on upkeep AND battle: upkeep wins (E1)
    expect(firstStopInRange(0, 4, 'upkeep,battle', '')).toBe('upkeep');
  });
  it('from is exclusive, to is inclusive', () => {
    expect(firstStopInRange(1, 3, 'upkeep', '')).toBeNull();   // upkeep == from
    expect(firstStopInRange(1, 3, 'battle', '')).toBe('battle'); // battle == to
  });
  it('fired phases are excluded', () => {
    expect(firstStopInRange(0, 4, 'upkeep,battle', 'upkeep')).toBe('battle');
    expect(firstStopInRange(0, 4, 'battle', 'battle')).toBeNull(); // E5
  });
  it('empty stops csv never matches', () => {
    expect(firstStopInRange(0, 4, '', '')).toBeNull();
  });
  it('end-turn range i+1..4 catches a discard stop from battle', () => {
    expect(firstStopInRange(3, 4, 'discard', '')).toBe('discard'); // E2/E15 range
  });
  it('turn-flip / finishPregame draw check uses (-1, 0)', () => {
    expect(firstStopInRange(-1, 0, 'draw', '')).toBe('draw');   // E3, §5.8
    expect(firstStopInRange(-1, 0, 'upkeep', '')).toBeNull();
  });
  it('clamps to the phase list length', () => {
    expect(firstStopInRange(3, 99, 'discard', '')).toBe('discard');
  });
  it('exports the canonical 5-phase order', () => {
    expect([...STOP_PHASES]).toEqual(['draw', 'upkeep', 'preparation', 'battle', 'discard']);
  });
});
