/**
 * Multiplayer layout — single source of truth for all proportions.
 *
 * Visual structure (top = opponent, bottom = you):
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Opponent Hand (8%)                         (full width)      │
 * ├────────────────────────────────────────────┬─────────────────┤
 * │ Opponent Territory (27%)                   │ Opp sidebar     │
 * ├────────────────────────────────────────────┤ (Dis→LOR) 15%  │
 * │ Opponent LOB (9%)                          │                 │
 * ├════════════════════════════════════════════╪═════════════════┤
 * │ Divider (2%)                               │                 │
 * ├════════════════════════════════════════════╪═════════════════┤
 * │ Player LOB (9%)                            │ Your sidebar    │
 * ├────────────────────────────────────────────┤ (LOR→Dis) 15%  │
 * │ Player Territory (27%)                     │                 │
 * ├────────────────────────────────────────────┴─────────────────┤
 * │ Player Hand (18%)                          (full width)      │
 * └──────────────────────────────────────────────────────────────┘
 *
 * stageWidth is already the Konva canvas width (loupe is outside).
 * Phase bar (TurnIndicator) is HTML below the canvas.
 */

// ── Interfaces ──────────────────────────────────────────────────────────

export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface CardDimensions {
  cardWidth: number;
  cardHeight: number;
}

export type PileZone = 'lor' | 'banish' | 'reserve' | 'deck' | 'discard' | 'paragon';

export interface MultiplayerLayout {
  zones: {
    opponentHand: ZoneRect;
    opponentTerritory: ZoneRect;
    opponentLob: ZoneRect;
    divider: ZoneRect;
    playerLob: ZoneRect;
    playerTerritory: ZoneRect;
    playerHand: ZoneRect;
  };
  sidebar: {
    opponent: Partial<Record<PileZone, ZoneRect>>;
    player: Partial<Record<PileZone, ZoneRect>>;
  };
  mainCard: CardDimensions;
  lobCard: CardDimensions;
  opponentHandCard: CardDimensions;
  pileCard: CardDimensions;
  sidebarWidth: number;
  playAreaWidth: number;
}

// ── Proportion constants ────────────────────────────────────────────────

const CARD_ASPECT_RATIO = 1.4;
const SIDEBAR_WIDTH_RATIO = 0.15;

// Vertical band ratios (must sum to 1.0)
const OPP_HAND_RATIO = 0.08;
const OPP_TERRITORY_RATIO = 0.27;
const OPP_LOB_RATIO = 0.09;
const DIVIDER_RATIO = 0.02;
const PLAYER_LOB_RATIO = 0.09;
const PLAYER_TERRITORY_RATIO = 0.27;
const PLAYER_HAND_RATIO = 0.18;

// Card sizing ratios
const MAIN_CARD_WIDTH_RATIO = 0.06;
const MAIN_CARD_HAND_HEADROOM = 0.82;
const LOB_CARD_HEADROOM = 0.85;
const OPP_HAND_HEADROOM = 0.78;
const OPP_HAND_SCALE = 0.55;
const PILE_LABEL_RATIO = 0.22;

// ── Private card sizing functions ───────────────────────────────────────

function getMainCardDimensions(
  playWidth: number,
  stageHeight: number
): CardDimensions {
  const widthBased = playWidth * MAIN_CARD_WIDTH_RATIO;
  const playerHandHeight = stageHeight * PLAYER_HAND_RATIO;
  const heightBased = (playerHandHeight * MAIN_CARD_HAND_HEADROOM) / CARD_ASPECT_RATIO;
  const w = Math.round(Math.min(widthBased, heightBased));
  return { cardWidth: w, cardHeight: Math.round(w * CARD_ASPECT_RATIO) };
}

function getLobCardDimensions(
  mainCard: CardDimensions,
  lobZoneHeight: number
): CardDimensions {
  // If the main card fits inside the LOB zone, reuse it
  if (mainCard.cardHeight <= lobZoneHeight * LOB_CARD_HEADROOM) {
    return { ...mainCard };
  }
  // Otherwise scale to fit
  const h = lobZoneHeight * LOB_CARD_HEADROOM;
  const w = Math.round(h / CARD_ASPECT_RATIO);
  return { cardWidth: w, cardHeight: Math.round(h) };
}

