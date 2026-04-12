import type { ZoneRect } from '../layout/multiplayerLayout';

export type Owner = 'my' | 'opponent';

/**
 * Convert a normalized DB position (0–1) to screen pixel coordinates.
 * Opponent positions are stored un-mirrored in the DB and flipped at render time.
 */
export function toScreenPos(
  dbX: number,
  dbY: number,
  zone: ZoneRect,
  owner: Owner,
): { x: number; y: number } {
  const normX = owner === 'opponent' ? 1 - dbX : dbX;
  const normY = owner === 'opponent' ? 1 - dbY : dbY;
  return {
    x: normX * zone.width + zone.x,
    y: normY * zone.height + zone.y,
  };
}

export interface ClampOpts {
  cardWidth: number;
  cardHeight: number;
}

/**
 * Convert screen pixel coordinates to a normalized DB position (0–1).
 * Handles optional clamping (keeps card within zone bounds) and opponent mirroring.
 *
 * NOTE: If the card is crossing between rotation contexts (e.g., player rotation=0
 * → opponent rotation=180), call `adjustAnchorForRotationChange` on the drop
 * position BEFORE passing it here. This function handles mirroring and clamping only.
 */
export function toDbPos(
  screenX: number,
  screenY: number,
  zone: ZoneRect,
  owner: Owner,
  clamp?: ClampOpts,
): { x: number; y: number } {
  const zoneW = zone.width || 1;
  const zoneH = zone.height || 1;
  let rawX = (screenX - zone.x) / zoneW;
  let rawY = (screenY - zone.y) / zoneH;
  if (clamp) {
    const maxX = Math.max(0, 1 - clamp.cardWidth / zoneW);
    const maxY = Math.max(0, 1 - clamp.cardHeight / zoneH);
    rawX = Math.max(0, Math.min(rawX, maxX));
    rawY = Math.max(0, Math.min(rawY, maxY));
  }
  return {
    x: owner === 'opponent' ? 1 - rawX : rawX,
    y: owner === 'opponent' ? 1 - rawY : rawY,
  };
}

/**
 * Compute the visual center of a card given its anchor position, dimensions,
 * and rotation. For rotation=180 (opponent territory), the Konva anchor is
 * the bottom-right corner, so center = anchor - half-dimensions.
 */
export function cardCenter(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  rotation: number,
): { x: number; y: number } {
  const isRotated = Math.abs(rotation) > 90;
  return {
    x: isRotated ? anchorX - width / 2 : anchorX + width / 2,
    y: isRotated ? anchorY - height / 2 : anchorY + height / 2,
  };
}

/**
 * Adjust a drop position when a card crosses between rotation contexts.
 * Offsets by card dimensions to keep the visual position stable.
 */
export function adjustAnchorForRotationChange(
  dropX: number,
  dropY: number,
  cardWidth: number,
  cardHeight: number,
  sourceRotated: boolean,
  targetRotated: boolean,
): { x: number; y: number } {
  let x = dropX;
  let y = dropY;
  if (sourceRotated && !targetRotated) {
    x -= cardWidth;
    y -= cardHeight;
  } else if (!sourceRotated && targetRotated) {
    x += cardWidth;
    y += cardHeight;
  }
  return { x, y };
}
