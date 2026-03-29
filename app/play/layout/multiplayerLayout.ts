/**
 * Multiplayer layout — single source of truth for all proportions.
 *
 * Visual structure (top = opponent, bottom = you):
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Opponent Hand (8%)                         (full width)      │
 * ├────────────────────────────────────────────┬─────────────────┤
 * │ Opponent LOB (9%)                          │ Opp sidebar     │
 * ├────────────────────────────────────────────┤ (Dis→LOR) 15%  │
 * │ Opponent Territory (27%)                   │                 │
 * ├════════════════════════════════════════════╪═════════════════┤
 * │ Divider (2%)                               │                 │
 * ├════════════════════════════════════════════╪═════════════════┤
 * │ Player Territory (27%)                     │ Your sidebar    │
 * ├────────────────────────────────────────────┤ (LOR→Dis) 15%  │
 * │ Player LOB (9%)                            │                 │
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
const OPP_TERRITORY_RATIO = 0.2775;
const OPP_LOB_RATIO = 0.09;
const DIVIDER_RATIO = 0.005;
const PLAYER_LOB_RATIO = 0.09;
const PLAYER_TERRITORY_RATIO = 0.2775;
const PLAYER_HAND_RATIO = 0.18;

const PILE_LABEL_RATIO = 0.15;

// ── Card dimension helpers (derived from actual virtual width + height) ──
// Card sizes adapt to the aspect ratio so they fit at narrower widths (e.g.
// 4:3 displays) instead of being hardcoded for 1920×1080.
// The 0.06 ratio gives ~98px at 1920 width, scaling down proportionally.
const MAIN_CARD_WIDTH_RATIO = 0.06;
const OPP_HAND_SCALE = 0.75;

function computeCardDimensions(playAreaWidth: number, lobZoneHeight: number): {
  mainCard: CardDimensions;
  lobCard: CardDimensions;
  oppHandCard: CardDimensions;
} {
  const mainW = Math.round(playAreaWidth * MAIN_CARD_WIDTH_RATIO);
  const mainH = Math.round(mainW * CARD_ASPECT_RATIO);
  const mainCard = { cardWidth: mainW, cardHeight: mainH };

  // LOB cards: scale down to fit within the LOB zone height
  const lobUsable = lobZoneHeight * 0.85;
  const lobH = Math.round(Math.min(mainH, lobUsable));
  const lobW = Math.round(lobH / CARD_ASPECT_RATIO);
  const lobCard = { cardWidth: lobW, cardHeight: lobH };

  // Opponent hand cards: 75% of main card size
  const oppW = Math.round(mainW * OPP_HAND_SCALE);
  const oppH = Math.round(oppW * CARD_ASPECT_RATIO);
  const oppHandCard = { cardWidth: oppW, cardHeight: oppH };

  return { mainCard, lobCard, oppHandCard };
}

// Legacy exports for any external consumers (values at reference 1920×1080)
export const MAIN_CARD: CardDimensions = { cardWidth: 98, cardHeight: 137 };
export const LOB_CARD: CardDimensions = { cardWidth: 59, cardHeight: 83 };
export const OPP_HAND_CARD: CardDimensions = { cardWidth: 74, cardHeight: 104 };

function getPileCardDimensions(slotHeight: number, sidebarWidth: number, zonePad: number): CardDimensions {
  const usableH = slotHeight * (1 - PILE_LABEL_RATIO);
  // Constrain by both slot height and sidebar width (minus padding + badge space)
  const usableW = sidebarWidth - zonePad * 2 - 40; // 40px for count badge + label
  const maxCardW = Math.max(usableW * 0.55, 30); // card takes up to 55% of usable width
  // Height from width (maintain aspect ratio), capped by slot height
  const hFromW = maxCardW * CARD_ASPECT_RATIO;
  const h = Math.round(Math.min(Math.max(Math.min(usableH, hFromW), 30), usableH));
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
  // Order: Opp Hand → Opp LOB → Opp Territory → Divider → Player Territory → Player LOB → Player Hand
  const oppHandY = 0;
  const oppLobY = oppHandHeight;
  const oppTerritoryY = oppLobY + oppLobHeight;
  const dividerY = oppTerritoryY + oppTerritoryHeight;
  const playerTerritoryY = dividerY + dividerHeight;
  const playerLobY = playerTerritoryY + playerTerritoryHeight;
  const playerHandY = playerLobY + playerLobHeight;

  // ── Zone rects ───────────────────────────────────────────────────────
  // Hands span full stageWidth; territory/LOB span playAreaWidth.
  // Use tight gap (2px) between territory↔LOB↔hand to minimize dead space.
  const gap = 2;

  const opponentHand: ZoneRect = {
    x: 0,
    y: oppHandY,
    width: stageWidth,
    height: oppHandHeight,
    label: 'Opponent Hand',
  };

  const opponentLob: ZoneRect = {
    x: pad,
    y: oppLobY + gap,
    width: playAreaWidth - pad * 2,
    height: oppLobHeight - gap * 2,
    label: 'Land of Bondage',
  };

  const opponentTerritory: ZoneRect = {
    x: pad,
    y: oppTerritoryY + gap,
    width: playAreaWidth - pad * 2,
    height: oppTerritoryHeight - gap,
    label: 'Opponent Territory',
  };

  const divider: ZoneRect = {
    x: 0,
    y: dividerY,
    width: stageWidth,
    height: dividerHeight,
    label: '',
  };

  const playerTerritory: ZoneRect = {
    x: pad,
    y: playerTerritoryY,
    width: playAreaWidth - pad * 2,
    height: playerTerritoryHeight - gap,
    label: 'Territory',
  };

  const playerLob: ZoneRect = {
    x: pad,
    y: playerLobY + gap,
    width: playAreaWidth - pad * 2,
    height: playerLobHeight - gap * 2,
    label: 'Land of Bondage',
  };

  const playerHand: ZoneRect = {
    x: 0,
    y: playerHandY,
    width: stageWidth,
    height: stageHeight - playerHandY,
    label: 'Hand',
  };

  // ── Sidebars ─────────────────────────────────────────────────────────
  // Split at the center divider so each sidebar mirrors its half of the board.
  const oppSidebarY = oppLobY;
  const oppSidebarHeight = dividerY - oppLobY;
  const playerSidebarY = dividerY + dividerHeight;
  const playerSidebarHeight = playerHandY - playerSidebarY;

  // Opponent piles: reversed order — Discard (top) → Deck → Reserve → Banish → LOR (bottom)
  const oppPileLabels = isParagon
    ? ['Paragon', 'Discard', 'Deck', 'Reserve', 'Banish', 'Land of Redemption']
    : ['Discard', 'Deck', 'Reserve', 'Banish', 'Land of Redemption'];
  const oppPileKeys: PileZone[] = isParagon
    ? ['paragon', 'discard', 'deck', 'reserve', 'banish', 'lor']
    : ['discard', 'deck', 'reserve', 'banish', 'lor'];

  // Player piles: LOR (top) → Banish → Reserve → Deck → Discard (bottom)
  const playerPileLabels = isParagon
    ? ['Land of Redemption', 'Banish', 'Reserve', 'Deck', 'Discard', 'Paragon']
    : ['Land of Redemption', 'Banish', 'Reserve', 'Deck', 'Discard'];
  const playerPileKeys: PileZone[] = isParagon
    ? ['lor', 'banish', 'reserve', 'deck', 'discard', 'paragon']
    : ['lor', 'banish', 'reserve', 'deck', 'discard'];

  const opponentSidebar = buildSidebar(
    sidebarX, oppSidebarY, oppSidebarHeight,
    oppPileLabels, oppPileKeys, sidebarWidth, zonePad, pad
  );
  const playerSidebar = buildSidebar(
    sidebarX, playerSidebarY, playerSidebarHeight,
    playerPileLabels, playerPileKeys, sidebarWidth, zonePad, pad
  );

  // ── Card dimensions (four tiers, derived from actual virtual width) ──
  const computed = computeCardDimensions(playAreaWidth, oppLobHeight);
  const mainCard = computed.mainCard;
  const lobCard = computed.lobCard;
  const opponentHandCard = computed.oppHandCard;

  // Pile card size based on a single sidebar slot height (use the smaller half)
  const pileSlotCount = isParagon ? 6 : 5;
  const slotPad = 4;
  const sidebarHalfHeight = Math.min(oppSidebarHeight, playerSidebarHeight);
  const pileSlotHeight = Math.round(
    (sidebarHalfHeight - slotPad * (pileSlotCount + 1)) / pileSlotCount
  );
  const pileCard = getPileCardDimensions(pileSlotHeight, sidebarWidth, zonePad);

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
