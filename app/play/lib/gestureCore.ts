/**
 * Pure gesture classification for the board camera. Kept separate from the
 * React/Konva wiring so the arbitration rules are unit-testable.
 */

export interface PointerSample {
  id: number;
  x: number;
  y: number;
}

export type GestureKind = 'none' | 'pan' | 'pinch';

/** One finger pans the camera; two or more pinch. A second finger arriving
 *  mid-drag promotes the interaction to a pinch - the caller cancels the card
 *  drag and restores the card when that happens. */
export function classifyGesture(pointers: PointerSample[]): GestureKind {
  if (pointers.length === 0) return 'none';
  if (pointers.length === 1) return 'pan';
  return 'pinch';
}

export function pinchMetrics(a: PointerSample, b: PointerSample) {
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  };
}

/** Multiplicative zoom factor for a pinch. Guards a zero start distance,
 *  which happens when both touches land on the same pixel. */
export function pinchZoomDelta(startDistance: number, currentDistance: number): number {
  if (startDistance <= 0) return 1;
  return currentDistance / startDistance;
}
