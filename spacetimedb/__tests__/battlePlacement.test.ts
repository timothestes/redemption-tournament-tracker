import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it
// via the **/__tests__/** glob.
import {
  makeFreeSpotAllocator,
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