function getOpponentHandCardDimensions(
  mainCard: CardDimensions,
  oppHandHeight: number
): CardDimensions {
  const scaledWidth = mainCard.cardWidth * OPP_HAND_SCALE;
  const heightBased = (oppHandHeight * OPP_HAND_HEADROOM) / CARD_ASPECT_RATIO;
  const w = Math.round(Math.min(scaledWidth, heightBased));
  return { cardWidth: w, cardHeight: Math.round(w * CARD_ASPECT_RATIO) };
}

function getPileCardDimensions(slotHeight: number): CardDimensions {
  const usable = slotHeight * (1 - PILE_LABEL_RATIO);
  const h = Math.max(usable, 30);
  const w = Math.round(h / CARD_ASPECT_RATIO);
  return { cardWidth: Math.max(w, Math.round(30 / CARD_ASPECT_RATIO)), cardHeight: Math.round(Math.max(h, 30)) };
}

// ── Sidebar builder ─────────────────────────────────────────────────────

function buildSidebar(
  sidebarX: number,
  sidebarAreaY: number,
  areaHeight: number,
  labels: string[],
  keys: PileZone[],
  sidebarWidth: number,
  zonePad: number,
  pad: number
): Partial<Record<PileZone, ZoneRect>> {
  const count = labels.length;
  const slotPad = 4;
  const slotHeight = Math.round(
    (areaHeight - slotPad * (count + 1)) / count
  );
  const result: Partial<Record<PileZone, ZoneRect>> = {};
  labels.forEach((label, i) => {
    result[keys[i]] = {
      x: sidebarX + zonePad,
      y: sidebarAreaY + slotPad * (i + 1) + slotHeight * i,
      width: sidebarWidth - zonePad * 2,
      height: slotHeight,
      label,
    };
  });
  return result;
}

// ── Main export ─────────────────────────────────────────────────────────

/**
 * Calculate zone positions, sidebar piles, and four card-dimension tiers
 * for a two-player multiplayer board.
 *
 * @param stageWidth  Konva canvas width (loupe is outside)
 * @param stageHeight Konva canvas height
 * @param isParagon   Whether to include the Paragon zone in each sidebar
 */
