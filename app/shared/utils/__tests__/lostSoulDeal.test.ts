import { describe, it, expect } from 'vitest';
import {
  diffNewArrivals,
  computeDealFlight,
  STAGGER_MS,
  START_SCALE,
} from '../lostSoulDeal';

describe('diffNewArrivals', () => {
  it('returns ids present now but not before', () => {
    const prev = new Set(['a', 'b']);
    expect(diffNewArrivals(prev, ['a', 'b', 'c'])).toEqual(['c']);
  });

  it('returns empty when nothing is new', () => {
    const prev = new Set(['a', 'b']);
    expect(diffNewArrivals(prev, ['a', 'b'])).toEqual([]);
  });

  it('returns all when prev is empty', () => {
    expect(diffNewArrivals(new Set(), ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('preserves input order of new ids', () => {
    expect(diffNewArrivals(new Set(['x']), ['x', 'c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });
});

describe('computeDealFlight', () => {
  const deck = { x: 0, y: 0, width: 100, height: 140 };
  const slot = { x: 500, y: 300 };
  const cardWidth = 80;
  const cardHeight = 112;

  it('starts at the deck center', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.from).toEqual({ x: 50, y: 70 });
  });

  it('ends at the slot center (slot top-left + half card)', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.to).toEqual({ x: 540, y: 356 });
  });

  it('applies stagger by seq using the default interval', () => {
    const f0 = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    const f2 = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 2 });
    expect(f0.delayMs).toBe(0);
    expect(f2.delayMs).toBe(2 * STAGGER_MS);
  });

  it('uses default scales', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.startScale).toBe(START_SCALE);
    expect(f.endScale).toBe(1);
  });

  it('honors custom stagger and startScale', () => {
    const f = computeDealFlight({
      deck, slot, cardWidth, cardHeight, seq: 3, staggerMs: 50, startScale: 0.5,
    });
    expect(f.delayMs).toBe(150);
    expect(f.startScale).toBe(0.5);
  });
});
