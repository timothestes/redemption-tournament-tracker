// Pure placement helper for the battle auto-return routine (index.ts,
// autoReturnBattleCards). Extracted so the occupancy-aware free-spot logic can
// be unit-tested without a full reducer harness (same split as playField.ts).
// No spacetimedb imports — safe to bundle into `spacetime publish`.

export interface Pos {
  x: number;
  y: number;
}

/**
 * Collision radius in normalized (0–1) Territory units — roughly one card
 * footprint; nearer than this two cards visibly overlap. Kept below the fan
 * grid's 0.04 column pitch so distinct grid cells never reject each other.
 */
export const BATTLE_PLACE_COLLISION_R = 0.035;

const CARDS_PER_ROW = 10;

/** The i-th cell of the auto-fan grid (reading order), in normalized units.
 *  Geometry is unchanged from the old blind fan (mirrors move_cards_batch's
 *  territory auto-fan ~2982-2992). */
function gridCell(i: number): Pos {
  const col = i % CARDS_PER_ROW;
  const row = Math.floor(i / CARDS_PER_ROW);
  return { x: 0.03 + col * 0.04 + row * 0.02, y: 0.05 + row * 0.28 };
}

function collides(a: Pos, taken: Pos[]): boolean {
  return taken.some(
    (p) =>
      Math.abs(p.x - a.x) < BATTLE_PLACE_COLLISION_R &&
      Math.abs(p.y - a.y) < BATTLE_PLACE_COLLISION_R,
  );
}

/**
 * Occupancy-aware auto-fan allocator for cards returning to an owner's
 * Territory when a battle closes. Seed it with the positions already occupied
 * there — cards that never entered the battle, plus the exact origin spots the
 * origin-Territory survivors will reclaim. Each call walks the fan grid from a
 * running counter, skips any cell that collides with an occupied point, and
 * records the spot it hands out so successive returns don't stack on each
 * other either. Replaces the old blind counter that dropped every non-origin
 * return onto the top-left corner regardless of what was already there.
 *
 * The scan is capped so a pathologically full board can't loop forever; past
 * the cap it falls back to the last raw grid cell tried.
 */
// ── Mass-band row (band_heroes_from_deck) ──────────────────────────────────
// Creation of the World drops a whole deck's worth of Genesis Heroes into the
// Field of Battle at once. Unlike the auto-return fan above, this lands in the
// 'battle' band — a strip barely taller than one card — so the group is a
// single horizontal row, packed tight against the RIGHT end of the band. The
// left portion stays clear rather than the arrivals spreading edge to edge and
// swamping the band.

/** Left-most anchor a banded Hero may take. */
export const BAND_LEFT_EDGE = 0.02;
/** Right-most anchor a banded Hero may take — one card width shy of the edge,
 *  so the card body stays inside the band. */
export const BAND_RIGHT_EDGE = 0.93;
/** Comfortable centre-to-centre spacing: one card width (~0.065 of the band's
 *  width at the reference layout) plus a hair of gap. */
export const BAND_PITCH = 0.075;
/** Vertical anchor for the row, in the activator's own coordinate frame. */
export const BAND_ROW_Y = 0.05;

/**
 * X anchors for `count` cards packed tight against the right end of the band,
 * in reading order (index 0 is left-most, the last index sits on
 * BAND_RIGHT_EDGE). Uses the comfortable pitch when the group fits and
 * compresses into an overlapping fan when it doesn't, so a 20-Hero band never
 * runs off the left edge.
 */
export function bandRowSlots(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [BAND_RIGHT_EDGE];
  const available = BAND_RIGHT_EDGE - BAND_LEFT_EDGE;
  const pitch = Math.min(BAND_PITCH, available / (count - 1));
  const startX = BAND_RIGHT_EDGE - (count - 1) * pitch;
  return Array.from({ length: count }, (_, i) => startX + i * pitch);
}

export function makeFreeSpotAllocator(occupied: Pos[] = []): () => Pos {
  const taken: Pos[] = [...occupied];
  let i = 0;
  return () => {
    let chosen: Pos | null = null;
    let last: Pos = gridCell(0);
    for (let tries = 0; tries < 200; tries++) {
      last = gridCell(i);
      i++;
      if (!collides(last, taken)) {
        chosen = last;
        break;
      }
    }
    const spot = chosen ?? last;
    taken.push(spot);
    return spot;
  };
}
