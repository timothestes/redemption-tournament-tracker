import { describe, it, expect } from 'vitest';
import { calculateMultiplayerLayout } from '../multiplayerLayout';

const VH = 1080;

describe('TOUCH_PROFILE', () => {
  it('produces larger cards than the default profile at the same size', () => {
    const normal  = calculateMultiplayerLayout(1440, VH, 'T1', 'player', false, false);
    const compact = calculateMultiplayerLayout(1440, VH, 'T1', 'player', false, true);
    expect(compact.mainCard.cardWidth).toBeGreaterThan(normal.mainCard.cardWidth);
  });

  it('gives more width to the play area by shrinking the sidebar', () => {
    const normal  = calculateMultiplayerLayout(1440, VH, 'T1', 'player', false, false);
    const compact = calculateMultiplayerLayout(1440, VH, 'T1', 'player', false, true);
    expect(compact.playAreaWidth).toBeGreaterThan(normal.playAreaWidth);
    expect(compact.sidebarWidth).toBeLessThan(normal.sidebarWidth);
  });

  it('keeps every zone inside the stage', () => {
    const l = calculateMultiplayerLayout(1440, VH, 'T1', 'player', false, true);
    for (const [key, r] of Object.entries(l.zones)) {
      if (!r) continue;
      expect(r.x, `${key}.x`).toBeGreaterThanOrEqual(0);
      expect(r.y, `${key}.y`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width,  `${key} right`).toBeLessThanOrEqual(1440 + 1);
      expect(r.y + r.height, `${key} bottom`).toBeLessThanOrEqual(VH + 1);
    }
  });

  it('leaves vertical room for a full card row in each territory', () => {
    const l = calculateMultiplayerLayout(1440, VH, 'T1', 'player', false, true);
    expect(l.zones.playerTerritory.height).toBeGreaterThanOrEqual(l.mainCard.cardHeight);
    expect(l.zones.opponentTerritory.height).toBeGreaterThanOrEqual(l.mainCard.cardHeight);
  });

  it('does not change the default profile', () => {
    const before = calculateMultiplayerLayout(1920, VH, 'T1', 'player', false);
    const after  = calculateMultiplayerLayout(1920, VH, 'T1', 'player', false, false);
    expect(after).toEqual(before);
  });

  it('reaches roughly 57px cards on an iPhone 14 Pro landscape', () => {
    // 852x393 viewport -> virtualWidth ~2341, fitScale ~0.364.
    // Physical width = containerWidth x (1 - sidebarRatio) x mainCardWidthRatio.
    const virtualWidth = 2341;
    const l = calculateMultiplayerLayout(virtualWidth, VH, 'T1', 'player', false, true);
    const fitScale = 393 / VH;
    const physicalCardWidth = l.mainCard.cardWidth * fitScale;
    expect(physicalCardWidth).toBeGreaterThan(50);
    expect(physicalCardWidth).toBeLessThan(70);
  });
});
