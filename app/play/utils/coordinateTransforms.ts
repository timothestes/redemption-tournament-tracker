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
