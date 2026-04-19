/**
 * Multiplayer layout — single source of truth for all proportions.
 *
 * Visual structure (top = opponent, bottom = you):
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Opponent Hand                              (full width)      │
 * ├────────────────────────────────────────────┬─────────────────┤
 * │ Opponent LOB                               │ Opp sidebar     │
 * ├────────────────────────────────────────────┤ (Dis→LOR)       │
 * │ Opponent Territory                         │                 │
 * ├════════════════════════════════════════════╪═════════════════┤
 * │ Divider                                    │                 │
 * ├════════════════════════════════════════════╪═════════════════┤
 * │ Player Territory                           │ Your sidebar    │
 * ├────────────────────────────────────────────┤ (LOR→Dis)       │
 * │ Player LOB                                 │                 │
 * ├────────────────────────────────────────────┴─────────────────┤
 * │ Player Hand                                (full width)      │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Two layout profiles (Narrow ≤1700 / Standard >1700 virtual width)
 * with different proportions tuned for each aspect ratio range.
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

export type PileZone = 'lor' | 'banish' | 'reserve' | 'deck' | 'discard';

export interface MultiplayerLayout {
  zones: {
    opponentHand: ZoneRect;
    opponentTerritory: ZoneRect;
    opponentLob: ZoneRect;
    divider: ZoneRect;
    playerLob: ZoneRect;
    playerTerritory: ZoneRect;
    playerHand: ZoneRect;
    sharedLob?: ZoneRect;     // NEW — present when Paragon
    soulDeck?: ZoneRect;      // NEW — present when Paragon
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

// ── Layout profiles ─────────────────────────────────────────────────────
// Two profiles tuned for different aspect ratio ranges. The virtual canvas
// width adapts from 1440 (4:3) to 2560 (21:9) — a single set of proportions
// can't serve both ends well.

const CARD_ASPECT_RATIO = 1.4;

interface LayoutProfile {
  sidebarWidthRatio: number;
  oppHandRatio: number;
  oppTerritoryRatio: number;
  oppLobRatio: number;
  dividerRatio: number;
  playerLobRatio: number;
  playerTerritoryRatio: number;
  playerHandRatio: number;
  mainCardWidthRatio: number;
  oppHandScale: number;
  pileLabelRatio: number;
}

/** Narrow displays: 4:3 to ~3:2 (virtual width ≤ 1700). */
const NARROW_PROFILE: LayoutProfile = {
  sidebarWidthRatio: 0.18,
  oppHandRatio: 0.07,        // smaller to save vertical space
  oppTerritoryRatio: 0.28,
  oppLobRatio: 0.10,         // larger so LOB cards fit
  dividerRatio: 0.005,
  playerLobRatio: 0.10,
  playerTerritoryRatio: 0.28,
  playerHandRatio: 0.165,    // slightly smaller
  mainCardWidthRatio: 0.065, // slightly larger cards relative to play area
  oppHandScale: 0.70,
  pileLabelRatio: 0.10,      // less label overhead → bigger pile cards
};
// Sum check: 0.07 + 0.28 + 0.10 + 0.005 + 0.10 + 0.28 + 0.165 = 1.0 ✓

/** Standard/wide displays: 16:10 and wider (virtual width > 1700). */
const STANDARD_PROFILE: LayoutProfile = {
  sidebarWidthRatio: 0.15,
  oppHandRatio: 0.08,
  oppTerritoryRatio: 0.2775,
  oppLobRatio: 0.09,
  dividerRatio: 0.005,
  playerLobRatio: 0.09,
  playerTerritoryRatio: 0.2775,
  playerHandRatio: 0.18,
  mainCardWidthRatio: 0.06,
  oppHandScale: 0.75,
  pileLabelRatio: 0.15,
};
// Sum check: 0.08 + 0.2775 + 0.09 + 0.005 + 0.09 + 0.2775 + 0.18 = 1.0 ✓

/** Virtual width breakpoint — below this use Narrow, above use Standard. */
const BREAKPOINT_WIDTH = 1700;

function getProfile(virtualWidth: number): LayoutProfile {
  return virtualWidth <= BREAKPOINT_WIDTH ? NARROW_PROFILE : STANDARD_PROFILE;
}

// ── Card dimension helpers (derived from actual virtual width + height) ──

