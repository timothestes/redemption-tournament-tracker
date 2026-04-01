/**
 * Battle zone snap positions.
 *
 * Calculates where characters and enhancements should snap to within
 * the Field of Battle zone. Returns absolute canvas coordinates.
 *
 * Layout per side (horizontal):
 *   [Enh N] ... [Enh 1] [Enh 0]  [Char 0]  [Char 1]  [Char 2]
 *                                     ↑
 *                              centered in zone
 */

import type { ZoneRect } from './multiplayerLayout';

/** Gap between banded characters (px). */
const BAND_GAP = 10;

/** Enhancement overlap: each enhancement shows 40% of card width. */
const ENH_VISIBLE_RATIO = 0.4;

/**
 * Get the snap position for a character in the battle zone.
 *
 * @param side       Which side of the battle zone ('player' = bottom half, 'opponent' = top half)
 * @param charIndex  0 = primary character, 1+ = banded characters
 * @param zone       The full battle zone rect
 * @param cardWidth  Card width in canvas pixels
 * @param cardHeight Card height in canvas pixels
 * @returns Absolute {x, y} position (top-left corner of the card)
 */
export function getCharacterSnapPosition(
  side: 'player' | 'opponent',
  charIndex: number,
  zone: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number } {
  const halfHeight = zone.height / 2;
  const halfY = side === 'player'
    ? zone.y + halfHeight
    : zone.y;
  // Center the card within the half-zone. If the card is taller than the
  // half-zone, clamp to the half-zone boundary so the y stays > midpoint
  // for player and < midpoint for opponent.
  const verticalOffset = Math.max(0, (halfHeight - cardHeight) / 2);
  const y = halfY + verticalOffset;
  const centerX = zone.x + zone.width / 2 - cardWidth / 2;
  const x = centerX + charIndex * (cardWidth + BAND_GAP);
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Get the snap position for an enhancement in the battle zone.
 *
 * Enhancements cascade to the LEFT of their parent character,
 * overlapping by (1 - ENH_VISIBLE_RATIO) of card width.
 *
 * @param side           Which side ('player' or 'opponent')
 * @param charIndex      Which character this enhancement belongs to (0 = primary)
 * @param enhIndex       0 = closest to character, 1 = next left, etc.
 * @param zone           The full battle zone rect
 * @param cardWidth      Card width in canvas pixels
 * @param cardHeight     Card height in canvas pixels
 * @returns Absolute {x, y} position (top-left corner of the card)
 */
export function getEnhancementSnapPosition(
  side: 'player' | 'opponent',
  charIndex: number,
  enhIndex: number,
  zone: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number } {
  const charPos = getCharacterSnapPosition(side, charIndex, zone, cardWidth, cardHeight);
  const step = cardWidth * ENH_VISIBLE_RATIO;
  return {
    x: Math.round(charPos.x - (enhIndex + 1) * step),
    y: charPos.y,
  };
}

/**
 * Convert absolute canvas position to normalized 0-1 coordinates within the battle zone.
 */
export function absoluteToNormalized(
  x: number,
  y: number,
  zone: ZoneRect,
): { posX: string; posY: string } {
  return {
    posX: String((x - zone.x) / zone.width),
    posY: String((y - zone.y) / zone.height),
  };
}

/**
 * Convert normalized 0-1 coordinates to absolute canvas position within the battle zone.
 */
export function normalizedToAbsolute(
  posX: string,
  posY: string,
  zone: ZoneRect,
): { x: number; y: number } {
  return {
    x: zone.x + parseFloat(posX) * zone.width,
    y: zone.y + parseFloat(posY) * zone.height,
  };
}
