/**
 * Mirror layout for a two-player MTGO-style board.
 *
 * Visual structure (top = opponent, bottom = you):
 *
 * ┌────────────────────────────────────────────┬──────────────┐
 * │ Opponent Hand (~6%)                         (full width)  │
 * ├────────────────────────────────────────────┬──────────────┤
 * │ Opponent LOB (~12%)                        │ Opp sidebar  │
 * ├────────────────────────────────────────────┤ (LOR, Banish,│
 * │ Opponent Territory (~24%)                  │  Reserve,    │
 * │                                            │  Discard,    │
 * ├────────────────────────────────────────────┤  Deck)  ~15% │
 * │ Your Territory (~24%)                      ├──────────────┤
 * │                                            │ Your sidebar │
 * ├────────────────────────────────────────────┤ (Deck,       │
 * │ Your LOB (~12%)                            │  Discard,    │
 * ├────────────────────────────────────────────┴──────────────┤
 * │ Your Hand (~6%)                             (full width)  │
 * ├────────────────────────────────────────────────────────────┤
 * │ Phase Bar (~5%)                             (full width)  │
 * └────────────────────────────────────────────────────────────┘
 */

export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface MirrorLayout {
  /** Your territory, LOB, and sidebar stacks */
  myZones: Record<string, ZoneRect>;
  /** Opponent's territory, LOB, and sidebar stacks */
  opponentZones: Record<string, ZoneRect>;
  /** Your hand area (bottom) */
  myHandRect: ZoneRect;
  /** Opponent hand area (top, card backs) */
  opponentHandRect: ZoneRect;
  /** Phase bar area at bottom */
  phaseBarRect: ZoneRect;
}

/** Card dimensions as a proportion of stage width. */
const CARD_WIDTH_RATIO = 0.052;
const CARD_ASPECT_RATIO = 1.4;

/**
 * Returns card pixel dimensions that comfortably fit within the mirror sidebar
 * zones, bounded by both width and height constraints.
 */
export function getCardDimensions(
  stageWidth: number
): { cardWidth: number; cardHeight: number } {
  const cardWidth = Math.round(stageWidth * CARD_WIDTH_RATIO);
  const cardHeight = Math.round(cardWidth * CARD_ASPECT_RATIO);
  return { cardWidth, cardHeight };
}

/**
 * Calculate zone positions and sizes for a two-player mirror board.
 *
 * All coordinates are in stage-pixel space (0,0 = top-left).
 *
 * @param stageWidth  Total canvas width in pixels
 * @param stageHeight Total canvas height in pixels
 * @param isParagon   Whether to include the Paragon zone in each sidebar
 */
