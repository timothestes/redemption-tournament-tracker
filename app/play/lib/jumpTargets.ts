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
}

function compact(rects: Array<Rect | undefined>): Rect[] {
  return rects.filter((r): r is Rect => !!r);
}

export function buildJumpTargets(
  layout: MultiplayerLayout,
  virtualWidth: number,
  battleActive: boolean,
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

  const targets: JumpTarget[] = [
    {
      id: 'fit',
      label: 'Fit',
      rect: { x: 0, y: 0, width: virtualWidth, height: VIRTUAL_HEIGHT },
      axis: 'both',
    },
    { id: 'opponent-side', label: 'Theirs', rect: theirs, axis: 'height' },
    { id: 'my-side', label: 'Mine', rect: mine, axis: 'height' },
  ];

  if (battleActive && z.battle) {
    targets.push({ id: 'battle', label: 'Battle', rect: z.battle, axis: 'height' });
  }

  return targets;
}
