import type { ZoneRect } from './multiplayerLayout';

export interface HandCardPosition {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Calculate card positions in a fan arc for a hand zone.
 *
 * Works for both player hand (full-size cards) and opponent hand (compact
 * cards) — the caller passes the appropriate card dimensions.
 */
export function calculateHandPositions(
  cardCount: number,
  handRect: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): HandCardPosition[] {
  if (cardCount === 0) return [];

  const centerX = handRect.x + handRect.width / 2;
  const handAreaWidth = handRect.width * 0.75;
  const handY =
    handRect.y + Math.max(0, (handRect.height - cardHeight) / 2);

  // Fan arc layout
  const maxArcAngle = 20; // degrees total arc spread
  const minVisibleFraction = 0.3;

  const maxCardSpacing = cardWidth + 4;
  const minCardSpacing = cardWidth * minVisibleFraction;
  const idealSpacing = Math.min(
    maxCardSpacing,
    handAreaWidth / Math.max(cardCount, 1),
  );
  const spacing = Math.max(minCardSpacing, idealSpacing);

  const totalWidth = (cardCount - 1) * spacing;
  const startX = centerX - totalWidth / 2;

  // Arc angle per card
  const arcAngle = cardCount > 1 ? maxArcAngle / (cardCount - 1) : 0;
  const startAngle = -maxArcAngle / 2;

  return Array.from({ length: cardCount }, (_, i) => {
    const x = startX + i * spacing;
    const rotation = cardCount > 1 ? startAngle + i * arcAngle : 0;
    // Parabolic y-offset — cards at the edges dip down slightly
    const normalizedPos =
      cardCount > 1 ? (i / (cardCount - 1)) * 2 - 1 : 0;
    const yOffset = normalizedPos * normalizedPos * 8;
    return { x, y: handY + yOffset, rotation };
  });
}
