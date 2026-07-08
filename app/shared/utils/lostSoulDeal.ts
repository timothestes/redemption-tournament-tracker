/**
 * Pure geometry + arrival-diff helpers for the Lost Soul "deal" animation.
 * No React / Konva / Next imports — safe to unit-test in isolation.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DealFlight {
  /** Center point the flyer starts at (deck center). */
  from: Point;
  /** Center point the flyer lands at (LOB slot center). */
  to: Point;
  startScale: number;
  endScale: number;
  /** Stagger delay before this flyer starts moving. */
  delayMs: number;
}

/** Stagger between souls dealt in the same batch. */
export const STAGGER_MS = 100;
/** Flyer scale as it leaves the deck; grows to 1 on landing. */
export const START_SCALE = 0.72;

/** IDs present in `currentIds` that were not in `prevIds`, in input order. */
export function diffNewArrivals(prevIds: Set<string>, currentIds: string[]): string[] {
  return currentIds.filter((id) => !prevIds.has(id));
}

/**
 * Build a flight from a deck rect to an LOB slot. `slot` is the top-left of the
 * slot (as returned by the LOB layout's `hostPositions`); the flyer is
 * center-anchored, so we convert both endpoints to centers here.
 */
export function computeDealFlight(params: {
  deck: Rect;
  slot: Point;
  cardWidth: number;
  cardHeight: number;
  seq: number;
  staggerMs?: number;
  startScale?: number;
}): DealFlight {
  const staggerMs = params.staggerMs ?? STAGGER_MS;
  const startScale = params.startScale ?? START_SCALE;
  return {
    from: {
      x: params.deck.x + params.deck.width / 2,
      y: params.deck.y + params.deck.height / 2,
    },
    to: {
      x: params.slot.x + params.cardWidth / 2,
      y: params.slot.y + params.cardHeight / 2,
    },
    startScale,
    endScale: 1,
    delayMs: params.seq * staggerMs,
  };
}
