import { describe, it, expect } from 'vitest';
import { buildJumpTargets } from '../jumpTargets';
import { calculateMultiplayerLayout } from '@/app/play/layout/multiplayerLayout';
import { fitRectToViewport, MIN_ZOOM } from '@/app/shared/layout/camera';
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

  it('includes battle when a band is active, framed with half a card of context', () => {
    const battleLayout = calculateMultiplayerLayout(VW, VIRTUAL_HEIGHT, 'T1', 'player', true);
    const band = battleLayout.zones.battle!;
    const rect = buildJumpTargets(battleLayout, VW, true).find((x) => x.id === 'battle')!.rect!;
    // A height-fit of the bare band clipped the flanking cards at the frame
    // edges — the jump rect extends ~half a card above and below the band.
    const pad = battleLayout.mainCard.cardHeight / 2;
    expect(rect.x).toBe(band.x);
    expect(rect.width).toBe(band.width);
    expect(rect.y).toBeCloseTo(Math.max(0, band.y - pad), 6);
    expect(rect.y + rect.height).toBeCloseTo(Math.min(VIRTUAL_HEIGHT, band.y + band.height + pad), 6);
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
