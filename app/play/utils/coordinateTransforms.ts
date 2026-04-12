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
