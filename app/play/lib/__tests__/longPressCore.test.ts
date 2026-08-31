import { describe, it, expect } from 'vitest';
import {
  beginPress, shouldCancelForMovement, shouldFireLongPress,
  LONG_PRESS_MS, LONG_PRESS_MOVE_TOLERANCE,
  TOUCH_DRAG_DISTANCE, LONG_PRESS_DISMISS_TRAVEL,
} from '../longPressCore';

describe('longPressCore', () => {
  it('starts a press with the origin recorded', () => {
    const s = beginPress(100, 200, 1000);
    expect(s.startX).toBe(100);
    expect(s.startY).toBe(200);
    expect(s.startedAt).toBe(1000);
    expect(s.firedLongPress).toBe(false);
  });

  it('does not fire before the threshold', () => {
    const s = beginPress(0, 0, 1000);
    expect(shouldFireLongPress(s, 1000 + LONG_PRESS_MS - 1)).toBe(false);
  });

  it('fires at the threshold', () => {
    const s = beginPress(0, 0, 1000);
    expect(shouldFireLongPress(s, 1000 + LONG_PRESS_MS)).toBe(true);
  });

  it('does not fire twice', () => {
    const s = { ...beginPress(0, 0, 1000), firedLongPress: true };
    expect(shouldFireLongPress(s, 9999)).toBe(false);
  });

  it('tolerates small movement', () => {
    const s = beginPress(100, 100, 1000);
    expect(shouldCancelForMovement(s, 100 + LONG_PRESS_MOVE_TOLERANCE - 1, 100)).toBe(false);
  });

  it('cancels once movement exceeds the tolerance - that is a drag', () => {
    const s = beginPress(100, 100, 1000);
    expect(shouldCancelForMovement(s, 100 + LONG_PRESS_MOVE_TOLERANCE + 1, 100)).toBe(true);
    expect(shouldCancelForMovement(s, 100, 100 + LONG_PRESS_MOVE_TOLERANCE + 1)).toBe(true);
  });

  it('measures movement radially, not per-axis', () => {
    const s = beginPress(0, 0, 1000);
    // 8,8 is 11.3 away - beyond a tolerance of 10 even though neither axis is
    expect(shouldCancelForMovement(s, 8, 8)).toBe(true);
  });
});

describe('touch drag arbitration', () => {
  it('needs more travel to start a drag than to cancel a long-press', () => {
    // Konva's 3px default sits INSIDE the tolerance, and Konva stops
    // delivering shape touchmove once a drag is live - so between 3px and 10px
    // the press was uncancellable and the menu opened mid-drag.
    expect(TOUCH_DRAG_DISTANCE).toBeGreaterThan(LONG_PRESS_MOVE_TOLERANCE);
  });

  it('only dismisses an open menu after clearly more travel than a drag start', () => {
    expect(LONG_PRESS_DISMISS_TRAVEL).toBeGreaterThan(TOUCH_DRAG_DISTANCE);
  });
});
