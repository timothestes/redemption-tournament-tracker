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
    { id: 'my-side', label: 'Mine', rect: mine, axis: 'height' },
  ];

  if (battleActive && z.battle) {
    // Frame the band PLUS half a card of context above and below — a
    // height-fit of the bare band put its edges at the frame edges, clipping
    // the cards that flank it (band cards overhang, and the adjacent
    // territory rows are what a player references mid-battle).
    const contextPad = layout.mainCard.cardHeight / 2;
    const top = Math.max(0, z.battle.y - contextPad);
    const bottom = Math.min(VIRTUAL_HEIGHT, z.battle.y + z.battle.height + contextPad);
    // anchorX 'center': the battle slots, totals chips and initiative caption
    // all cluster around the band's midline. The default left-anchor showed
    // the band's empty left half and parked the action at the right viewport
    // edge, under the pan cluster and the chat rail (phone QA, wave 3).
    targets.push({
      id: 'battle',
      label: 'Battle',
      rect: { x: z.battle.x, y: top, width: z.battle.width, height: bottom - top },
      axis: 'height',
      anchorX: 'center',
    });
  }

  return targets;
}
