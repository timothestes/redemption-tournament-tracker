import { describe, it, expect } from 'vitest';
import { buildJumpTargets } from '../jumpTargets';
import { calculateMultiplayerLayout } from '@/app/play/layout/multiplayerLayout';
import { fitRectToViewport, MIN_ZOOM, MAX_ZOOM } from '@/app/shared/layout/camera';
import { calculateScale, VIRTUAL_HEIGHT } from '@/app/shared/layout/virtualCanvas';

// Real geometry, not a hand-built fixture, so the test tracks the real layout.
const VW = 1920;
const layout = calculateMultiplayerLayout(VW, VIRTUAL_HEIGHT, 'T1', 'player', false);

describe('buildJumpTargets', () => {
  it('always offers fit spanning the whole board, contain-fitted', () => {
    const fit = buildJumpTargets(layout, VW, false).find((t) => t.id === 'fit')!;
    expect(fit.rect).toEqual({ x: 0, y: 0, width: VW, height: VIRTUAL_HEIGHT });
    expect(fit.axis).toBe('both');
  });

  it('spans my whole side, not just my territory', () => {
    const mine = buildJumpTargets(layout, VW, false).find((t) => t.id === 'my-side')!.rect!;
    // must include my hand (the lowest zone) and reach the board bottom
    expect(mine.y + mine.height).toBeGreaterThanOrEqual(layout.zones.playerHand.y + layout.zones.playerHand.height);
    // must include the sidebar piles, so it reaches the right edge
    expect(mine.x + mine.width).toBeGreaterThan(layout.playAreaWidth);
    // and must start at or above my territory
    expect(mine.y).toBeLessThanOrEqual(layout.zones.playerTerritory.y);
  });

  it('spans the opponent whole side and starts at the top', () => {
    const opp = buildJumpTargets(layout, VW, false).find((t) => t.id === 'opponent-side')!.rect!;
    expect(opp.y).toBe(layout.zones.opponentHand.y);
    expect(opp.x + opp.width).toBeGreaterThan(layout.playAreaWidth);
  });

  it('keeps the two sides disjoint', () => {
    const t = buildJumpTargets(layout, VW, false);
    const mine = t.find((x) => x.id === 'my-side')!.rect!;
    const opp = t.find((x) => x.id === 'opponent-side')!.rect!;
    expect(opp.y + opp.height).toBeLessThanOrEqual(mine.y);
  });

  it('omits battle when no band is active', () => {
    expect(buildJumpTargets(layout, VW, false).some((t) => t.id === 'battle')).toBe(false);
  });

  it('includes battle when a band is active, framing the band centre with context', () => {
    const battleLayout = calculateMultiplayerLayout(VW, VIRTUAL_HEIGHT, 'T1', 'player', true);
    const band = battleLayout.zones.battle!;
    const target = buildJumpTargets(battleLayout, VW, true).find((x) => x.id === 'battle')!;
    const rect = target.rect!;
    // A height-fit of the bare band clipped the flanking cards at the frame
    // edges — the jump rect extends ~half a card above and below the band.
    const pad = battleLayout.mainCard.cardHeight / 2;
    // Horizontally the rect frames the band's CENTRE (six cards wide), not
    // its full width: a full-width height-fit on a narrow viewport zoomed
    // until the battle pair itself sat off-screen. Contain-fit ('both') lets
    // width bind on phones so the pair and its neighbours stay visible.
    const frameW = Math.min(band.width, battleLayout.mainCard.cardWidth * 6);
    expect(rect.width).toBeCloseTo(frameW, 6);
    expect(rect.x + rect.width / 2).toBeCloseTo(band.x + band.width / 2, 6);
    expect(target.axis).toBe('both');
    expect(target.anchorX).toBe('center');
    expect(rect.y).toBeCloseTo(Math.max(0, band.y - pad), 6);
    expect(rect.y + rect.height).toBeCloseTo(Math.min(VIRTUAL_HEIGHT, band.y + band.height + pad), 6);
  });

  it('portrait fit is a card-wide, full-height centred column that magnifies', () => {
    // Phone portrait behind "Continue anyway": the whole-board fit was a
    // ~25%-height microfilm strip, so portrait 'fit' becomes a card-wide
    // column height-fitted to the viewport.
    const cw = 393, ch = 852;
    const fit = calculateScale(cw, ch);
    const l = calculateMultiplayerLayout(fit.virtualWidth, VIRTUAL_HEIGHT, 'T1', 'player', false, true);
    const t = buildJumpTargets(l, fit.virtualWidth, false, true).find((x) => x.id === 'fit')!;
    expect(t.axis).toBe('height');
    expect(t.rect).toEqual({
      x: l.playAreaWidth / 2 - l.mainCard.cardWidth / 2,
      y: 0,
      width: l.mainCard.cardWidth,
      height: VIRTUAL_HEIGHT,
    });

    // It genuinely magnifies, within the zoom range (no MAX_ZOOM clipping)...
    const cam = fitRectToViewport(t.rect!, fit.scale, fit.virtualWidth, cw, ch, { axis: t.axis, insetTop: 48 });
    expect(cam.zoom).toBeGreaterThan(MIN_ZOOM);
    expect(cam.zoom).toBeLessThanOrEqual(MAX_ZOOM);

    // ...and the first interactive content (the opponent hand row — the
    // compact profile's top gutter sits above it) lands below the 48px
    // overlaid turn bar. The bare board EDGE may tuck ~1px under the bar via
    // the letterbox; the gutter is what keeps tappable content clear.
    const scale = fit.scale * cam.zoom;
    const handScreenY = ch / 2 + (l.zones.opponentHand.y - cam.centerY) * scale;
    expect(handScreenY).toBeGreaterThanOrEqual(48);
  });

  it('a 3-arg call (no portrait flag) keeps the whole-board landscape fit', () => {
    const fit = buildJumpTargets(layout, VW, false).find((t) => t.id === 'fit')!;
    expect(fit.axis).toBe('both');
    expect(fit.rect!.width).toBe(VW);
  });

  it('side targets actually zoom in on a phone viewport', () => {
    // The regression this guards: with axis 'both' every side jump was a no-op.
    const cw = 852, ch = 393;
    const fit = calculateScale(cw, ch);
    const phoneLayout = calculateMultiplayerLayout(fit.virtualWidth, VIRTUAL_HEIGHT, 'T1', 'player', false);

    for (const t of buildJumpTargets(phoneLayout, fit.virtualWidth, false)) {
      if (t.id === 'fit' || !t.rect) continue;
      const cam = fitRectToViewport(t.rect, fit.scale, fit.virtualWidth, cw, ch, { axis: t.axis });
      expect(cam.zoom, `${t.id} should zoom in`).toBeGreaterThan(MIN_ZOOM);
    }
  });
});
