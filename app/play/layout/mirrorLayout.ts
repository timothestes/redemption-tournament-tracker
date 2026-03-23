/**
 * Mirror layout for a two-player board.
 *
 * Visual structure (top = opponent, bottom = you):
 *
 * ┌──────────────────────────────────────┬───────────────────┐
 * │ Opponent Hand (~12%)                  (full width)       │
 * ├──────────────────────────────────────┬───────────────────┤
 * │ Opponent LOB (~25% of half)          │ Opp inline piles  │
 * ├──────────────────────────────────────┤ (Dis,Deck,Res,    │
 * │ Opponent Territory (~75% of half)    │  Ban,LOR) ~15%    │
 * ├══════════════════════════════════════╪═══════════════════┤
 * │ Your Territory (~75% of half)        │ Your inline piles │
 * ├──────────────────────────────────────┤ (LOR,Ban,Res,     │
 * │ Your LOB (~25% of half)             │  Deck,Dis) ~15%   │
 * ├──────────────────────────────────────┴───────────────────┤
 * │ Your Hand (~12%)                      (full width)       │
 * ├──────────────────────────────────────────────────────────┤
 * │ Phase Bar (~7%)                       (full width)       │
 * └──────────────────────────────────────────────────────────┘
 *
 * Left sidebar (card preview + chat) is HTML outside this canvas.
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
const CARD_WIDTH_RATIO = 0.07;
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
  // ── Row heights ──────────────────────────────────────────────────────
  const phaseBarHeight = Math.round(stageHeight * 0.07);
  const handHeight = Math.round(stageHeight * 0.12);
  const playAreaHeight = stageHeight - phaseBarHeight - handHeight * 2;
  const halfPlayHeight = Math.round(playAreaHeight / 2);

  const lobHeight = Math.round(halfPlayHeight * 0.25);
  const territoryHeight = halfPlayHeight - lobHeight;

  // ── Column widths ────────────────────────────────────────────────────
  const pileColumnWidth = Math.round(stageWidth * 0.15);
  const mainWidth = stageWidth - pileColumnWidth;

  // ── Y anchors — OPPONENT: Hand → LOB → Territory ────────────────────
  const oppHandY = 0;
  const oppLobY = handHeight;
  const oppTerritoryY = oppLobY + lobHeight;

  // ── Y anchors — PLAYER: Territory → LOB → Hand ──────────────────────
  const myTerritoryY = handHeight + halfPlayHeight;
  const myLobY = myTerritoryY + territoryHeight;
  const myHandY = myLobY + lobHeight;
  const phaseBarY = myHandY + handHeight;

  const pad = 6;
  const zonePad = 4;

  // ── Free-form zones ──────────────────────────────────────────────────
  const oppLobZone: ZoneRect = {
    x: pad, y: oppLobY + pad,
    width: mainWidth - pad * 2, height: lobHeight - pad * 2,
    label: 'Opponent Land of Bondage',
  };
  const oppTerritoryZone: ZoneRect = {
    x: pad, y: oppTerritoryY + pad,
    width: mainWidth - pad * 2, height: territoryHeight - pad * 2,
    label: 'Opponent Territory',
  };
  const myTerritoryZone: ZoneRect = {
    x: pad, y: myTerritoryY + pad,
    width: mainWidth - pad * 2, height: territoryHeight - pad * 2,
    label: 'Territory',
  };
  const myLobZone: ZoneRect = {
    x: pad, y: myLobY + pad,
    width: mainWidth - pad * 2, height: lobHeight - pad * 2,
    label: 'Land of Bondage',
  };

  // ── Inline pile sidebar helper ───────────────────────────────────────
  const buildSidebar = (
    sidebarAreaY: number, areaHeight: number,
    labels: string[], keys: string[]
  ): Record<string, ZoneRect> => {
    const count = labels.length;
    const slotPad = 4;
    const slotHeight = Math.round((areaHeight - slotPad * (count + 1)) / count);
    const result: Record<string, ZoneRect> = {};
    labels.forEach((label, i) => {
      result[keys[i]] = {
        x: mainWidth + zonePad,
        y: sidebarAreaY + slotPad * (i + 1) + slotHeight * i,
        width: pileColumnWidth - zonePad * 2,
        height: slotHeight,
        label,
      };
    });
    return result;
  };

  // Player piles: LOR (top) → Banish → Reserve → Deck → Discard (bottom)
  const myPileLabels = isParagon
    ? ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard', 'Paragon']
    : ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard'];
  const myPileKeys = isParagon
    ? ['land-of-redemption', 'banish', 'reserve', 'deck', 'discard', 'paragon']
    : ['land-of-redemption', 'banish', 'reserve', 'deck', 'discard'];

  // Opponent piles: Discard (top) → Deck → Reserve → Banish → LOR (bottom)
  const oppPileLabels = isParagon
    ? ['Paragon', 'Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption']
    : ['Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption'];
  const oppPileKeys = isParagon
    ? ['paragon', 'discard', 'deck', 'reserve', 'banish', 'land-of-redemption']
    : ['discard', 'deck', 'reserve', 'banish', 'land-of-redemption'];

  const mySidebar = buildSidebar(myTerritoryY, halfPlayHeight, myPileLabels, myPileKeys);
  const opponentSidebar = buildSidebar(oppLobY, halfPlayHeight, oppPileLabels, oppPileKeys);

  // ── Hand + phase bar ─────────────────────────────────────────────────
  const opponentHandRect: ZoneRect = {
    x: 0, y: oppHandY, width: stageWidth, height: handHeight, label: 'Opponent Hand',
  };
  const myHandRect: ZoneRect = {
    x: 0, y: myHandY, width: stageWidth, height: handHeight, label: 'Hand',
  };
  const phaseBarRect: ZoneRect = {
    x: 0, y: phaseBarY, width: stageWidth, height: phaseBarHeight, label: 'Phase Bar',
  };

  return {
    myZones: { territory: myTerritoryZone, 'land-of-bondage': myLobZone, ...mySidebar },
    opponentZones: { territory: oppTerritoryZone, 'land-of-bondage': oppLobZone, ...opponentSidebar },
    myHandRect, opponentHandRect, phaseBarRect,
  };
}
