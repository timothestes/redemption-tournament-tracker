/**
 * Long-press recognition, split from React so the timing and movement rules
 * are unit-testable.
 *
 * Arbitration with drag: a press that moves beyond the tolerance BEFORE the
 * threshold elapses is a drag, and the long-press is abandoned. A press that
 * survives the threshold without moving is a long-press, and the caller
 * cancels the pending Konva drag via node.stopDrag().
 */

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_MOVE_TOLERANCE = 10;

/**
 * Travel (px) a Konva drag needs before it starts, on touch.
 *
 * Konva's global default is 3px, which is INSIDE
 * LONG_PRESS_MOVE_TOLERANCE - and Konva stops delivering shape-level
 * touchmove once one of its drags is live, so between 3px and 10px the press
 * was uncancellable and the 500ms timer still fired: the menu opened in the
 * middle of a drag and the card snapped back. Requiring more travel than the
 * tolerance makes drag and long-press mutually exclusive by construction.
 */
export const TOUCH_DRAG_DISTANCE = LONG_PRESS_MOVE_TOLERANCE + 2;

/** Travel (px) after the menu has opened that means "I actually wanted to
 *  move this card" - the caller dismisses the menu it just opened. */
export const LONG_PRESS_DISMISS_TRAVEL = 24;

export interface PressState {
  startX: number;
  startY: number;
  startedAt: number;
  firedLongPress: boolean;
}

export function beginPress(x: number, y: number, now: number): PressState {
  return { startX: x, startY: y, startedAt: now, firedLongPress: false };
}

/** Radial distance, so a diagonal drag is not accidentally tolerated. */
export function shouldCancelForMovement(state: PressState, x: number, y: number): boolean {
  const dx = x - state.startX;
  const dy = y - state.startY;
  return Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE;
}

export function shouldFireLongPress(state: PressState, now: number): boolean {
  if (state.firedLongPress) return false;
  return now - state.startedAt >= LONG_PRESS_MS;
}