function computeCardDimensions(
  playAreaWidth: number,
  lobZoneHeight: number,
  profile: LayoutProfile,
): {
  mainCard: CardDimensions;
  lobCard: CardDimensions;
  oppHandCard: CardDimensions;
} {
  const mainW = Math.round(playAreaWidth * profile.mainCardWidthRatio);
  const mainH = Math.round(mainW * CARD_ASPECT_RATIO);
  const mainCard = { cardWidth: mainW, cardHeight: mainH };

  // LOB cards: scale down to fit within the LOB zone height
  const lobUsable = lobZoneHeight * 0.85;
  const lobH = Math.round(Math.min(mainH, lobUsable));
  const lobW = Math.round(lobH / CARD_ASPECT_RATIO);
  const lobCard = { cardWidth: lobW, cardHeight: lobH };

  // Opponent hand cards: scaled down from main card size
  const oppW = Math.round(mainW * profile.oppHandScale);
  const oppH = Math.round(oppW * CARD_ASPECT_RATIO);
  const oppHandCard = { cardWidth: oppW, cardHeight: oppH };

  return { mainCard, lobCard, oppHandCard };
}

// Legacy exports for any external consumers (values at reference 1920×1080)
export const MAIN_CARD: CardDimensions = { cardWidth: 98, cardHeight: 137 };
export const LOB_CARD: CardDimensions = { cardWidth: 59, cardHeight: 83 };
export const OPP_HAND_CARD: CardDimensions = { cardWidth: 74, cardHeight: 104 };

function getPileCardDimensions(slotHeight: number, sidebarWidth: number, zonePad: number, pileLabelRatio: number): CardDimensions {
  const usableH = slotHeight * (1 - pileLabelRatio);
  // Constrain by both slot height and sidebar width (minus padding + badge space)
  const usableW = sidebarWidth - zonePad * 2 - 40; // 40px for count badge + label
  const maxCardW = Math.max(usableW * 0.75, 30); // card takes up to 75% of usable width
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
  const slotPad = 4;
  const usableWidth = sidebarWidth - zonePad * 2;
  const result: Partial<Record<PileZone, ZoneRect>> = {};

  // Find LOR index — it gets a full-width row on top (or bottom for opponent)
  const lorIdx = keys.indexOf('lor');

  if (lorIdx !== -1 && keys.length >= 5) {
    // Layout: LOR as full-width row, remaining 4 zones in 2×2 grid
    const lorIsFirst = lorIdx === 0;
    const gridKeys = keys.filter((_, i) => i !== lorIdx);
    const gridLabels = labels.filter((_, i) => i !== lorIdx);

    // Split height: LOR gets 1 row, grid gets 2 rows → 3 equal rows total
    const totalGaps = slotPad * 4; // gaps between 3 rows + top/bottom
    const rowHeight = Math.round((areaHeight - totalGaps) / 3);
    const colWidth = Math.round((usableWidth - slotPad) / 2);

    if (lorIsFirst) {
      // Player sidebar: LOR on top, 2×2 grid below
      const lorY = sidebarAreaY + slotPad;
      result[keys[lorIdx]] = {
        x: sidebarX + zonePad,
        y: lorY,
        width: usableWidth,
        height: rowHeight,
        label: labels[lorIdx],
      };

      const gridY = lorY + rowHeight + slotPad;
      for (let i = 0; i < gridKeys.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        result[gridKeys[i]] = {
          x: sidebarX + zonePad + col * (colWidth + slotPad),
          y: gridY + row * (rowHeight + slotPad),
          width: colWidth,
          height: rowHeight,
          label: gridLabels[i],
        };
      }
    } else {
      // Opponent sidebar: 2×2 grid on top, LOR on bottom
      const gridY = sidebarAreaY + slotPad;
      for (let i = 0; i < gridKeys.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        result[gridKeys[i]] = {
          x: sidebarX + zonePad + col * (colWidth + slotPad),
          y: gridY + row * (rowHeight + slotPad),
          width: colWidth,
          height: rowHeight,
          label: gridLabels[i],
        };
      }

      const lorY = gridY + 2 * (rowHeight + slotPad);
      result[keys[lorIdx]] = {
        x: sidebarX + zonePad,
        y: lorY,
        width: usableWidth,
        height: rowHeight,
        label: labels[lorIdx],
      };
    }
  } else {
    // Fallback: simple vertical stack
    const count = labels.length;
    const slotHeight = Math.round(
      (areaHeight - slotPad * (count + 1)) / count
    );
    labels.forEach((label, i) => {
      result[keys[i]] = {
        x: sidebarX + zonePad,
        y: sidebarAreaY + slotPad * (i + 1) + slotHeight * i,
        width: usableWidth,
        height: slotHeight,
        label,
      };
    });
  }

  return result;
}

// ── Main export ─────────────────────────────────────────────────────────

/**
 * Calculate zone positions, sidebar piles, and four card-dimension tiers
 * for a two-player multiplayer board.
 *
 * @param stageWidth   Konva canvas width (loupe is outside)
 * @param stageHeight  Konva canvas height
 */