export function calculateMirrorLayout(
  stageWidth: number,
  stageHeight: number,
  isParagon: boolean = false
): MirrorLayout {
  // ── Row heights (proportional) ────────────────────────────────────────────
  const phaseBarHeight = Math.round(stageHeight * 0.05);
  const handHeight = Math.round(stageHeight * 0.06);

  // Remaining canvas after both hands and phase bar
  const playAreaHeight = stageHeight - phaseBarHeight - handHeight * 2;

  // Each player's half of the play area (top for opponent, bottom for player)
  const halfPlayHeight = Math.round(playAreaHeight / 2);

  // Within each half: LOB ~30% of the half, Territory the rest
  const lobHeight = Math.round(halfPlayHeight * 0.30);
  const territoryHeight = halfPlayHeight - lobHeight;

  // ── Column widths ─────────────────────────────────────────────────────────
  const sidebarWidth = Math.round(stageWidth * 0.15);
  const mainWidth = stageWidth - sidebarWidth;

  // ── Y anchors (top-to-bottom) ─────────────────────────────────────────────
  const oppHandY = 0;
  const oppPlayAreaY = handHeight;
  const oppTerritoryY = oppPlayAreaY;
  const oppLobY = oppTerritoryY + territoryHeight;

  const myPlayAreaY = oppPlayAreaY + halfPlayHeight;
  const myTerritoryY = myPlayAreaY;
  const myLobY = myTerritoryY + territoryHeight;

  const myHandY = myPlayAreaY + halfPlayHeight;
  const phaseBarY = myHandY + handHeight;

  // ── Sidebar zone stacking helper ──────────────────────────────────────────
  const pad = 6;
  const zonePad = 4;
  const sidebarZoneCount = isParagon ? 6 : 5;

  /**
   * Build an array of evenly-stacked sidebar ZoneRects for one player's
   * sidebar column.
   *
   * @param sidebarAreaY  Top of the play-area half
   * @param areaHeight    Height of the play-area half
   * @param labels        Zone labels in top-to-bottom order
   * @param keys          Matching zone keys (same order)
   */
  const buildSidebar = (
    sidebarAreaY: number,
    areaHeight: number,
    labels: string[],
    keys: string[]
  ): Record<string, ZoneRect> => {
    const count = labels.length;
    const slotHeight = Math.round(
      (areaHeight - pad * (count + 1)) / count
    );

    const result: Record<string, ZoneRect> = {};
    labels.forEach((label, i) => {
      result[keys[i]] = {
        x: mainWidth + zonePad,
        y: sidebarAreaY + pad * (i + 1) + slotHeight * i,
        width: sidebarWidth - zonePad * 2,
        height: slotHeight,
        label,
      };
    });
    return result;
  };

  // ── Sidebar zone labels / keys ────────────────────────────────────────────
  // Opponent sidebar: top-to-bottom reads LOR → Banish → Reserve → Discard → Deck
  // (mirrored vertically relative to player's sidebar)
  const oppSidebarLabels = isParagon
    ? ['Land of Redemption', 'Banish Zone', 'Reserve', 'Discard', 'Deck', 'Paragon']
    : ['Land of Redemption', 'Banish Zone', 'Reserve', 'Discard', 'Deck'];
  const oppSidebarKeys = isParagon
    ? ['land-of-redemption', 'banish', 'reserve', 'discard', 'deck', 'paragon']
    : ['land-of-redemption', 'banish', 'reserve', 'discard', 'deck'];

  // Player sidebar: top-to-bottom reads Deck → Discard → Reserve → Banish → LOR
  // (natural reading order with deck at top)
  const mySidebarLabels = isParagon
    ? ['Paragon', 'Deck', 'Discard', 'Reserve', 'Banish Zone', 'Land of Redemption']
    : ['Deck', 'Discard', 'Reserve', 'Banish Zone', 'Land of Redemption'];
  const mySidebarKeys = isParagon
    ? ['paragon', 'deck', 'discard', 'reserve', 'banish', 'land-of-redemption']
    : ['deck', 'discard', 'reserve', 'banish', 'land-of-redemption'];

  // ── Build sidebars ────────────────────────────────────────────────────────
  const opponentSidebar = buildSidebar(
    oppPlayAreaY,
    halfPlayHeight,
    oppSidebarLabels,
    oppSidebarKeys
  );

  const mySidebar = buildSidebar(
    myPlayAreaY,
    halfPlayHeight,
    mySidebarLabels,
    mySidebarKeys
  );

  // ── Main play zones ───────────────────────────────────────────────────────
  const oppTerritoryZone: ZoneRect = {
    x: pad,
    y: oppTerritoryY + pad,
    width: mainWidth - pad * 2,
    height: territoryHeight - pad * 2,
    label: 'Opponent Territory',
  };

  const oppLobZone: ZoneRect = {
    x: pad,
    y: oppLobY + pad,
    width: mainWidth - pad * 2,
    height: lobHeight - pad * 2,
    label: 'Opponent Land of Bondage',
  };

  const myTerritoryZone: ZoneRect = {
    x: pad,
    y: myTerritoryY + pad,
    width: mainWidth - pad * 2,
    height: territoryHeight - pad * 2,
    label: 'Territory',
  };

  const myLobZone: ZoneRect = {
    x: pad,
    y: myLobY + pad,
    width: mainWidth - pad * 2,
    height: lobHeight - pad * 2,
    label: 'Land of Bondage',
  };

  // ── Hand areas ────────────────────────────────────────────────────────────
  const opponentHandRect: ZoneRect = {
    x: 0,
    y: oppHandY,
    width: stageWidth,
    height: handHeight,
    label: 'Opponent Hand',
  };

  const myHandRect: ZoneRect = {
    x: 0,
    y: myHandY,
    width: stageWidth,
    height: handHeight,
    label: 'Hand',
  };

  // ── Phase bar ─────────────────────────────────────────────────────────────
  const phaseBarRect: ZoneRect = {
    x: 0,
    y: phaseBarY,
    width: stageWidth,
    height: phaseBarHeight,
    label: 'Phase Bar',
  };

  return {
    myZones: {
      territory: myTerritoryZone,
      'land-of-bondage': myLobZone,
      ...mySidebar,
    },
    opponentZones: {
      territory: oppTerritoryZone,
      'land-of-bondage': oppLobZone,
      ...opponentSidebar,
    },
    myHandRect,
    opponentHandRect,
    phaseBarRect,
  };
}