export function calculateMultiplayerLayout(
  stageWidth: number,
  stageHeight: number,
  isParagon: boolean = false
): MultiplayerLayout {
  const pad = 6;
  const zonePad = 4;

  // ── Column widths ────────────────────────────────────────────────────
  const sidebarWidth = Math.round(stageWidth * SIDEBAR_WIDTH_RATIO);
  const playAreaWidth = stageWidth - sidebarWidth;
  const sidebarX = playAreaWidth;

  // ── Row heights ──────────────────────────────────────────────────────
  const oppHandHeight = Math.round(stageHeight * OPP_HAND_RATIO);
  const oppTerritoryHeight = Math.round(stageHeight * OPP_TERRITORY_RATIO);
  const oppLobHeight = Math.round(stageHeight * OPP_LOB_RATIO);
  const dividerHeight = Math.round(stageHeight * DIVIDER_RATIO);
  const playerLobHeight = Math.round(stageHeight * PLAYER_LOB_RATIO);
  const playerTerritoryHeight = Math.round(stageHeight * PLAYER_TERRITORY_RATIO);
  const playerHandHeight = Math.round(stageHeight * PLAYER_HAND_RATIO);

  // ── Y anchors ────────────────────────────────────────────────────────
  const oppHandY = 0;
  const oppTerritoryY = oppHandHeight;
  const oppLobY = oppTerritoryY + oppTerritoryHeight;
  const dividerY = oppLobY + oppLobHeight;
  const playerLobY = dividerY + dividerHeight;
  const playerTerritoryY = playerLobY + playerLobHeight;
  const playerHandY = playerTerritoryY + playerTerritoryHeight;

  // ── Zone rects ───────────────────────────────────────────────────────
  // Hands span full stageWidth; territory/LOB span playAreaWidth
  const opponentHand: ZoneRect = {
    x: 0,
    y: oppHandY,
    width: stageWidth,
    height: oppHandHeight,
    label: 'Opponent Hand',
  };

  const opponentTerritory: ZoneRect = {
    x: pad,
    y: oppTerritoryY + pad,
    width: playAreaWidth - pad * 2,
    height: oppTerritoryHeight - pad * 2,
    label: 'Opponent Territory',
  };

  const opponentLob: ZoneRect = {
    x: pad,
    y: oppLobY + pad,
    width: playAreaWidth - pad * 2,
    height: oppLobHeight - pad * 2,
    label: 'Opponent Land of Bondage',
  };

  const divider: ZoneRect = {
    x: 0,
    y: dividerY,
    width: stageWidth,
    height: dividerHeight,
    label: '',
  };

  const playerLob: ZoneRect = {
    x: pad,
    y: playerLobY + pad,
    width: playAreaWidth - pad * 2,
    height: playerLobHeight - pad * 2,
    label: 'Land of Bondage',
  };

  const playerTerritory: ZoneRect = {
    x: pad,
    y: playerTerritoryY + pad,
    width: playAreaWidth - pad * 2,
    height: playerTerritoryHeight - pad * 2,
    label: 'Territory',
  };

  const playerHand: ZoneRect = {
    x: 0,
    y: playerHandY,
    width: stageWidth,
    height: playerHandHeight,
    label: 'Hand',
  };

  // ── Sidebars ─────────────────────────────────────────────────────────
  // Sidebar is split 50/50 vertically: opponent top half, player bottom half.
  // Sidebar covers the area between the two hand zones.
  const sidebarTotalHeight =
    oppTerritoryHeight + oppLobHeight + dividerHeight + playerLobHeight + playerTerritoryHeight;
  const sidebarTopY = oppTerritoryY;
  const halfSidebarHeight = Math.round(sidebarTotalHeight / 2);

  // Opponent piles: reversed order — Discard (top) → Deck → Reserve → Banish → LOR (bottom)
  const oppPileLabels = isParagon
    ? ['Paragon', 'Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption']
    : ['Discard', 'Deck', 'Reserve', 'Banish Zone', 'Land of Redemption'];
  const oppPileKeys: PileZone[] = isParagon
    ? ['paragon', 'discard', 'deck', 'reserve', 'banish', 'lor']
    : ['discard', 'deck', 'reserve', 'banish', 'lor'];

  // Player piles: LOR (top) → Banish → Reserve → Deck → Discard (bottom)
  const playerPileLabels = isParagon
    ? ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard', 'Paragon']
    : ['Land of Redemption', 'Banish Zone', 'Reserve', 'Deck', 'Discard'];
  const playerPileKeys: PileZone[] = isParagon
    ? ['lor', 'banish', 'reserve', 'deck', 'discard', 'paragon']
    : ['lor', 'banish', 'reserve', 'deck', 'discard'];

  const opponentSidebar = buildSidebar(
    sidebarX, sidebarTopY, halfSidebarHeight,
    oppPileLabels, oppPileKeys, sidebarWidth, zonePad, pad
  );
  const playerSidebar = buildSidebar(
    sidebarX, sidebarTopY + halfSidebarHeight, halfSidebarHeight,
    playerPileLabels, playerPileKeys, sidebarWidth, zonePad, pad
  );

  // ── Card dimensions (four tiers) ────────────────────────────────────
  const mainCard = getMainCardDimensions(playAreaWidth, stageHeight);
  const lobCard = getLobCardDimensions(mainCard, playerLobHeight);
  const opponentHandCard = getOpponentHandCardDimensions(mainCard, oppHandHeight);

  // Pile card size based on a single sidebar slot height
  const pileSlotCount = isParagon ? 6 : 5;
  const slotPad = 4;
  const pileSlotHeight = Math.round(
    (halfSidebarHeight - slotPad * (pileSlotCount + 1)) / pileSlotCount
  );
  const pileCard = getPileCardDimensions(pileSlotHeight);

  return {
    zones: {
      opponentHand,
      opponentTerritory,
      opponentLob,
      divider,
      playerLob,
      playerTerritory,
      playerHand,
    },
    sidebar: {
      opponent: opponentSidebar,
      player: playerSidebar,
    },
    mainCard,
    lobCard,
    opponentHandCard,
    pileCard,
    sidebarWidth,
    playAreaWidth,
  };
}