export function calculateMultiplayerLayout(
  stageWidth: number,
  stageHeight: number,
  format: 'T1' | 'T2' | 'Paragon' = 'T1',
): MultiplayerLayout {
  const profile = getProfile(stageWidth);
  const pad = 6;
  const zonePad = 4;

  // ── Column widths ────────────────────────────────────────────────────
  const sidebarWidth = Math.round(stageWidth * profile.sidebarWidthRatio);
  const playAreaWidth = stageWidth - sidebarWidth;
  const sidebarX = playAreaWidth;

  // ── Row heights ──────────────────────────────────────────────────────
  const oppHandHeight = Math.round(stageHeight * profile.oppHandRatio);
  const oppTerritoryHeight = Math.round(stageHeight * profile.oppTerritoryRatio);
  const oppLobHeight = Math.round(stageHeight * profile.oppLobRatio);
  const dividerHeight = Math.round(stageHeight * profile.dividerRatio);
  const playerLobHeight = Math.round(stageHeight * profile.playerLobRatio);
  const playerTerritoryHeight = Math.round(stageHeight * profile.playerTerritoryRatio);
  const playerHandHeight = Math.round(stageHeight * profile.playerHandRatio);

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
    label: "Opponent's Hand",
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
    label: "Opponent's Territory",
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

  // Paragon: collapse both per-seat LoBs into a single shared band sitting
  // on top of the center divider. Soul Deck pile anchors the left end.
  let sharedLob: ZoneRect | undefined;
  let soulDeck: ZoneRect | undefined;
  if (format === 'Paragon') {
    const sharedBandY = oppTerritoryY + oppTerritoryHeight + gap;
    const sharedBandHeight = oppLobHeight + dividerHeight + playerLobHeight - gap * 2;
    const soulDeckWidth = Math.round(Math.min(100, (playAreaWidth - pad * 2) * 0.12));
    sharedLob = {
      x: pad + soulDeckWidth + 4,
      y: sharedBandY,
      width: playAreaWidth - pad * 2 - soulDeckWidth - 4,
      height: sharedBandHeight,
      label: 'Land of Bondage (Shared)',
    };
    soulDeck = {
      x: pad,
      y: sharedBandY,
      width: soulDeckWidth,
      height: sharedBandHeight,
      label: 'Soul Deck',
    };
  }

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

  // Opponent piles: Deck (top) → Discard → Reserve → Banish → LOR (bottom)
  const oppPileLabels = ['Deck', 'Discard', 'Reserve', 'Banish', 'Land of Redemption'];
  const oppPileKeys: PileZone[] = ['deck', 'discard', 'reserve', 'banish', 'lor'];

  // Player piles: LOR (top) then 2×2 grid clockwise from TL: Deck → Reserve → Banish → Discard
  // Grid fills row-by-row, so array order is [TL, TR, BL, BR] = [Deck, Reserve, Discard, Banish]
  const playerPileLabels = ['Land of Redemption', 'Deck', 'Reserve', 'Discard', 'Banish'];
  const playerPileKeys: PileZone[] = ['lor', 'deck', 'reserve', 'discard', 'banish'];

  const opponentSidebar = buildSidebar(
    sidebarX, oppSidebarY, oppSidebarHeight,
    oppPileLabels, oppPileKeys, sidebarWidth, zonePad, pad
  );
  const playerSidebar = buildSidebar(
    sidebarX, playerSidebarY, playerSidebarHeight,
    playerPileLabels, playerPileKeys, sidebarWidth, zonePad, pad
  );

  // ── Card dimensions (four tiers, derived from actual virtual width) ──
  const computed = computeCardDimensions(playAreaWidth, oppLobHeight, profile);
  const mainCard = computed.mainCard;
  const lobCard = computed.lobCard;
  const opponentHandCard = computed.oppHandCard;

  // Pile card size based on grid slot height (3 rows: LOR + 2×2 grid)
  const slotPad = 4;
  const sidebarHalfHeight = Math.min(oppSidebarHeight, playerSidebarHeight);
  const pileRowCount = 3; // 2×2 grid = 3 rows (LOR + 2 grid rows)
  const pileSlotHeight = Math.round(
    (sidebarHalfHeight - slotPad * (pileRowCount + 1)) / pileRowCount
  );
  // For 2×2 grid, use half the sidebar width for card sizing
  const pileEffectiveWidth = Math.round((sidebarWidth - zonePad * 2 - slotPad) / 2 + zonePad * 2);
  const pileCard = getPileCardDimensions(pileSlotHeight, pileEffectiveWidth, zonePad, profile.pileLabelRatio);

  return {
    zones: {
      opponentHand,
      opponentTerritory,
      opponentLob,
      divider,
      playerLob,
      playerTerritory,
      playerHand,
      sharedLob,
      soulDeck,
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
