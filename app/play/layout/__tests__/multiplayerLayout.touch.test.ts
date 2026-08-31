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

  it('keeps every interactive zone below the 48px overlay bar at fit', () => {
    // The touch shell overlays the turn bar (~48px) on the canvas. The top
    // gutter must push the opponent hand strip, opponent LoB, and opponent
    // sidebar piles fully below it, or souls in the opp LoB are untappable
    // at fit (elementFromPoint returns the bar) and rescues are impossible.
    const virtualWidth = 2341; // 852x393 phone -> fitScale = 393/1080
    const l = calculateMultiplayerLayout(virtualWidth, VH, 'T1', 'player', false, true);
    const fitScale = 393 / VH;
    expect(l.zones.opponentHand.y * fitScale).toBeGreaterThanOrEqual(48);
    expect(l.zones.opponentLob.y * fitScale).toBeGreaterThanOrEqual(48);
    for (const [key, r] of Object.entries(l.sidebar.opponent)) {
      expect(r!.y * fitScale, `opp sidebar ${key}`).toBeGreaterThanOrEqual(48);
    }
    // The gutter is reserved space, not lost space — rows still fill the stage.
    expect(l.zones.playerHand.y + l.zones.playerHand.height).toBe(VH);
  });

  it('gives Land of Bondage souls a real touch target on a landscape phone', () => {
    // Rescuing is the most-repeated touch action in the game and it happens in
    // this band. At oppLobRatio 0.085 with the default 0.85 band fill a soul
    // was 20x28 CSS px - about a third of the area of a 44px target.
    const virtualWidth = 2341;
    const l = calculateMultiplayerLayout(virtualWidth, VH, 'T1', 'player', false, true);
    const fitScale = 393 / VH;
    expect(l.lobCard.cardWidth * fitScale).toBeGreaterThan(36);
    expect(l.lobCard.cardHeight * fitScale).toBeGreaterThan(50);
  });

  it('keeps the soul overhang small enough not to swallow the next band', () => {
    // lobBandFillRatio > 1 deliberately overhangs the band. Half the excess
    // spills into the neighbouring band at each edge; it must stay a sliver.
    const virtualWidth = 2341;
    const l = calculateMultiplayerLayout(virtualWidth, VH, 'T1', 'player', false, true);
    const fitScale = 393 / VH;
    const overhangPx = ((l.lobCard.cardHeight - l.zones.playerLob.height) / 2) * fitScale;
    expect(overhangPx).toBeGreaterThan(0);
    expect(overhangPx).toBeLessThan(10);
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
