/**
 * Camera jump targets.
 *
 * Deliberately "side", not "territory": what a player controls is spread
 * across their hand, territory, Land of Bondage and sidebar piles, so jumping
 * to territory alone would hide most of what the opponent controls.
 *
 * Side targets fit on the HEIGHT axis. A side spans the full board width, so
 * contain-fitting one could never zoom in (width binds at fit) and the jump
 * would be a silent no-op. See camera.ts FitOptions.
 */

import { unionRects, type Rect } from '@/app/shared/layout/camera';
import { VIRTUAL_HEIGHT } from '@/app/shared/layout/virtualCanvas';
import type { MultiplayerLayout } from '@/app/play/layout/multiplayerLayout';

export type JumpTargetId = 'fit' | 'opponent-side' | 'my-side' | 'battle';

export interface JumpTarget {
  id: JumpTargetId;
  label: string;
  rect: Rect | null;
  /** Which axis fitRectToViewport should use for this target. */
  axis: 'both' | 'height';
  /** Horizontal anchor when the height-fit viewport is narrower than the
   *  rect — see FitOptions.anchorX. Only the battle target centers. */
  anchorX?: 'left' | 'center';
}

function compact(rects: Array<Rect | undefined>): Rect[] {
  return rects.filter((r): r is Rect => !!r);
}

export function buildJumpTargets(
  layout: MultiplayerLayout,
  virtualWidth: number,
  battleActive: boolean,
  portrait = false,
  /** Where the battle cards actually stand (virtual x). Free-form drops can
   *  land anywhere along the band, so the battle frame centres on the cards
   *  themselves; without this a band-midline frame left an off-centre
   *  attacker outside the viewport on phones. */
  battleFocus?: { centerX: number; span: number },
): JumpTarget[] {
  const z = layout.zones;

  const mine = unionRects(compact([
    z.playerHand, z.playerTerritory, z.playerLob,
    ...Object.values(layout.sidebar.player),
  ]));

  const theirs = unionRects(compact([
    z.opponentHand, z.opponentTerritory, z.opponentLob,
    ...Object.values(layout.sidebar.opponent),
  ]));

  // Portrait (phone "Continue anyway"): a whole-board contain-fit inside a
  // 2.05:1 virtual aspect is a ~25%-height letterboxed strip with unreadable
  // cards. "Fit" becomes a card-wide, centred, full-height column instead —
  // height-fitted, so cards render at usable size and the jump cluster + pan
  // buttons make the rest reachable. fitRectToViewport's narrow-rect
  // centring keeps the hand fan on screen.
  const targets: JumpTarget[] = [
    {
      id: 'fit',
      label: 'Fit',
      rect: portrait
        ? {
            x: layout.playAreaWidth / 2 - layout.mainCard.cardWidth / 2,
            y: 0,
            width: layout.mainCard.cardWidth,
            height: VIRTUAL_HEIGHT,
          }
        : { x: 0, y: 0, width: virtualWidth, height: VIRTUAL_HEIGHT },
      axis: portrait ? 'height' : 'both',
    },
    { id: 'opponent-side', label: 'Theirs', rect: theirs, axis: 'height' },
    // 'center', unlike Theirs: the left-anchor exists for left-packed LoB
    // souls, which is what a player aims at on THEIR side (rescue targeting).
    // On MY side the thing a player reaches for is their own hand fan, which
    // is centred — left-anchoring parked the viewport on empty territory and
    // cut the fan's right half off-screen (phone QA, wave 8).
    { id: 'my-side', label: 'Mine', rect: mine, axis: 'height', anchorX: 'center' },
  ];

  if (battleActive && z.battle) {
    // Frame the band PLUS half a card of context above and below — a
    // height-fit of the bare band put its edges at the frame edges, clipping
    // the cards that flank it (band cards overhang, and the adjacent
    // territory rows are what a player references mid-battle).
    const contextPad = layout.mainCard.cardHeight / 2;
    const top = Math.max(0, z.battle.y - contextPad);
    const bottom = Math.min(VIRTUAL_HEIGHT, z.battle.y + z.battle.height + contextPad);
    // Horizontally, frame the band's CENTRE (where auto-arranged battle cards
    // and the totals chips live), not its full width, and contain-fit ('both')
    // rather than height-fit. A height-fit of the full-width band on a narrow
    // viewport zoomed until only the exact midline was visible — the battle
    // pair itself landed off-screen (phone QA, waves 3-8). Width binding on a
    // narrow screen also zooms out enough that the flanking territory rows
    // stay partly visible. anchorX 'center' is kept for the height-bound case.
    const battleFrameWidth = Math.min(
      z.battle.width,
      Math.max(
        layout.mainCard.cardWidth * 6,
        // Widen to cover a spread-out battle (plus a card of margin each side).
        battleFocus ? battleFocus.span + layout.mainCard.cardWidth * 2 : 0,
      ),
    );
    const rawCenter = battleFocus ? battleFocus.centerX : z.battle.x + z.battle.width / 2;
    // Keep the frame inside the band's horizontal extent.
    const centerX = Math.min(
      z.battle.x + z.battle.width - battleFrameWidth / 2,
      Math.max(z.battle.x + battleFrameWidth / 2, rawCenter),
    );
    targets.push({
      id: 'battle',
      label: 'Battle',
      rect: {
        x: centerX - battleFrameWidth / 2,
        y: top,
        width: battleFrameWidth,
        height: bottom - top,
      },
      axis: 'both',
      anchorX: 'center',
    });
  }

  return targets;
}
