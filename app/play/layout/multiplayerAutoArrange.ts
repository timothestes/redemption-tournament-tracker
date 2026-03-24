// TODO: Once multiplayerLayout.ts lands, switch to:
// import type { ZoneRect } from './multiplayerLayout';
import type { ZoneRect } from './multiplayerHandLayout';

/**
 * Calculate auto-arranged positions for cards in a horizontal strip zone (LOB).
 * Cards are laid out left-to-right with overlap when space is tight.
 */
export function calculateAutoArrangePositions(
  cardCount: number,
  zone: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number }[] {
  if (cardCount === 0) return [];

  const padding = 8;
  const availWidth = zone.width - padding * 2;
  const maxSpacing = cardWidth + 6;
  const minSpacing = cardWidth * 0.4;
  const idealSpacing = Math.min(
    maxSpacing,
    availWidth / Math.max(cardCount, 1),
  );
  const spacing = Math.max(minSpacing, idealSpacing);
  const startX = zone.x + padding;
  const cy = zone.y + zone.height / 2 - cardHeight / 2;

  return Array.from({ length: cardCount }, (_, i) => ({
    x: startX + i * spacing,
    y: cy,
  }));
}
