export interface HandCardPosition {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Calculate card positions in a fan arc for the hand zone.
 * Cards fan out along the bottom of the screen.
 */
export function calculateHandPositions(
  cardCount: number,
  stageWidth: number,
  stageHeight: number,
  isSpread: boolean,
  cardWidth: number,
  cardHeight: number,
): HandCardPosition[] {
  if (cardCount === 0) return [];
  const handZoneTop = stageHeight - stageHeight * 0.22;
  const centerX = stageWidth / 2;
  const handAreaWidth = stageWidth * 0.75;

  // Vertically center cards in the hand zone, leaving room for the toolbar (~60px)
  const toolbarReserve = 60;
  const availableHeight = stageHeight - handZoneTop - toolbarReserve;
  const handY = handZoneTop + Math.max(0, (availableHeight - cardHeight) / 2);

  if (isSpread) {
    // Flat spread — no overlap, no rotation
    const totalWidth = cardCount * (cardWidth + 6);
    const startX = centerX - totalWidth / 2;
    return Array.from({ length: cardCount }, (_, i) => ({
      x: startX + i * (cardWidth + 6),
      y: handY,
      rotation: 0,
    }));
  }

  // Fan arc layout
  const maxArcAngle = 20; // degrees total arc spread
  const minVisibleFraction = 0.3;

  // Calculate overlap based on card count
  const maxCardSpacing = cardWidth + 4;
  const minCardSpacing = cardWidth * minVisibleFraction;
  const idealSpacing = Math.min(maxCardSpacing, handAreaWidth / Math.max(cardCount, 1));
  const spacing = Math.max(minCardSpacing, idealSpacing);

  const totalWidth = (cardCount - 1) * spacing;
  const startX = centerX - totalWidth / 2;

  // Arc angle per card
  const arcAngle = cardCount > 1 ? maxArcAngle / (cardCount - 1) : 0;
  const startAngle = -maxArcAngle / 2;

  return Array.from({ length: cardCount }, (_, i) => {
    const x = startX + i * spacing;
    const rotation = cardCount > 1 ? startAngle + i * arcAngle : 0;
    // Slight arc in y position (cards in the middle are slightly higher)
    const normalizedPos = cardCount > 1 ? (i / (cardCount - 1)) * 2 - 1 : 0;
    const yOffset = normalizedPos * normalizedPos * 15; // parabolic arc
    return {
      x,
      y: handY + yOffset,
      rotation,
    };
  });
}
