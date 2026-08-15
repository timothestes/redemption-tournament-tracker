import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it
// via the **/__tests__/** glob.
import {
  makeFreeSpotAllocator,
  bandRowSlots,
  BAND_LEFT_EDGE,
  BAND_RIGHT_EDGE,
  BAND_PITCH,
  BATTLE_PLACE_COLLISION_R,
  type Pos,
} from '../src/battlePlacement';

const overlaps = (a: Pos, b: Pos): boolean =>
  Math.abs(a.x - b.x) < BATTLE_PLACE_COLLISION_R &&
  Math.abs(a.y - b.y) < BATTLE_PLACE_COLLISION_R;

describe('makeFreeSpotAllocator (battle auto-return placement)', () => {
  it('hands out the top-left grid cell first on an empty board', () => {
    const alloc = makeFreeSpotAllocator([]);
    expect(alloc()).toEqual({ x: 0.03, y: 0.05 });
  });

  it('does not stack successive returns on top of each other', () => {
    const alloc = makeFreeSpotAllocator([]);
    const spots = Array.from({ length: 12 }, () => alloc());
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(overlaps(spots[i], spots[j])).toBe(false);
      }
    }
  });

  it('avoids a pre-existing territory card sitting in the top-left', () => {
    // A card that never entered the battle occupies the first grid cell.
    const existing: Pos = { x: 0.03, y: 0.05 };
    const alloc = makeFreeSpotAllocator([existing]);
    const spot = alloc();
    expect(overlaps(spot, existing)).toBe(false);
  });

  it('avoids the origin spots reclaimed by returning survivors', () => {
    // Survivors returned to a cluster of exact origin positions; a drafted
    // attacker fanning in must land clear of all of them.
    const reclaimed: Pos[] = [
      { x: 0.03, y: 0.05 },
      { x: 0.07, y: 0.05 },
      { x: 0.5, y: 0.4 },
    ];
    const alloc = makeFreeSpotAllocator(reclaimed);
    const spot = alloc();
    for (const r of reclaimed) expect(overlaps(spot, r)).toBe(false);
  });

  it('keeps every allocation clear of seed occupancy and of each other', () => {
    const seed: Pos[] = [
      { x: 0.03, y: 0.05 },
      { x: 0.11, y: 0.05 },
      { x: 0.5, y: 0.33 },
    ];
    const alloc = makeFreeSpotAllocator(seed);
    const handed: Pos[] = [];
    for (let n = 0; n < 8; n++) {
      const spot = alloc();
      for (const s of seed) expect(overlaps(spot, s)).toBe(false);
      for (const h of handed) expect(overlaps(spot, h)).toBe(false);
      handed.push(spot);
    }
  });

  it('returns positions inside the normalized 0-1 range for a modest count', () => {
    const alloc = makeFreeSpotAllocator([]);
    for (let n = 0; n < 10; n++) {
      const spot = alloc();
      expect(spot.x).toBeGreaterThanOrEqual(0);
      expect(spot.x).toBeLessThanOrEqual(1);
      expect(spot.y).toBeGreaterThanOrEqual(0);
      expect(spot.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('bandRowSlots (Creation of the World mass band)', () => {
  it('returns nothing for a non-positive count', () => {
    expect(bandRowSlots(0)).toEqual([]);
    expect(bandRowSlots(-3)).toEqual([]);
  });

  it('puts a lone Hero on the right edge', () => {
    expect(bandRowSlots(1)).toEqual([BAND_RIGHT_EDGE]);
  });

  it('packs right: the last card sits on the right edge, the rest run leftward', () => {
    const slots = bandRowSlots(6);
    expect(slots).toHaveLength(6);
    expect(slots[slots.length - 1]).toBeCloseTo(BAND_RIGHT_EDGE, 10);
    // Strictly increasing, so index 0 is left-most.
    for (let i = 1; i < slots.length; i++) expect(slots[i]).toBeGreaterThan(slots[i - 1]);
  });

  it('leaves the left portion of the band clear when the group fits', () => {
    // Six at the comfortable pitch spans 5 * 0.075 = 0.375, so well over half
    // the band stays empty — the whole point of packing right.
    const slots = bandRowSlots(6);
    expect(slots[0]).toBeCloseTo(BAND_RIGHT_EDGE - 5 * BAND_PITCH, 10);
    expect(slots[0]).toBeGreaterThan(0.5);
  });

  it('uses the comfortable pitch while the group fits', () => {
    const slots = bandRowSlots(8);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i] - slots[i - 1]).toBeCloseTo(BAND_PITCH, 10);
    }
  });

  it('compresses into an overlapping fan rather than running off the left edge', () => {
    // 20 Heroes at the full pitch would span 1.425 — far wider than the band.
    const slots = bandRowSlots(20);
    expect(slots[0]).toBeCloseTo(BAND_LEFT_EDGE, 10);
    expect(slots[slots.length - 1]).toBeCloseTo(BAND_RIGHT_EDGE, 10);
    const pitch = slots[1] - slots[0];
    expect(pitch).toBeLessThan(BAND_PITCH);
    expect(pitch).toBeGreaterThan(0);
  });

  it('keeps every slot inside the band for any plausible Genesis count', () => {
    // A 50-card deck can't hold more Genesis Heroes than this, but the geometry
    // must stay in range regardless of how many arrive.
    for (const n of [1, 2, 5, 12, 20, 40]) {
      for (const x of bandRowSlots(n)) {
        expect(x).toBeGreaterThanOrEqual(BAND_LEFT_EDGE - 1e-9);
        expect(x).toBeLessThanOrEqual(BAND_RIGHT_EDGE + 1e-9);
      }
    }
  });
});
