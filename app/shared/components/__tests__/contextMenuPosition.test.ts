import { describe, it, expect } from 'vitest';
import { anchorContextMenu } from '../contextMenuPosition';

/** Roughly the deck menu: 7 rows + 2 separators + padding. */
const MENU = { width: 200, height: 210 };
const MARGIN = 8;

describe('anchorContextMenu', () => {
  it('anchors at the cursor when the menu fits', () => {
    const pos = anchorContextMenu(400, 300, MENU, { width: 1512, height: 945 });
    expect(pos).toEqual({ left: 400, top: 300 });
  });

  it('tracks the cursor 1:1 across the deck pile on a short viewport', () => {
    // Regression: the deck pile spans clientY 475..564 on a 1440x780 window.
    // The old `Math.min(y, innerHeight - 300)` clamp pinned that entire band to
    // top 480 — a 2px spread over 89px of cursor travel. The bottom 2px still
    // clamp here (a 210px menu genuinely cannot fit below y=562 in a 780px
    // window), but the other 87px track the cursor exactly.
    const viewport = { width: 1440, height: 780 };
    const top = (y: number) => anchorContextMenu(950, y, MENU, viewport).top;
    expect(top(475)).toBe(475);
    expect(top(520)).toBe(520);
    expect(top(562)).toBe(562);
    expect(top(564)).toBe(562);
  });

  it('nudges up by only the overflow, not to a fixed line', () => {
    const pos = anchorContextMenu(400, 700, MENU, { width: 1440, height: 780 });
    expect(pos.top).toBe(780 - MENU.height - MARGIN);
  });

  it('flips left of the cursor when the menu would overflow the right edge', () => {
    const pos = anchorContextMenu(1380, 300, MENU, { width: 1440, height: 780 });
    expect(pos.left).toBe(1380 - MENU.width);
  });

  it('keeps the menu on screen when it is taller than the viewport', () => {
    const pos = anchorContextMenu(100, 200, { width: 200, height: 900 }, { width: 1440, height: 780 });
    expect(pos.top).toBe(MARGIN);
  });

  it('does not push the menu off the left edge when flipping', () => {
    const pos = anchorContextMenu(40, 300, { width: 200, height: 100 }, { width: 300, height: 780 });
    expect(pos.left).toBeGreaterThanOrEqual(MARGIN);
  });
});
