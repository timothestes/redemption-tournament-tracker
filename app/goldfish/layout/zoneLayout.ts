import { ZoneId } from '../types';

export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

// Fixed card dimensions in virtual canvas coordinates (1920x1080).
// Sized larger than multiplayer since goldfish has only one player's zones.
export const CARD_ASPECT_RATIO = 1.4;
export const CARD_WIDTH = 120;
export const CARD_HEIGHT = 168;  // 120 * 1.4

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
 * │  LAND OF BONDAGE                         │               │
 * └──────────────────────────────────────────┴───────────────┘
 *  [HAND]
 */
export function calculateZoneLayout(
  stageWidth: number,
  stageHeight: number,
  /** Current scale factor (real pixels / virtual pixels). Used to convert
   *  fixed-pixel HTML overlays (PhaseBar, GameToolbar) into virtual space
   *  so zone content never renders behind them. */
  scale: number = 1,
  format: 'T1' | 'T2' | 'Paragon' = 'T1',
): Record<ZoneId, ZoneRect> {
  const sidebarWidth = stageWidth * 0.17;
  const sidebarX = stageWidth - sidebarWidth;
  const mainWidth = stageWidth - sidebarWidth;

  // PhaseBar is a 40px fixed-height HTML overlay at the top of the canvas.
  // GameToolbar is ~48px at the bottom. Convert real pixels → virtual coords.
  const PHASE_BAR_REAL_PX = 44; // 40px bar + 4px breathing room
  const TOOLBAR_REAL_PX = 56;   // ~48px toolbar + 8px bottom offset
  const phaseBarHeight = scale > 0 ? Math.ceil(PHASE_BAR_REAL_PX / scale) : 50;
  const toolbarHeight = scale > 0 ? Math.ceil(TOOLBAR_REAL_PX / scale) : 60;
  const handHeight = stageHeight * 0.22; // bottom hand area
  const effectiveHandHeight = Math.max(handHeight, toolbarHeight + 80); // ensure hand clears toolbar
  const playAreaHeight = stageHeight - phaseBarHeight - effectiveHandHeight;

  const lobHeight = playAreaHeight * 0.22; // Land of Bondage at the bottom of play area
  const territoryHeight = playAreaHeight - lobHeight;

  const territoryY = phaseBarHeight;
  const lobY = territoryY + territoryHeight;
  const handY = stageHeight - effectiveHandHeight;

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

  // Soul Deck pile: occupies the left ~1 card width of the LoB when Paragon.
  // For non-Paragon, render off-canvas (consistent with paragonZone pattern).
  const soulDeckWidth = format === 'Paragon'
    ? Math.min(CARD_WIDTH + 8, landOfBondageZone.width * 0.2)
    : 0;
  const soulDeckZone: ZoneRect = format === 'Paragon'
    ? {
        x: landOfBondageZone.x,
        y: landOfBondageZone.y,
        width: soulDeckWidth,
        height: landOfBondageZone.height,
        label: 'Soul Deck',
      }
    : { x: -1000, y: -1000, width: 0, height: 0, label: 'Soul Deck' };

  // Shrink LoB rect to the right of the Soul Deck so cards don't overlap the pile
  const lobZoneFinal: ZoneRect = format === 'Paragon'
    ? {
        ...landOfBondageZone,
        x: landOfBondageZone.x + soulDeckWidth + 4,
        width: landOfBondageZone.width - soulDeckWidth - 4,
      }
    : landOfBondageZone;

  // --- Out of Play sidebar ---
  const sidebarZoneCount = 5;
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

  // Paragon is no longer rendered on the canvas; the drawer owns it.
  // Keep the entry so zone-keyed code (iteration over zones record) still works.
  const paragonZone: ZoneRect = {
    x: -1000,
    y: -1000,
    width: 0,
    height: 0,
    label: 'Paragon',
  };

  // --- Hand ---
  const handZone: ZoneRect = {
    x: 0,
    y: handY,
    width: stageWidth,
    height: effectiveHandHeight,
    label: 'Hand',
  };

  return {
    'deck': deckZone,
    'hand': handZone,
    'reserve': reserveZone,
    'discard': discardZone,
    'paragon': paragonZone,
    'land-of-bondage': lobZoneFinal,
    'soul-deck': soulDeckZone,
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
