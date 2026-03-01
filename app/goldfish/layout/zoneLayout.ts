import { ZoneId } from '../types';

export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

// Card dimensions as proportions of stage width
export const CARD_WIDTH_RATIO = 0.052; // ~100px at 1920
export const CARD_HEIGHT_RATIO = 0.093; // ~100 * 1.4 aspect ratio at 1080
export const CARD_ASPECT_RATIO = 1.4;

export function getCardDimensions(stageWidth: number, stageHeight?: number) {
  const widthBased = Math.round(stageWidth * CARD_WIDTH_RATIO);

  if (stageHeight) {
    // Ensure a card fits inside a sidebar zone (5 zones in play area, ~24px label padding)
    const playAreaHeight = stageHeight * 0.73; // after phase bar and hand
    const sidebarZoneHeight = playAreaHeight / 5;
    const maxCardHeight = sidebarZoneHeight - 28; // room for label + padding
    const heightBased = Math.round(maxCardHeight / CARD_ASPECT_RATIO);
    const w = Math.min(widthBased, heightBased);
    return { cardWidth: w, cardHeight: Math.round(w * CARD_ASPECT_RATIO) };
  }

  const height = Math.round(widthBased * CARD_ASPECT_RATIO);
  return { cardWidth: widthBased, cardHeight: height };
}

/**
 * Calculate zone positions and sizes as proportions of the stage.
 *
 * Simplified layout:
 * ┌──────────────────────────────────────────┬───────────────┐
 * │                                          │ OUT OF PLAY   │
 * │  TERRITORY                               │ Land of Redmn │
 * │  (free-form card placement)              │ [Deck]        │
 * │                                          │ [Discard]     │
 * │                                          │ [Reserve]     │
 * │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ [Banish]      │
 * │  LAND OF BONDAGE                         │ [Paragon*]    │
 * └──────────────────────────────────────────┴───────────────┘
 *  [HAND]
 *
 * Paragon zone only rendered when format = Paragon (small, in sidebar).
 */
export function calculateZoneLayout(
  stageWidth: number,
  stageHeight: number,
  isParagon: boolean = false
): Record<ZoneId, ZoneRect> {
  const sidebarWidth = stageWidth * 0.15;
  const sidebarX = stageWidth - sidebarWidth;
  const mainWidth = stageWidth - sidebarWidth;

  const phaseBarHeight = stageHeight * 0.05; // top phase bar
  const handHeight = stageHeight * 0.22; // bottom hand area
  const playAreaHeight = stageHeight - phaseBarHeight - handHeight;

  const lobHeight = playAreaHeight * 0.22; // Land of Bondage at the bottom of play area
  const territoryHeight = playAreaHeight - lobHeight;

  const territoryY = phaseBarHeight;
  const lobY = territoryY + territoryHeight;
  const handY = stageHeight - handHeight;

  const pad = 6;
  const zonePad = 4;

  // --- Main play area (left side) ---
  const territoryZone: ZoneRect = {
    x: pad,
    y: territoryY + pad,
    width: mainWidth - pad * 2,
    height: territoryHeight - pad * 2,
    label: 'Territory',
  };

  const landOfBondageZone: ZoneRect = {
    x: pad,
    y: lobY + pad,
    width: mainWidth - pad * 2,
    height: lobHeight - pad * 2,
    label: 'Land of Bondage',
  };

  // --- Out of Play sidebar ---
  // Number of sidebar zones depends on whether paragon is shown
  const sidebarZoneCount = isParagon ? 6 : 5;
  const sideZoneHeight = (playAreaHeight - pad * (sidebarZoneCount + 1)) / sidebarZoneCount;

  let slotIndex = 0;
  const sidebarSlot = (): ZoneRect => {
    const zone: ZoneRect = {
      x: sidebarX + zonePad,
      y: phaseBarHeight + pad * (slotIndex + 1) + sideZoneHeight * slotIndex,
      width: sidebarWidth - zonePad * 2,
      height: sideZoneHeight,
      label: '', // set per zone
    };
    slotIndex++;
    return zone;
  };

  const landOfRedemptionZone: ZoneRect = { ...sidebarSlot(), label: 'Land of Redemption' };
  const banishZone: ZoneRect = { ...sidebarSlot(), label: 'Banish Zone' };
  const reserveZone: ZoneRect = { ...sidebarSlot(), label: 'Reserve' };
  const deckZone: ZoneRect = { ...sidebarSlot(), label: 'Deck' };
  const discardZone: ZoneRect = { ...sidebarSlot(), label: 'Discard' };

  // Paragon: small zone at bottom of sidebar, only when format = Paragon
  const paragonZone: ZoneRect = isParagon
    ? { ...sidebarSlot(), label: 'Paragon' }
    : { x: -1000, y: -1000, width: 0, height: 0, label: 'Paragon' }; // off-screen when not paragon

  // --- Hand ---
  const handZone: ZoneRect = {
    x: 0,
    y: handY,
    width: stageWidth,
    height: handHeight,
    label: 'Hand',
  };

  return {
    'deck': deckZone,
    'hand': handZone,
    'reserve': reserveZone,
    'discard': discardZone,
    'paragon': paragonZone,
    'land-of-bondage': landOfBondageZone,
    'territory': territoryZone,
    'land-of-redemption': landOfRedemptionZone,
    'banish': banishZone,
  };
}

/**
 * Calculate card positions within a zone (simple grid layout)
 */
export function calculateCardPositionsInZone(
  zone: ZoneRect,
  cardCount: number,
  cardWidth: number,
  cardHeight: number
): Array<{ x: number; y: number }> {
  if (cardCount === 0) return [];

  const pad = 4;
  const availW = zone.width - pad * 2;
  const availH = zone.height - pad * 2 - 16; // 16px for label

  // Max cards per row
  const maxPerRow = Math.max(1, Math.floor(availW / (cardWidth * 0.4)));
  const overlap = cardCount <= maxPerRow
    ? cardWidth + 4
    : Math.min(cardWidth + 4, availW / cardCount);

  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < cardCount; i++) {
    const row = Math.floor(i / maxPerRow);
    const col = i % maxPerRow;
    positions.push({
      x: zone.x + pad + col * overlap,
      y: zone.y + pad + 16 + row * (cardHeight * 0.3),
    });
  }
  return positions;
}
