'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Stage, Layer, Rect, Text, Group, Circle } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { useGameState } from '../hooks/useGameState';
import { useSpreadHand } from '../contexts/SpreadHandContext';
import { useMultiplayerImagePreloader } from '../hooks/useMultiplayerImagePreloader';
import {
  calculateMultiplayerLayout,
  type ZoneRect,
} from '../layout/multiplayerLayout';
import { calculateHandPositions } from '../layout/multiplayerHandLayout';
import { calculateAutoArrangePositions } from '../layout/multiplayerAutoArrange';
import {
  GameCardNode,
  CardBackShape,
  cardBackListeners,
  cardBackLoaded,
} from '../../shared/components/GameCardNode';
import { useSelectionState, type CardBound } from '../../goldfish/hooks/useSelectionState';
import type { GameCard, Counter } from '../../goldfish/types';
import { COUNTER_COLORS } from '../../goldfish/types';
import type {
  CardInstance,
  CardCounter,
} from '@/lib/spacetimedb/module_bindings/types';
import { CardContextMenu } from '@/app/shared/components/CardContextMenu';
import { MultiCardContextMenu } from '@/app/shared/components/MultiCardContextMenu';
import { ZoneContextMenu } from '@/app/shared/components/ZoneContextMenu';
import { DeckContextMenu } from '@/app/shared/components/DeckContextMenu';
import { DeckDropPopup } from '@/app/shared/components/DeckDropPopup';
import { LorContextMenu } from '@/app/shared/components/LorContextMenu';
import { OpponentZoneContextMenu } from '@/app/shared/components/OpponentZoneContextMenu';
import { HandContextMenu } from '@/app/shared/components/HandContextMenu';
import { ConsentDialog } from '@/app/shared/components/ConsentDialog';
import { OpponentBrowseModal } from '@/app/shared/components/OpponentBrowseModal';
import { showGameToast } from '@/app/shared/components/GameToast';
import type { GameActions } from '@/app/shared/types/gameActions';
import { ModalGameProvider, type ModalGameContextValue } from '@/app/shared/contexts/ModalGameContext';
import { DeckSearchModal } from '@/app/shared/components/DeckSearchModal';
import { DeckPeekModal } from '@/app/shared/components/DeckPeekModal';
import { DeckExchangeModal } from '@/app/shared/components/DeckExchangeModal';
import { ZoneBrowseModal } from '@/app/shared/components/ZoneBrowseModal';
import { useModalCardDrag } from '@/app/shared/hooks/useModalCardDrag';
import type { ZoneId } from '@/app/shared/types/gameCard';
import type { ZoneRect as GoldfishZoneRect } from '@/app/goldfish/layout/zoneLayout';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import DiceOverlay from './DiceOverlay';
import { getCardImageUrl as getSharedCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useVirtualCanvas, VIRTUAL_WIDTH, VIRTUAL_HEIGHT, virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import { useCardScale } from '@/app/shared/hooks/useCardScale';
import { CardScaleControl } from '@/app/shared/components/CardScaleControl';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

/** Sidebar zones that display as a pile with a count badge (not individual cards). */
const SIDEBAR_PILE_ZONES = ['deck', 'discard', 'reserve', 'banish', 'land-of-redemption'] as const;

/** Zones where cards are positioned freely (territory only). */
const FREE_FORM_ZONES = ['territory'] as const;
type FreeFormZone = (typeof FREE_FORM_ZONES)[number];

/** Zones where cards are auto-arranged in a horizontal strip. */
const AUTO_ARRANGE_ZONES = ['land-of-bondage'] as const;

/** All zone keys that can be a drop target. */
type DropZoneKey = string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  if (imgFile.startsWith('/')) return imgFile;
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

/**
 * Adapt a SpacetimeDB CardInstance row + counters into the GameCard shape
 * expected by GameCardNode.
 */
function cardInstanceToGameCard(
  card: CardInstance,
  counters: CardCounter[],
  owner: 'player1' | 'player2',
): GameCard {
  return {
    instanceId: String(card.id),
    cardName: card.cardName,
    cardSet: card.cardSet,
    cardImgFile: card.cardImgFile,
    type: card.cardType,
    brigade: card.brigade,
    strength: card.strength,
    toughness: card.toughness,
    specialAbility: card.specialAbility,
    identifier: card.identifier,
    alignment: card.alignment,
    isMeek: card.isMeek,
    isFlipped: card.isFlipped,
    isToken: false,
    zone: card.zone as GameCard['zone'],
    ownerId: owner,
    notes: card.notes,
    posX: card.posX ? parseFloat(card.posX) : undefined,
    posY: card.posY ? parseFloat(card.posY) : undefined,
    counters: counters.map((c) => ({
      color: c.color as Counter['color'],
      count: Number(c.count),
    })),
  };
}

/** Check if a point (px, py) is inside a ZoneRect. */
function pointInRect(px: number, py: number, rect: ZoneRect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

/** Determine if a zone key is a free-form zone (cards positioned at arbitrary x/y). */
function isFreeFormZone(zone: string): boolean {
  return zone === 'territory';
}

/** Determine if a zone key is an auto-arrange zone (horizontal strip layout). */
function isAutoArrangeZone(zone: string): boolean {
  return zone === 'land-of-bondage';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MultiplayerCanvasProps {
  gameId: bigint;
  onLoadDeck?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MultiplayerCanvas({ gameId, onLoadDeck }: MultiplayerCanvasProps) {
  const { setPreviewCard, isLoupeVisible } = useCardPreview();

  // ---- Container sizing (respects flex layout) ----
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY, containerWidth, containerHeight, virtualWidth } = useVirtualCanvas(containerRef);

  // ---- Game state ----
  const gameState = useGameState(gameId);
  const {
    myCards,
    opponentCards,
    counters,
    moveCard,
    moveCardsBatch,
    updateCardPosition,
    incomingSearchRequest,
    approvedSearchRequest,
    requestZoneSearch,
    approveZoneSearch,
    denyZoneSearch,
    completeZoneSearch,
    moveOpponentCard,
    zoneSearchRequests,
  } = gameState;

  // ---- Layout ----
  const mpLayout = useMemo(
    () => calculateMultiplayerLayout(virtualWidth, VIRTUAL_HEIGHT),
    [virtualWidth],
  );

  // Card scale preference
  const { cardScale, zoomIn, zoomOut, resetScale, MIN_SCALE, MAX_SCALE, STEP, setCardScale } = useCardScale();

  // Four-tier card dimensions (scaled)
  const rawMain = mpLayout?.mainCard ?? { cardWidth: 0, cardHeight: 0 };
  const cardWidth = Math.round(rawMain.cardWidth * cardScale);
  const cardHeight = Math.round(rawMain.cardHeight * cardScale);
  const rawLob = mpLayout?.lobCard ?? { cardWidth: 0, cardHeight: 0 };
  const lobCard = { cardWidth: Math.round(rawLob.cardWidth * cardScale), cardHeight: Math.round(rawLob.cardHeight * cardScale) };
  const rawOppHand = mpLayout?.opponentHandCard ?? { cardWidth: 0, cardHeight: 0 };
  const oppHandCard = { cardWidth: Math.round(rawOppHand.cardWidth * cardScale), cardHeight: Math.round(rawOppHand.cardHeight * cardScale) };
  const pileCardWidth = Math.round((mpLayout?.pileCard.cardWidth ?? 0) * cardScale);
  const pileCardHeight = Math.round((mpLayout?.pileCard.cardHeight ?? 0) * cardScale);

  const myZones: Record<string, ZoneRect> = useMemo(() => {
    if (!mpLayout) return {};
    return {
      territory: mpLayout.zones.playerTerritory,
      'land-of-bondage': mpLayout.zones.playerLob,
      'land-of-redemption': mpLayout.sidebar.player.lor!,
      banish: mpLayout.sidebar.player.banish!,
      reserve: mpLayout.sidebar.player.reserve!,
      deck: mpLayout.sidebar.player.deck!,
      discard: mpLayout.sidebar.player.discard!,
      ...(mpLayout.sidebar.player.paragon ? { paragon: mpLayout.sidebar.player.paragon } : {}),
    };
  }, [mpLayout]);

  const opponentZones: Record<string, ZoneRect> = useMemo(() => {
    if (!mpLayout) return {};
    return {
      territory: mpLayout.zones.opponentTerritory,
      'land-of-bondage': mpLayout.zones.opponentLob,
      'land-of-redemption': mpLayout.sidebar.opponent.lor!,
      banish: mpLayout.sidebar.opponent.banish!,
      reserve: mpLayout.sidebar.opponent.reserve!,
      deck: mpLayout.sidebar.opponent.deck!,
      discard: mpLayout.sidebar.opponent.discard!,
      ...(mpLayout.sidebar.opponent.paragon ? { paragon: mpLayout.sidebar.opponent.paragon } : {}),
    };
  }, [mpLayout]);

  const myHandRect = mpLayout?.zones.playerHand ?? null;
  const opponentHandRect = mpLayout?.zones.opponentHand ?? null;

  // ---- Stage ref ----
  const stageRef = useRef<Konva.Stage>(null);
  const gameLayerRef = useRef<Konva.Layer>(null);

  // Prevent browser-native drag on the canvas container
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container();
    const preventDrag = (e: Event) => e.preventDefault();
    container.addEventListener('dragstart', preventDrag);
    container.addEventListener('dragover', preventDrag);
    container.style.userSelect = 'none';
    container.style.webkitUserSelect = 'none';
    container.style.cursor = 'default';
    return () => {
      container.removeEventListener('dragstart', preventDrag);
      container.removeEventListener('dragover', preventDrag);
    };
  }, []);

  // ---- Image preloading ----
  const allImageUrls = useMemo(() => {
    const urls: string[] = [];
    const allCards = [
      ...Object.values(myCards).flat(),
      ...Object.values(opponentCards).flat(),
    ];
    for (const card of allCards) {
      if (card.cardImgFile && !card.isFlipped) {
        urls.push(getCardImageUrl(card.cardImgFile));
      }
    }
    return [...new Set(urls)];
  }, [myCards, opponentCards]);

  const { getImage } = useMultiplayerImagePreloader(allImageUrls);

  // Re-render once card back image loads
  const [, setCardBackVersion] = useState(0);
  useEffect(() => {
    if (cardBackLoaded) return;
    const onLoad = () => setCardBackVersion((v) => v + 1);
    cardBackListeners.push(onLoad);
    return () => {
      const idx = cardBackListeners.indexOf(onLoad);
      if (idx >= 0) cardBackListeners.splice(idx, 1);
    };
  }, []);

  // ---- Hover state ----
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<GameCard | null>(null);
  const [hoverProgress, setHoverProgress] = useState(0);
  const hoverAnimFrameRef = useRef<number | null>(null);
  const hoverStartTimeRef = useRef<number | null>(null);
  const HOVER_DURATION = 250;

  const startHoverAnimation = useCallback(() => {
    if (hoverAnimFrameRef.current) cancelAnimationFrame(hoverAnimFrameRef.current);
    hoverStartTimeRef.current = performance.now();
    const animate = () => {
      const elapsed = performance.now() - hoverStartTimeRef.current!;
      const progress = Math.min(elapsed / HOVER_DURATION, 1);
      setHoverProgress(progress);
      if (progress < 1) {
        hoverAnimFrameRef.current = requestAnimationFrame(animate);
      }
    };
    hoverAnimFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const stopHoverAnimation = useCallback(() => {
    if (hoverAnimFrameRef.current) {
      cancelAnimationFrame(hoverAnimFrameRef.current);
      hoverAnimFrameRef.current = null;
    }
    hoverStartTimeRef.current = null;
    setHoverProgress(0);
  }, []);

  // Propagate hoveredCard to the shared CardPreview context (drives CardLoupePanel)
  useEffect(() => {
    setPreviewCard(
      hoveredCard
        ? { cardName: hoveredCard.cardName, cardImgFile: hoveredCard.cardImgFile, isMeek: hoveredCard.isMeek }
        : null,
    );
  }, [hoveredCard, setPreviewCard]);

  // ---- Hand spread toggle (fan vs flat) ----
  const { isSpreadHand } = useSpreadHand();

  // ---- Card scale keyboard shortcuts (+/-) ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut]);

  // ---- Mouse position tracking for hover preview ----
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // Delayed hover — only show preview after 250ms of continuous hover
  const [hoverReady, setHoverReady] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Selection state (multi-select via marquee) ----
  const {
    selectedIds,
    isSelected,
    isSelectingRef,
    onRectChangeRef,
    startSelectionDrag,
    updateSelectionDrag,
    endSelectionDrag,
    toggleSelect,
    clearSelection,
  } = useSelectionState();

  const selectionRectRef = useRef<Konva.Rect | null>(null);
  const selectionLayerRef = useRef<Konva.Layer | null>(null);

  // Wire up imperative rect updates for the selection marquee
  onRectChangeRef.current = useCallback(
    (rect: { startX: number; startY: number; currentX: number; currentY: number } | null) => {
      const node = selectionRectRef.current;
      const layer = selectionLayerRef.current;
      if (!node || !layer) return;
      if (!rect) {
        node.visible(false);
        layer.batchDraw();
        return;
      }
      const w = Math.abs(rect.currentX - rect.startX);
      const h = Math.abs(rect.currentY - rect.startY);
      if (w < 8 && h < 8) {
        node.visible(false);
        layer.batchDraw();
        return;
      }
      node.visible(true);
      node.x(Math.min(rect.startX, rect.currentX));
      node.y(Math.min(rect.startY, rect.currentY));
      node.width(w);
      node.height(h);
      layer.batchDraw();
    },
    [],
  );

  // ---- Escape key clears selection ----
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedIds.size, clearSelection]);

  // ---- Context menu state ----
  const [contextMenu, setContextMenu] = useState<{
    card: GameCard; x: number; y: number;
  } | null>(null);
  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;
  const [multiCardContextMenu, setMultiCardContextMenu] = useState<{ x: number; y: number } | null>(null);

  // ---- Zone browse overlay state ----
  const [browseMyZone, setBrowseMyZone] = useState<string | null>(null);
  const [browseOpponentZone, setBrowseOpponentZone] = useState<{ zone: string; cards: typeof opponentCards[string]; label: string } | null>(null);
  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; spawnX: number; spawnY: number; targetPlayerId?: string } | null>(null);
  const [deckMenu, setDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [lorMenu, setLorMenu] = useState<{ x: number; y: number } | null>(null);
  const [deckDrop, setDeckDrop] = useState<{ x: number; y: number; cardId: string; batchIds?: string[] } | null>(null);
  const pendingBatchRef = useRef<string[] | null>(null);
  const [showDeckSearch, setShowDeckSearch] = useState(false);
  const [peekState, setPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number } | null>(null);
  const [exchangeCardIds, setExchangeCardIds] = useState<string[] | null>(null);
  const [opponentZoneMenu, setOpponentZoneMenu] = useState<{ x: number; y: number; zone: string; zoneName: string } | null>(null);
  const [opponentDeckMenu, setOpponentDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [opponentPeekState, setOpponentPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number } | null>(null);
  const [opponentRevealDismissed, setOpponentRevealDismissed] = useState(false);
  const [handMenu, setHandMenu] = useState<{ x: number; y: number } | null>(null);

  // ---- Multiplayer GameActions adapter ----
  const multiplayerActions: GameActions = useMemo(() => ({
    moveCard: (cardId, toZone, posX, posY) =>
      gameState.moveCard(BigInt(cardId), toZone, undefined, posX, posY),
    moveCardsBatch: (cardIds, toZone) =>
      gameState.moveCardsBatch(JSON.stringify(cardIds), toZone),
    flipCard: (cardId) => gameState.flipCard(BigInt(cardId)),
    meekCard: (cardId) => gameState.meekCard(BigInt(cardId)),
    unmeekCard: (cardId) => gameState.unmeekCard(BigInt(cardId)),
    addCounter: (cardId, color) => gameState.addCounter(BigInt(cardId), color),
    removeCounter: (cardId, color) => gameState.removeCounter(BigInt(cardId), color),
    shuffleCardIntoDeck: (cardId) => gameState.shuffleCardIntoDeck(BigInt(cardId)),
    shuffleDeck: () => gameState.shuffleDeck(),
    setNote: (cardId, text) => gameState.setNote(BigInt(cardId), text),
    exchangeCards: (cardIds) => gameState.exchangeCards(JSON.stringify(cardIds)),
    drawCard: () => gameState.drawCard(),
    drawMultiple: (count) => gameState.drawMultiple(BigInt(count)),
    moveCardToTopOfDeck: (cardId) => gameState.moveCardToTopOfDeck(BigInt(cardId)),
    moveCardToBottomOfDeck: (cardId) => gameState.moveCardToBottomOfDeck(BigInt(cardId)),
    spawnLostSoul: (testament, posX, posY) =>
      gameState.spawnLostSoul(testament, posX ?? '0.5', posY ?? '0.5'),
    removeToken: (cardId) => gameState.removeToken(BigInt(cardId)),
    removeOpponentToken: undefined,
    randomHandToZone: (count, toZone, deckPosition) =>
      gameState.randomHandToZone(count, toZone, deckPosition),
    reloadDeck: (deckId, deckData) => gameState.reloadDeck(deckId, deckData),
  }), [gameState]);

  // ---- ModalGameProvider value (for shared deck modals) ----
  const modalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: Object.fromEntries(
      Object.entries(myCards).map(([zone, cards]) => [
        zone,
        cards.map(c => cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1'))
      ])
    ),
    actions: {
      moveCard: (id, toZone, _idx, posX, posY) =>
        gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString()),
      moveCardsBatch: (ids, toZone) =>
        gameState.moveCardsBatch(JSON.stringify(ids), String(toZone)),
      moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
      moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
      shuffleDeck: () => gameState.shuffleDeck(),
      shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
    },
  }), [myCards, counters, gameState]);

  // ---- ModalGameProvider value for opponent deck modals (peek/search operate on opponent cards) ----
  const opponentModalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: Object.fromEntries(
      Object.entries(opponentCards).map(([zone, cards]) => [
        zone,
        cards.map(c => cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player2'))
      ])
    ),
    actions: {
      moveCard: (id, toZone, _idx, posX, posY) =>
        gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString()),
      moveCardsBatch: (ids, toZone) =>
        gameState.moveCardsBatch(JSON.stringify(ids), String(toZone)),
      moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
      moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
      shuffleDeck: () => gameState.shuffleDeck(),
      shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
    },
  }), [opponentCards, counters, gameState]);

  // ---- Close all menus helper ----
  const closeAllMenus = useCallback(() => {
    setContextMenu(null);
    setMultiCardContextMenu(null);
    setZoneMenu(null);
    setDeckMenu(null);
    setLorMenu(null);
    setDeckDrop(null);
    setShowDeckSearch(false);
    setPeekState(null);
    setExchangeCardIds(null);
    setBrowseMyZone(null);
    setBrowseOpponentZone(null);
    setOpponentZoneMenu(null);
    setOpponentDeckMenu(null);
    setOpponentPeekState(null);
    setHandMenu(null);
  }, []);

  // ---- moveDeckCardsToZone helper ----
  const moveDeckCardsToZone = useCallback((
    position: 'top' | 'bottom' | 'random',
    count: number,
    targetZone: string,
  ) => {
    const deckCards = [...(myCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof deckCards;
    if (position === 'top') selected = deckCards.slice(0, count);
    else if (position === 'bottom') selected = deckCards.slice(-count);
    else {
      const shuffled = [...deckCards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, count);
    }
    const ids = selected.map(c => String(c.id));
    if (ids.length > 0) multiplayerActions.moveCardsBatch(ids, targetZone);
  }, [myCards, multiplayerActions]);

  // ---- moveOpponentDeckCardsToZone helper (operates on opponent's deck) ----
  const moveOpponentDeckCardsToZone = useCallback((
    position: 'top' | 'bottom' | 'random',
    count: number,
    targetZone: string,
  ) => {
    const deckCards = [...(opponentCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof deckCards;
    if (position === 'top') selected = deckCards.slice(0, count);
    else if (position === 'bottom') selected = deckCards.slice(-count);
    else {
      const shuffled = [...deckCards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, count);
    }
    for (const card of selected) {
      gameState.moveCard(card.id, targetZone);
    }
  }, [opponentCards, gameState]);

  // ---- Drag state ----
  const isDraggingRef = useRef(false);
  const dragEndTimeRef = useRef<number>(0);
  const dragSourceZoneRef = useRef<string | null>(null);
  const dragOriginalPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragOriginalParentRef = useRef<Konva.Container | null>(null);
  const [dragHoverZone, setDragHoverZone] = useState<DropZoneKey | null>(null);
  const dragHoverZoneRef = useRef<DropZoneKey | null>(null);

  // Card node ref map for imperative multi-card drag
  const cardNodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const registerCardNode = useCallback((instanceId: string, node: Konva.Group | null) => {
    if (node) {
      cardNodeRefs.current.set(instanceId, node);
    } else {
      cardNodeRefs.current.delete(instanceId);
    }
  }, []);

  // Multi-card drag: offsets of follower cards relative to the dragged card
  const dragFollowerOffsets = useRef<Map<string, { dx: number; dy: number }> | null>(null);
  // Ghost image for multi-card drag
  const dragGhostRef = useRef<Konva.Image | null>(null);
  const dragGhostLayerRef = useRef<Konva.Layer | null>(null);
  const dragGhostOffsetRef = useRef<{ dx: number; dy: number } | null>(null);

  // ---- Zone hit-testing ----
  /**
   * Find which zone a point falls into, checking both player and opponent zones
   * plus hand zone. Priority: my zones first, then opponent free-form zones.
   */
  const findZoneAtPosition = useCallback(
    (x: number, y: number): { zone: DropZoneKey; owner: 'my' | 'opponent' } | null => {
      if (!mpLayout || !myHandRect) return null;

      // Check my hand zone
      if (pointInRect(x, y, myHandRect)) {
        return { zone: 'hand', owner: 'my' };
      }

      // Check opponent hand zone
      if (opponentHandRect && pointInRect(x, y, opponentHandRect)) {
        return { zone: 'hand', owner: 'opponent' };
      }

      // Check my zones (all: free-form + sidebar piles)
      for (const [key, rect] of Object.entries(myZones)) {
        if (pointInRect(x, y, rect)) {
          return { zone: key, owner: 'my' };
        }
      }

      // Check opponent free-form and auto-arrange zones — sandbox mode allows
      // dropping on opponent territory during battles
      for (const [key, rect] of Object.entries(opponentZones)) {
        if ((isFreeFormZone(key) || isAutoArrangeZone(key)) && pointInRect(x, y, rect)) {
          return { zone: key, owner: 'opponent' };
        }
      }

      // Check opponent sidebar zones too (e.g. dropping a lost soul in opp LOR)
      for (const [key, rect] of Object.entries(opponentZones)) {
        if (!isFreeFormZone(key) && !isAutoArrangeZone(key) && pointInRect(x, y, rect)) {
          return { zone: key, owner: 'opponent' };
        }
      }

      return null;
    },
    [mpLayout, myZones, opponentZones, myHandRect, opponentHandRect],
  );

  // ---- Modal card drag hook (for dragging cards from modals to canvas) ----
  const findZoneForModalDrag = useCallback((x: number, y: number): ZoneId | null => {
    const hit = findZoneAtPosition(x, y);
    if (!hit) return null;
    // Allow dropping on own zones, plus opponent territory/LOB for battles
    if (hit.owner === 'opponent' && !isFreeFormZone(hit.zone) && !isAutoArrangeZone(hit.zone)) return null;
    return hit.zone as ZoneId;
  }, [findZoneAtPosition]);

  const {
    dragState: modalDrag,
    startDrag: modalStartDrag,
    startMultiDrag: modalStartMultiDrag,
    ghostRef: modalGhostRef,
    didDragRef: modalDidDragRef,
  } = useModalCardDrag({
    stageRef,
    zoneLayout: myZones as Partial<Record<ZoneId, GoldfishZoneRect>>,
    findZoneAtPosition: findZoneForModalDrag,
    scale,
    offsetX,
    offsetY,
    moveCard: (id: string, toZone: ZoneId, _idx?: number, posX?: number, posY?: number) => {
      // Determine which player's zone was hit so we can normalize correctly
      const hit = posX != null && posY != null
        ? findZoneAtPosition(posX + cardWidth / 2, posY + cardHeight / 2)
        : null;
      const isOppZone = hit?.owner === 'opponent';
      const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];
      const ownerId = isOppZone && gameState.opponentPlayer
        ? String(gameState.opponentPlayer.id)
        : gameState.myPlayer ? String(gameState.myPlayer.id) : '';

      if (zone && posX != null && posY != null) {
        const rawX = (posX - zone.x) / zone.width;
        const rawY = (posY - zone.y) / zone.height;
        // Inverse-mirror for opponent zones (they render with 1-posX, 1-posY)
        const normX = isOppZone ? 1 - rawX : rawX;
        const normY = isOppZone ? 1 - rawY : rawY;
        gameState.moveCard(BigInt(id), String(toZone), undefined, normX.toString(), normY.toString(), ownerId);
      } else {
        gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString(), ownerId);
      }
    },
    moveCardsBatch: (ids: string[], toZone: ZoneId) =>
      gameState.moveCardsBatch(JSON.stringify(ids), String(toZone)),
    onDeckDrop: (cardId, screenX, screenY) => {
      // Defer so batch callback (called first) can store IDs
      pendingBatchRef.current = null;
      setTimeout(() => {
        setDeckDrop({ x: screenX, y: screenY, cardId, batchIds: pendingBatchRef.current ?? undefined });
      }, 0);
    },
    onBatchDeckDrop: (cardIds) => { pendingBatchRef.current = cardIds; },
    cardWidth,
    cardHeight,
  });

  // ---- Modal card drag hook for opponent browse (dragging opponent cards to zones) ----
  const findZoneForOpponentDrag = useCallback((x: number, y: number): ZoneId | null => {
    const hit = findZoneAtPosition(x, y);
    if (!hit) return null;
    return hit.zone as ZoneId;
  }, [findZoneAtPosition]);

  const {
    dragState: opponentModalDrag,
    startDrag: opponentModalStartDrag,
    ghostRef: opponentModalGhostRef,
    didDragRef: opponentModalDidDragRef,
  } = useModalCardDrag({
    stageRef,
    zoneLayout: { ...myZones, ...opponentZones } as Partial<Record<ZoneId, GoldfishZoneRect>>,
    findZoneAtPosition: findZoneForOpponentDrag,
    scale,
    offsetX,
    offsetY,
    moveCard: (id: string, toZone: ZoneId, _idx?: number, posX?: number, posY?: number) => {
      if (approvedSearchRequest) {
        // Determine which player's zone was hit so we can normalize correctly
        const hit = posX != null && posY != null
          ? findZoneAtPosition(posX + cardWidth / 2, posY + cardHeight / 2)
          : null;
        const isOppZone = hit?.owner === 'opponent';
        const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];

        let normX = posX?.toString();
        let normY = posY?.toString();
        if (zone && posX != null && posY != null) {
          const rawX = (posX - zone.x) / zone.width;
          const rawY = (posY - zone.y) / zone.height;
          // Inverse-mirror for opponent zones (they render with 1-posX, 1-posY)
          normX = (isOppZone ? 1 - rawX : rawX).toString();
          normY = (isOppZone ? 1 - rawY : rawY).toString();
        }
        moveOpponentCard(
          BigInt(approvedSearchRequest.id),
          BigInt(id),
          String(toZone),
          normX,
          normY
        );
      }
    },
    moveCardsBatch: (ids: string[], toZone: ZoneId) => {
      if (approvedSearchRequest) {
        for (const id of ids) {
          moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone));
        }
      }
    },
    cardWidth,
    cardHeight,
  });

  // ---- Track denied search requests for toast notification ----
  const pendingSearchRef = useRef<any>(null);

  useEffect(() => {
    const myPending = zoneSearchRequests?.find(
      (r: any) => r.requesterId === gameState.myPlayer?.id && r.status === 'pending'
    );
    if (pendingSearchRef.current && !myPending && !approvedSearchRequest) {
      const wasReveal = pendingSearchRef.current.zone === 'hand-reveal';
      showGameToast(wasReveal ? 'Reveal request denied' : 'Search request denied');
    }
    pendingSearchRef.current = myPending ?? null;
  }, [zoneSearchRequests, gameState.myPlayer, approvedSearchRequest]);

  // Auto-complete hand-reveal requests — no browse modal needed
  useEffect(() => {
    if (approvedSearchRequest && approvedSearchRequest.zone === 'hand-reveal') {
      completeZoneSearch(BigInt(approvedSearchRequest.id));
      showGameToast('Opponent revealed their hand');
    }
  }, [approvedSearchRequest, completeZoneSearch]);

  // ---- Peek card IDs for DeckPeekModal ----
  const peekCardIds = useMemo(() => {
    if (!peekState) return [];
    const sorted = [...(myCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof sorted;
    if (peekState.position === 'top') selected = sorted.slice(0, peekState.count);
    else if (peekState.position === 'bottom') selected = sorted.slice(-peekState.count);
    else {
      const shuffled = [...sorted];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, peekState.count);
    }
    return selected.map(c => String(c.id));
  }, [peekState, myCards]);

  // Broadcast revealed cards to opponent via SpacetimeDB
  const peekCardIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (peekCardIds.length > 0) {
      peekCardIdsRef.current = peekCardIds;
      gameState.revealCards(JSON.stringify(peekCardIds));
    }
  }, [peekCardIds]);

  // Opponent's revealed cards — driven by SpacetimeDB player.revealedCards
  const opponentRevealedCardIds = useMemo(() => {
    const raw = gameState.opponentPlayer?.revealedCards;
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }, [gameState.opponentPlayer?.revealedCards]);

  // Reset dismissed state when opponent reveals new cards
  useEffect(() => {
    if (opponentRevealedCardIds.length > 0) {
      setOpponentRevealDismissed(false);
    }
  }, [opponentRevealedCardIds]);

  const opponentPeekCardIds = useMemo(() => {
    if (!opponentPeekState) return [];
    const sorted = [...(opponentCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof sorted;
    if (opponentPeekState.position === 'top') selected = sorted.slice(0, opponentPeekState.count);
    else if (opponentPeekState.position === 'bottom') selected = sorted.slice(-opponentPeekState.count);
    else {
      const shuffled = [...sorted];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, opponentPeekState.count);
    }
    return selected.map(c => String(c.id));
  }, [opponentPeekState, opponentCards]);

  // ---- Drag handlers ----

  const handleCardDragStart = useCallback(
    (card: GameCard) => {
      isDraggingRef.current = true;
      dragSourceZoneRef.current = card.zone;

      // Store original position for snap-back
      const node = cardNodeRefs.current.get(card.instanceId);
      if (node) {
        dragOriginalPosRef.current = { x: node.x(), y: node.y() };

        // Move the card node to the layer root so it escapes any clip groups
        // and renders on top of all other zones during the drag.
        const layer = node.getLayer();
        if (layer && node.parent !== layer) {
          dragOriginalParentRef.current = node.parent as Konva.Container;
          node.moveTo(layer);
          node.moveToTop();
        } else {
          dragOriginalParentRef.current = null;
        }
      }

      // Clear hover state
      setHoveredInstanceId(null);
      setHoveredCard(null);
      setHoverReady(false);
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
      stopHoverAnimation();

      // Multi-card drag: build a rasterized ghost of follower cards
      if (selectedIds.has(card.instanceId) && selectedIds.size > 1) {
        const dragNode = cardNodeRefs.current.get(card.instanceId);
        if (dragNode) {
          const offsets = new Map<string, { dx: number; dy: number }>();
          const baseX = dragNode.x();
          const baseY = dragNode.y();

          const followers: { id: string; node: Konva.Group; dx: number; dy: number }[] = [];
          for (const id of selectedIds) {
            if (id === card.instanceId) continue;
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              const dx = fNode.x() - baseX;
              const dy = fNode.y() - baseY;
              offsets.set(id, { dx, dy });
              followers.push({ id, node: fNode, dx, dy });
            }
          }
          dragFollowerOffsets.current = offsets;

          if (followers.length > 0) {
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const f of followers) {
              minX = Math.min(minX, f.dx);
              minY = Math.min(minY, f.dy);
              maxX = Math.max(maxX, f.dx + cardWidth);
              maxY = Math.max(maxY, f.dy + cardHeight);
            }
            const ghostW = maxX - minX;
            const ghostH = maxY - minY;

            const offscreen = document.createElement('canvas');
            offscreen.width = ghostW * 2;
            offscreen.height = ghostH * 2;
            const ctx = offscreen.getContext('2d');
            if (ctx) {
              ctx.scale(2, 2);
              ctx.globalAlpha = 0.5;
              for (const f of followers) {
                const cardCanvas = f.node.toCanvas({ pixelRatio: 1 });
                ctx.drawImage(cardCanvas, f.dx - minX, f.dy - minY, cardWidth, cardHeight);
              }

              const ghostImage = new KonvaLib.Image({
                image: offscreen,
                x: baseX + minX,
                y: baseY + minY,
                width: ghostW,
                height: ghostH,
                listening: false,
                opacity: 1,
              }) as Konva.Image;

              const stage = stageRef.current;
              if (stage) {
                let ghostLayer = dragGhostLayerRef.current;
                if (!ghostLayer) {
                  ghostLayer = new KonvaLib.Layer({ listening: false }) as Konva.Layer;
                  dragGhostLayerRef.current = ghostLayer;
                  stage.add(ghostLayer);
                }
                ghostLayer.scaleX(scale);
                ghostLayer.scaleY(scale);
                ghostLayer.x(offsetX);
                ghostLayer.y(offsetY);
                ghostLayer.add(ghostImage);
                ghostLayer.moveToTop();
                ghostLayer.batchDraw();
                dragGhostRef.current = ghostImage;
              }

              // Hide follower nodes
              for (const f of followers) {
                f.node.visible(false);
              }
              dragNode.getLayer()?.batchDraw();
            }
          }
        }
      } else {
        dragFollowerOffsets.current = null;
      }
    },
    [selectedIds, cardWidth, cardHeight, stopHoverAnimation, scale, offsetX, offsetY],
  );

  const handleCardDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;

      // Keep the dragged card at the Layer root so it renders above all
      // zone clip-groups (territory, LOB, etc.). React re-renders (e.g.
      // from zone-highlight state changes) can reconcile the node back
      // into its original parent group, which resets z-ordering.
      const layer = node.getLayer();
      if (layer && node.parent !== layer) {
        node.moveTo(layer);
        node.moveToTop();
      }

      // Clamp card position to virtual canvas bounds
      const clampedX = Math.max(-cardWidth / 2, Math.min(node.x(), virtualWidth - cardWidth / 2));
      const clampedY = Math.max(-cardHeight / 2, Math.min(node.y(), VIRTUAL_HEIGHT - cardHeight / 2));
      if (clampedX !== node.x() || clampedY !== node.y()) {
        node.x(clampedX);
        node.y(clampedY);
      }

      const x = node.x();
      const y = node.y();
      // For rotation=180 cards (opponent territory), the node position is
      // the bottom-right corner, so compute center accordingly.
      const rot = (node as Konva.Group).rotation?.() ?? 0;
      const isRotated = Math.abs(rot) > 90;
      const centerX = isRotated ? x - cardWidth / 2 : x + cardWidth / 2;
      const centerY = isRotated ? y - cardHeight / 2 : y + cardHeight / 2;
      const hit = findZoneAtPosition(centerX, centerY);
      const zoneKey = hit ? `${hit.owner}:${hit.zone}` : null;

      // Only trigger re-render when hovered zone changes
      if (zoneKey !== dragHoverZoneRef.current) {
        dragHoverZoneRef.current = zoneKey;
        setDragHoverZone(zoneKey);
      }

      // Move ghost for multi-card drag
      const ghost = dragGhostRef.current;
      if (ghost) {
        if (!dragGhostOffsetRef.current) {
          dragGhostOffsetRef.current = {
            dx: ghost.x() - x,
            dy: ghost.y() - y,
          };
        }
        ghost.x(x + dragGhostOffsetRef.current.dx);
        ghost.y(y + dragGhostOffsetRef.current.dy);
        dragGhostLayerRef.current?.batchDraw();
      }
    },
    [findZoneAtPosition, cardWidth, cardHeight],
  );

  const handleCardDragEnd = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => {
      const followerOffsets = dragFollowerOffsets.current;
      const originalPos = dragOriginalPosRef.current;
      const sourceZone = dragSourceZoneRef.current;
      const originalParent = dragOriginalParentRef.current;

      // Reset drag state
      isDraggingRef.current = false;
      dragEndTimeRef.current = performance.now();
      dragSourceZoneRef.current = null;
      dragOriginalPosRef.current = null;
      dragOriginalParentRef.current = null;
      dragHoverZoneRef.current = null;
      dragFollowerOffsets.current = null;
      dragGhostOffsetRef.current = null;
      setDragHoverZone(null);

      // Clean up ghost image
      if (dragGhostRef.current) {
        dragGhostRef.current.destroy();
        dragGhostRef.current = null;
        dragGhostLayerRef.current?.batchDraw();
      }
      // NOTE: Follower visibility is NOT restored here. Instead it is
      // restored later based on the drop outcome so that followers appear
      // at the correct position (avoiding the jump-back visual glitch).

      const node = e.target;
      const dropX = node.x();
      const dropY = node.y();
      // For rotation=180 cards (opponent territory), the node position is
      // the bottom-right corner, so compute center accordingly.
      const dropRot = (node as Konva.Group).rotation?.() ?? 0;
      const isDropRotated = Math.abs(dropRot) > 90;
      const centerX = isDropRotated ? dropX - cardWidth / 2 : dropX + cardWidth / 2;
      const centerY = isDropRotated ? dropY - cardHeight / 2 : dropY + cardHeight / 2;
      const hit = findZoneAtPosition(centerX, centerY);

      const isGroupDrag = selectedIds.has(card.instanceId) && selectedIds.size > 1;
      const cardIds = isGroupDrag ? Array.from(selectedIds) : [card.instanceId];
      const cardId = BigInt(card.instanceId);

      // Restore the dragged node to its original parent (clip group) so that
      // react-konva reconciliation doesn't create an orphaned duplicate.
      // This must happen after reading dropX/dropY but before any state updates
      // that would trigger a re-render.
      if (originalParent && node.parent !== originalParent) {
        node.moveTo(originalParent);
      }

      // Helper to snap back to original position
      const snapBack = () => {
        if (originalPos) {
          node.x(originalPos.x);
          node.y(originalPos.y);
          node.getLayer()?.batchDraw();
        }
      };

      if (!hit) {
        // No valid drop zone — snap back; restore followers at original positions
        if (followerOffsets) {
          for (const [id] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) fNode.visible(true);
          }
        }
        snapBack();
        return;
      }

      const targetZone = hit.zone;
      // Same zone = same zone name AND same owner (my hand ≠ opponent hand)
      const sourceOwner = card.ownerId === 'player1' ? 'my' : 'opponent';
      const isSameZone = targetZone === sourceZone && hit.owner === sourceOwner;

      // Resolve the zone rect for the drop target so we can store normalized positions
      // (0–1 ratios). This ensures cards render at the correct proportional position
      // regardless of each player's screen/window size.
      const zoneRect = hit.owner === 'my' ? myZones[targetZone] : opponentZones[targetZone];
      const zoneOffX = zoneRect?.x ?? 0;
      const zoneOffY = zoneRect?.y ?? 0;
      const zoneW = zoneRect?.width || 1;
      const zoneH = zoneRect?.height || 1;
      // Resolve target owner ID — always set to the target zone's owner so
      // cards transfer ownership when moving between players' zones.
      const targetOwnerId = hit.owner === 'my' && gameState.myPlayer
        ? String(gameState.myPlayer.id)
        : hit.owner === 'opponent' && gameState.opponentPlayer
        ? String(gameState.opponentPlayer.id)
        : '';

      // Opponent zones render with mirrored positions (1-posX, 1-posY).
      // When dropping into an opponent zone, inverse-mirror so the card
      // appears where it was visually dropped, not at the mirrored position.
      const isOpponentTarget = hit.owner === 'opponent';

      // Adjust drop position when rotation changes between source and target.
      // Opponent territory cards render with rotation=180 (anchor at bottom-right),
      // player territory cards render with rotation=0 (anchor at top-left).
      // When crossing between them, offset by card dimensions so the visual
      // position stays consistent.
      const sourceIsRotated = sourceOwner === 'opponent' && isFreeFormZone(sourceZone ?? '');
      const targetIsRotated = isOpponentTarget && isFreeFormZone(targetZone);
      let adjDropX = dropX;
      let adjDropY = dropY;
      if (sourceIsRotated && !targetIsRotated) {
        // rotation 180→0: shift anchor from bottom-right to top-left
        adjDropX -= cardWidth;
        adjDropY -= cardHeight;
      } else if (!sourceIsRotated && targetIsRotated) {
        // rotation 0→180: shift anchor from top-left to bottom-right
        adjDropX += cardWidth;
        adjDropY += cardHeight;
      }

      // Helper: normalize pixel position to 0–1 and apply opponent mirror if needed
      const normX = (px: number) => {
        const raw = (px - zoneOffX) / zoneW;
        return isOpponentTarget ? 1 - raw : raw;
      };
      const normY = (py: number) => {
        const raw = (py - zoneOffY) / zoneH;
        return isOpponentTarget ? 1 - raw : raw;
      };

      // Same free-form zone: just update position
      if (isSameZone && isFreeFormZone(targetZone)) {
        if (isGroupDrag) {
          // Move follower nodes to their drop positions so they appear
          // exactly where the ghost image was — no jump-back flicker.
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              const fNode = cardNodeRefs.current.get(id);
              if (fNode) {
                fNode.x(dropX + offset.dx);
                fNode.y(dropY + offset.dy);
                fNode.visible(true);
              }
            }
          }
          // Build positions for batch move (normalized 0–1)
          const positions: Record<string, { posX: number; posY: number }> = {
            [card.instanceId]: { posX: normX(dropX), posY: normY(dropY) },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              positions[id] = { posX: normX(dropX + offset.dx), posY: normY(dropY + offset.dy) };
            }
          }
          moveCardsBatch(
            JSON.stringify(cardIds),
            targetZone,
            JSON.stringify(positions),
          );
          clearSelection();
        } else {
          updateCardPosition(cardId, String(normX(dropX)), String(normY(dropY)));
        }
        return;
      }

      // Same non-free-form zone — snap back (no meaningful action)
      if (isSameZone && !isFreeFormZone(targetZone)) {
        if (followerOffsets) {
          for (const [id] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) fNode.visible(true);
          }
        }
        snapBack();
        return;
      }

      // Different zone — perform move
      // Hide dragged card to avoid visual flicker while state updates
      if (!isFreeFormZone(targetZone) && !isAutoArrangeZone(targetZone)) {
        let cardGroup: Konva.Node | null = node;
        while (cardGroup && !cardGroup.draggable?.()) {
          cardGroup = cardGroup.parent;
        }
        if (cardGroup) {
          cardGroup.visible(false);
          cardGroup.getLayer()?.batchDraw();
        }
      }

      if (isGroupDrag) {
        if (targetZone === 'deck') {
          // Show deck drop popup for batch
          const stage = stageRef.current;
          if (stage) {
            const screenPos = virtualToScreen(centerX, centerY, scale, offsetX, offsetY);
            pendingBatchRef.current = cardIds;
            setDeckDrop({
              x: screenPos.x,
              y: screenPos.y,
              cardId: cardIds[0],
              batchIds: cardIds,
            });
          } else {
            moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
          }
        } else if (isFreeFormZone(targetZone)) {
          const positions: Record<string, { posX: number; posY: number }> = {
            [card.instanceId]: { posX: normX(adjDropX), posY: normY(adjDropY) },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              positions[id] = { posX: normX(adjDropX + offset.dx), posY: normY(adjDropY + offset.dy) };
            }
          }
          moveCardsBatch(
            JSON.stringify(cardIds),
            targetZone,
            JSON.stringify(positions),
            targetOwnerId,
          );
        } else {
          moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
        }
        clearSelection();
      } else if (isFreeFormZone(targetZone)) {
        moveCard(cardId, targetZone, '', String(normX(adjDropX)), String(normY(adjDropY)), targetOwnerId);
      } else if (isAutoArrangeZone(targetZone)) {
        // Auto-arrange zone: positions are ignored by rendering
        moveCard(cardId, targetZone, '', '0', '0', targetOwnerId);
      } else if (targetZone === 'deck') {
        const stage = stageRef.current;
        if (stage) {
          const screenPos = virtualToScreen(centerX, centerY, scale, offsetX, offsetY);
          setDeckDrop({
            x: screenPos.x,
            y: screenPos.y,
            cardId: String(cardId),
          });
        } else {
          moveCard(cardId, targetZone, '0', undefined, undefined, targetOwnerId);
        }
      } else {
        // Stacked zone
        moveCard(cardId, targetZone, '0', undefined, undefined, targetOwnerId);
      }
    },
    [
      findZoneAtPosition,
      moveCard,
      moveCardsBatch,
      updateCardPosition,
      cardWidth,
      cardHeight,
      selectedIds,
      clearSelection,
      myZones,
      opponentZones,
      gameState.myPlayer,
      gameState.opponentPlayer,
      scale,
      offsetX,
      offsetY,
    ],
  );

  // Noop handlers for non-draggable cards
  const noopDrag = useCallback((_e: Konva.KonvaEventObject<DragEvent>) => {}, []);
  const noopCardDrag = useCallback((_card: GameCard) => {}, []);
  const noopCardDragEnd = useCallback(
    (_card: GameCard, _e: Konva.KonvaEventObject<DragEvent>) => {},
    [],
  );
  const noopOpponentContextMenu = useCallback(
    (_card: GameCard, _e: Konva.KonvaEventObject<PointerEvent>) => {},
    [],
  );

  // Universal card click handler — shift-click toggles selection
  const handleCardClick = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.shiftKey) {
        toggleSelect(card.instanceId);
        return;
      }
      if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
        clearSelection();
      }
    },
    [selectedIds, clearSelection, toggleSelect],
  );

  const handleCardContextMenu = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();

      // Clear hover state — dismiss both the glow AND the preview tooltip
      setHoveredInstanceId(null);
      setHoveredCard(null);
      setHoverReady(false);
      stopHoverAnimation();

      // Use viewport coordinates (clientX/Y) for fixed-position context menus
      const menuX = e.evt.clientX;
      const menuY = e.evt.clientY;

      // If right-clicking a selected card with multi-selection, show multi-card menu
      if (selectedIds.has(card.instanceId) && selectedIds.size > 1) {
        setMultiCardContextMenu({ x: menuX, y: menuY });
      } else {
        // Clear selection if right-clicking an unselected card
        if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
          clearSelection();
        }
        setContextMenu({ card, x: menuX, y: menuY });
      }
    },
    [stopHoverAnimation, selectedIds, clearSelection],
  );
  // Double-click toggles meek on your own cards
  const handleDblClick = useCallback((card: GameCard) => {
    if (card.ownerId !== 'player1') return; // only your own cards
    if (card.isMeek) {
      multiplayerActions.unmeekCard(card.instanceId);
    } else {
      multiplayerActions.meekCard(card.instanceId);
    }
  }, [multiplayerActions]);
  const noopDblClick = useCallback((_card: GameCard) => {}, []);

  const handleMouseEnter = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isDraggingRef.current) return;
      // Ignore Konva re-firing mouseEnter immediately after a drag ends
      if (performance.now() - dragEndTimeRef.current < 100) return;
      setHoveredInstanceId(card.instanceId);
      startHoverAnimation();

      // Don't show card preview for face-down opponent cards (hidden info)
      if (card.isFlipped && card.ownerId === 'player2') {
        setHoveredCard(null);
        return;
      }

      setHoveredCard(card);
      // Capture mouse position for the hover preview tooltip
      const pos = { x: e.evt.clientX, y: e.evt.clientY };
      mousePosRef.current = pos;
      setMousePos(pos);
      // Start 250ms delay before showing hover preview
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setHoverReady(false);
      hoverTimerRef.current = setTimeout(() => setHoverReady(true), 250);
    },
    [startHoverAnimation],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredInstanceId(null);
    setHoveredCard(null);
    stopHoverAnimation();
    // Clear hover preview delay
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverReady(false);
  }, [stopHoverAnimation]);

  // ---- Adapter: get GameCard for a CardInstance ----
  const adaptCard = useCallback(
    (card: CardInstance, owner: 'player1' | 'player2'): GameCard => {
      const cardCounters = counters.get(card.id) ?? [];
      return cardInstanceToGameCard(card, cardCounters, owner);
    },
    [counters],
  );

  // ---- Card bounds for marquee selection (my free-form + hand cards) ----
  const allCardBounds = useMemo((): CardBound[] => {
    if (!mpLayout || !myHandRect) return [];
    const bounds: CardBound[] = [];

    // My free-form zone cards
    for (const zoneKey of FREE_FORM_ZONES) {
      const cards = myCards[zoneKey] ?? [];
      for (const card of cards) {
        const zone = myZones[zoneKey];
        const zoneX = zone?.x ?? 0;
        const zoneY = zone?.y ?? 0;
        const x = card.posX ? parseFloat(card.posX) * (zone?.width ?? 0) + zoneX : zoneX + 20;
        const y = card.posY ? parseFloat(card.posY) * (zone?.height ?? 0) + zoneY : zoneY + 24;
        bounds.push({
          instanceId: String(card.id),
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          rotation: 0,
        });
      }
    }

    // My auto-arrange zone cards (LOB)
    for (const zoneKey of AUTO_ARRANGE_ZONES) {
      const cards = myCards[zoneKey] ?? [];
      const zone = myZones[zoneKey];
      if (cards.length > 0 && zone) {
        const positions = calculateAutoArrangePositions(cards.length, zone, lobCard.cardWidth, lobCard.cardHeight);
        cards.forEach((card, i) => {
          const pos = positions[i];
          if (pos) {
            bounds.push({
              instanceId: String(card.id),
              x: pos.x,
              y: pos.y,
              width: lobCard.cardWidth,
              height: lobCard.cardHeight,
              rotation: 0,
            });
          }
        });
      }
    }

    // My hand cards
    const handCards = myCards['hand'] ?? [];
    if (handCards.length > 0) {
      const positions = calculateHandPositions(
        handCards.length,
        myHandRect,
        cardWidth,
        cardHeight,
        isSpreadHand,
      );
      handCards.forEach((card, i) => {
        const pos = positions[i];
        if (pos) {
          bounds.push({
            instanceId: String(card.id),
            x: pos.x,
            y: pos.y,
            width: cardWidth,
            height: cardHeight,
            rotation: pos.rotation,
          });
        }
      });
    }

    return bounds;
  }, [mpLayout, myHandRect, myZones, myCards, cardWidth, cardHeight, lobCard, isSpreadHand]);

  // ---- Stage mouse handlers for marquee selection ----
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return;

      // Only start selection on empty canvas (not on cards)
      const target = e.target;
      let ancestor: Konva.Node | null = target.parent;
      let isCard = false;
      while (ancestor && ancestor !== stageRef.current) {
        if (ancestor.draggable?.()) {
          isCard = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (isCard) return;

      if (!e.evt.shiftKey && selectedIds.size > 0) {
        clearSelection();
      }

      const layer = gameLayerRef.current;
      if (!layer) return;
      const pos = layer.getRelativePointerPosition();
      if (!pos) return;
      startSelectionDrag(pos.x, pos.y, e.evt.shiftKey);
    },
    [selectedIds.size, clearSelection, startSelectionDrag],
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Track mouse position for hover preview tooltip
      const clientPos = { x: e.evt.clientX, y: e.evt.clientY };
      mousePosRef.current = clientPos;
      if (hoveredCard) {
        setMousePos(clientPos);
      }

      if (!isSelectingRef.current) return;
      // Cancel selection if a card drag started
      if (isDraggingRef.current) {
        isSelectingRef.current = false;
        onRectChangeRef.current?.(null);
        return;
      }
      const layer = gameLayerRef.current;
      if (!layer) return;
      const pos = layer.getRelativePointerPosition();
      if (pos) {
        updateSelectionDrag(pos.x, pos.y, allCardBounds, e.evt.shiftKey);
      }
    },
    [updateSelectionDrag, allCardBounds, isSelectingRef, onRectChangeRef, hoveredCard],
  );

  const handleStageMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isSelectingRef.current) return;
      endSelectionDrag(e.evt.shiftKey);
    },
    [endSelectionDrag, isSelectingRef],
  );

  // ---- Don't render canvas content until we have dimensions and layout ----
  // NOTE: The container div MUST always render so the ref gets attached and
  // ResizeObserver can measure it. Only the Stage content is gated.
  if (containerWidth === 0 || containerHeight === 0 || !mpLayout || !myHandRect || !opponentHandRect) {
    return (
      <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }} />
    );
  }

  // ---- Helper: get image for a CardInstance ----
  const getCardImage = (card: CardInstance): HTMLImageElement | undefined => {
    if (!card.cardImgFile || card.isFlipped) return undefined;
    const url = getCardImageUrl(card.cardImgFile);
    return getImage(url) ?? undefined;
  };

  // All sidebar pile zone keys
  const SIDEBAR_ZONES = SIDEBAR_PILE_ZONES;

  // Build combined zone rect map for drag highlight overlay
  const allZoneRects: { key: string; rect: ZoneRect; owner: 'my' | 'opponent' }[] = [];
  for (const [key, rect] of Object.entries(myZones)) {
    allZoneRects.push({ key: `my:${key}`, rect, owner: 'my' });
  }
  allZoneRects.push({ key: 'my:hand', rect: myHandRect, owner: 'my' });
  for (const [key, rect] of Object.entries(opponentZones)) {
    allZoneRects.push({ key: `opponent:${key}`, rect, owner: 'opponent' });
  }
  if (opponentHandRect) {
    allZoneRects.push({ key: 'opponent:hand', rect: opponentHandRect, owner: 'opponent' });
  }

  return (
    <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <Stage
        ref={stageRef}
        width={containerWidth}
        height={containerHeight}
        pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
        onContextMenu={(e) => e.evt.preventDefault()}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        {/* Game layer — all content in 1920x1080 virtual coords */}
        <Layer
          ref={gameLayerRef as any}
          scaleX={scale}
          scaleY={scale}
          x={offsetX}
          y={offsetY}
        >
          {/* ================================================================
              Zone backgrounds — My zones
              ================================================================ */}
          {Object.entries(myZones).map(([key, zone]) => {
            // LOB + territory zones get their label+badge rendered as an overlay after cards
            const isLob = isAutoArrangeZone(key);
            const isFreeForm = isFreeFormZone(key);
            const skipLabel = isLob || isFreeForm;
            const cardsInZone = myCards[key] ?? [];
            // Approximate label width: ~7px per uppercase char at fontSize 11 + letterSpacing 1
            const labelTextWidth = zone.label.toUpperCase().length * 7;
            return (
              <Group key={`my-${key}`}>
                <Rect
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  fill="#1e1610"
                  stroke="#6b4e27"
                  strokeWidth={1}
                  cornerRadius={3}
                  opacity={0.45}
                  onContextMenu={isLob ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                    e.evt.preventDefault();
                    // Compute spawn position as normalized 0-1 within the LOB zone
                    const layer = gameLayerRef.current;
                    const pointer = layer?.getRelativePointerPosition();
                    const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
                    const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
                    setZoneMenu({ x: e.evt.clientX, y: e.evt.clientY, spawnX, spawnY });
                  } : undefined}
                />
                {/* Label + badge — skip for LOB/territory zones (rendered as overlay after cards) */}
                {!skipLabel && (
                  <>
                    <Text
                      x={zone.x + 6}
                      y={zone.y + 4}
                      text={zone.label.toUpperCase()}
                      fontSize={11}
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e8d5a3"
                      letterSpacing={1}
                      width={zone.width - 12}
                      ellipsis
                    />
                  </>
                )}
                {/* Ghost text for empty territory */}
              </Group>
            );
          })}

          {/* ================================================================
              Zone backgrounds — Opponent zones
              ================================================================ */}
          {Object.entries(opponentZones).map(([key, zone]) => {
            const isLob = isAutoArrangeZone(key);
            const isFreeForm = isFreeFormZone(key);
            const skipLabel = isLob || isFreeForm;
            const cardsInZone = opponentCards[key] ?? [];
            const labelTextWidth = zone.label.toUpperCase().length * 7;
            return (
              <Group key={`opp-${key}`}>
                <Rect
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  fill="#10141e"
                  stroke="#27456b"
                  strokeWidth={1}
                  cornerRadius={3}
                  opacity={0.45}
                  onContextMenu={isLob ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                    e.evt.preventDefault();
                    const layer = gameLayerRef.current;
                    const pointer = layer?.getRelativePointerPosition();
                    const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
                    const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
                    const oppId = gameState.opponentPlayer?.id;
                    setZoneMenu({ x: e.evt.clientX, y: e.evt.clientY, spawnX, spawnY, targetPlayerId: oppId != null ? String(oppId) : undefined });
                  } : undefined}
                />
                {/* Label + badge — skip for LOB/territory zones (rendered as overlay after cards) */}
                {!skipLabel && (
                  <>
                    <Text
                      x={zone.x + 6}
                      y={zone.y + 4}
                      text={zone.label.toUpperCase()}
                      fontSize={11}
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#a3c5e8"
                      letterSpacing={1}
                      width={zone.width - 12}
                      ellipsis
                    />
                  </>
                )}
                {/* Ghost text for empty territory */}
              </Group>
            );
          })}

          {/* ================================================================
              Hand zone backgrounds
              ================================================================ */}
          {/* My hand */}
          <Rect
            x={myHandRect.x}
            y={myHandRect.y}
            width={myHandRect.width}
            height={VIRTUAL_HEIGHT - myHandRect.y}
            fill="#0d0905"
            opacity={0.5}
            onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              const stage = stageRef.current;
              if (!stage) return;
              const container = stage.container().getBoundingClientRect();
              closeAllMenus();
              setHandMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
              });
            }}
          />
          <Text
            x={myHandRect.x + 8}
            y={myHandRect.y + 4}
            text="HAND"
            fontSize={12}
            fontFamily="Cinzel, Georgia, serif"
            fill="#e8d5a3"
            letterSpacing={2}
          />
          <Group x={myHandRect.x + 60} y={myHandRect.y + 2}>
            <Rect width={26} height={18} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
            <Text
              text={String(myCards['hand']?.length ?? 0)}
              fontSize={12}
              fontStyle="bold"
              fill="#e8d5a3"
              width={26}
              height={18}
              align="center"
              verticalAlign="middle"
            />
          </Group>

          {/* Opponent hand */}
          <Rect
            x={opponentHandRect.x}
            y={opponentHandRect.y}
            width={opponentHandRect.width}
            height={opponentHandRect.height}
            fill="#050911"
            opacity={0.5}
            onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              closeAllMenus();
              setOpponentZoneMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
                zone: 'hand',
                zoneName: 'Hand',
              });
            }}
          />
          <Text
            x={opponentHandRect.x + 8}
            y={opponentHandRect.y + 4}
            text="OPPONENT HAND"
            fontSize={12}
            fontFamily="Cinzel, Georgia, serif"
            fill="#a3c5e8"
            letterSpacing={2}
          />
          <Group x={opponentHandRect.x + 160} y={opponentHandRect.y + 2}>
            <Rect width={26} height={18} fill="#101828" cornerRadius={4} stroke="#4a7ab5" strokeWidth={1} />
            <Text
              text={String(opponentCards['hand']?.length ?? 0)}
              fontSize={12}
              fontStyle="bold"
              fill="#a3c5e8"
              width={26}
              height={18}
              align="center"
              verticalAlign="middle"
            />
          </Group>

          {/* ================================================================
              Cards in free-form zones — My territory (draggable, clipped)
              ================================================================ */}
          {FREE_FORM_ZONES.map((zoneKey) => {
            const cards = myCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = myZones[zoneKey];
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            return (
              <Group
                key={`my-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? VIRTUAL_WIDTH}
                clipHeight={zone?.height ?? VIRTUAL_HEIGHT}
              >
                {sorted.map((card) => {
                  const gameCard = adaptCard(card, 'player1');
                  const myZone = myZones[zoneKey];
                  const zoneX = myZone?.x ?? 0;
                  const zoneY = myZone?.y ?? 0;
                  const x = card.posX ? parseFloat(card.posX) * (myZone?.width ?? 0) + zoneX : zoneX + 20;
                  const y = card.posY ? parseFloat(card.posY) * (myZone?.height ?? 0) + zoneY : zoneY + 24;
                  return (
                    <GameCardNode
                      key={String(card.id)}
                      card={gameCard}
                      x={x}
                      y={y}
                      rotation={0}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getCardImage(card)}
                      isSelected={isSelected(String(card.id))}
                      isDraggable={true}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onClick={handleCardClick}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onDblClick={handleDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })}

          {/* ================================================================
              Cards in free-form zones — Opponent territory (draggable)
              ================================================================ */}
          {FREE_FORM_ZONES.map((zoneKey) => {
            const cards = opponentCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = opponentZones[zoneKey];
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            return (
              <Group
                key={`opp-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? VIRTUAL_WIDTH}
                clipHeight={zone?.height ?? VIRTUAL_HEIGHT}
              >
                {sorted.map((card) => {
                  const gameCard = adaptCard(card, 'player2');
                  const oppZone = opponentZones[zoneKey];
                  const zoneX = oppZone?.x ?? 0;
                  const zoneY = oppZone?.y ?? 0;
                  const zoneW = oppZone?.width ?? 0;
                  const zoneH = oppZone?.height ?? 0;
                  // Mirror opponent positions: flip both axes so their board
                  // appears rotated 180° (as if sitting across the table).
                  // With rotation=180, Konva renders the card extending LEFT and UP
                  // from (x,y), so the visible rectangle is (x-cardW, y-cardH) to (x,y).
                  // No additional offset needed — the rotation pivot handles it.
                  const mirroredPosX = card.posX ? 1 - parseFloat(card.posX) : 0;
                  const mirroredPosY = card.posY ? 1 - parseFloat(card.posY) : 0;
                  const x = mirroredPosX * zoneW + zoneX;
                  const y = mirroredPosY * zoneH + zoneY;
                  return (
                    <GameCardNode
                      key={String(card.id)}
                      card={gameCard}
                      x={x}
                      y={y}
                      rotation={180}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getCardImage(card)}
                      isSelected={isSelected(String(card.id))}
                      isDraggable={true}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onClick={handleCardClick}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onDblClick={noopDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })}

          {/* ================================================================
              Cards in auto-arrange zones — My LOB (draggable, horizontal strip)
              ================================================================ */}
          {AUTO_ARRANGE_ZONES.map((zoneKey) => {
            const cards = myCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = myZones[zoneKey];
            if (!zone) return null;
            const positions = calculateAutoArrangePositions(cards.length, zone, lobCard.cardWidth, lobCard.cardHeight);
            return (
              <Group key={`my-auto-${zoneKey}`} clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                {cards.map((card, i) => {
                  const gameCard = adaptCard(card, 'player1');
                  const pos = positions[i];
                  if (!pos) return null;
                  return (
                    <GameCardNode
                      key={String(card.id)}
                      card={gameCard}
                      x={pos.x}
                      y={pos.y}
                      rotation={0}
                      cardWidth={lobCard.cardWidth}
                      cardHeight={lobCard.cardHeight}
                      image={getCardImage(card)}
                      isSelected={isSelected(String(card.id))}
                      isDraggable={true}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onClick={handleCardClick}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onDblClick={handleDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })}

          {/* ================================================================
              Cards in auto-arrange zones — Opponent LOB (NOT draggable, horizontal strip)
              ================================================================ */}
          {AUTO_ARRANGE_ZONES.map((zoneKey) => {
            const cards = opponentCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = opponentZones[zoneKey];
            if (!zone) return null;
            const positions = calculateAutoArrangePositions(cards.length, zone, lobCard.cardWidth, lobCard.cardHeight);
            return (
              <Group key={`opp-auto-${zoneKey}`} clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                {cards.map((card, i) => {
                  const gameCard = adaptCard(card, 'player2');
                  const pos = positions[i];
                  if (!pos) return null;
                  return (
                    <GameCardNode
                      key={String(card.id)}
                      card={gameCard}
                      x={pos.x + lobCard.cardWidth}
                      y={pos.y + lobCard.cardHeight}
                      rotation={180}
                      cardWidth={lobCard.cardWidth}
                      cardHeight={lobCard.cardHeight}
                      image={getCardImage(card)}
                      isSelected={false}
                      isDraggable={false}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      onDragStart={noopCardDrag}
                      onDragMove={noopDrag}
                      onDragEnd={noopCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onDblClick={noopDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })}

          {/* ================================================================
              LOB label overlays — rendered AFTER cards so labels sit on top
              ================================================================ */}
          {(() => {
            const lobEntries: { zone: typeof myZones[string]; isOpponent: boolean }[] = [];
            const myLob = myZones['land-of-bondage'];
            const oppLob = opponentZones['land-of-bondage'];
            if (myLob) lobEntries.push({ zone: myLob, isOpponent: false });
            if (oppLob) lobEntries.push({ zone: oppLob, isOpponent: true });
            return lobEntries.map(({ zone, isOpponent }) => {
              const cards = isOpponent ? (opponentCards['land-of-bondage'] ?? []) : (myCards['land-of-bondage'] ?? []);
              const labelTextWidth = zone.label.toUpperCase().length * 7;
              const fillColor = isOpponent ? '#a3c5e8' : '#e8d5a3';
              const badgeFill = isOpponent ? 'rgba(100, 149, 237, 0.25)' : 'rgba(196, 149, 90, 0.25)';
              const badgeStroke = isOpponent ? 'rgba(100, 149, 237, 0.5)' : 'rgba(196, 149, 90, 0.5)';
              const bgFill = isOpponent ? 'rgba(16, 20, 30, 0.85)' : 'rgba(30, 22, 16, 0.85)';
              const labelW = labelTextWidth + 8 + 24 + 8; // text + gap + badge + pad
              return (
                <Group key={`lob-overlay-${isOpponent ? 'opp' : 'my'}`}>
                  <Rect
                    x={zone.x}
                    y={zone.y}
                    width={Math.min(labelW + 6, zone.width)}
                    height={20}
                    fill={bgFill}
                    cornerRadius={[3, 0, 4, 0]}
                  />
                  <Text
                    x={zone.x + 6}
                    y={zone.y + 4}
                    text={zone.label.toUpperCase()}
                    fontSize={11}
                    fontFamily="Cinzel, Georgia, serif"
                    fill={fillColor}
                    letterSpacing={1}
                    width={zone.width - 44}
                    ellipsis={true}
                  />
                  <Rect
                    x={zone.x + 6 + labelTextWidth + 8}
                    y={zone.y + 4}
                    width={24}
                    height={14}
                    fill={badgeFill}
                    cornerRadius={3}
                    stroke={badgeStroke}
                    strokeWidth={0.5}
                  />
                  <Text
                    x={zone.x + 6 + labelTextWidth + 8}
                    y={zone.y + 4}
                    width={24}
                    text={String(cards.length)}
                    fontSize={11}
                    fill={fillColor}
                    align="center"
                  />
                </Group>
              );
            });
          })()}

          {/* ================================================================
              Territory label overlays — rendered AFTER cards so labels sit on top
              ================================================================ */}
          {(() => {
            const territoryEntries: { zone: typeof myZones[string]; isOpponent: boolean; cards: typeof myCards[string] }[] = [];
            const myTerr = myZones['territory'];
            const oppTerr = opponentZones['territory'];
            if (myTerr) territoryEntries.push({ zone: myTerr, isOpponent: false, cards: myCards['territory'] ?? [] });
            if (oppTerr) territoryEntries.push({ zone: oppTerr, isOpponent: true, cards: opponentCards['territory'] ?? [] });
            return territoryEntries.map(({ zone, isOpponent, cards }) => {
              const labelTextWidth = zone.label.toUpperCase().length * 7;
              const fillColor = isOpponent ? '#a3c5e8' : '#e8d5a3';
              const badgeFill = isOpponent ? 'rgba(100, 149, 237, 0.25)' : 'rgba(196, 149, 90, 0.25)';
              const badgeStroke = isOpponent ? 'rgba(100, 149, 237, 0.5)' : 'rgba(196, 149, 90, 0.5)';
              const bgFill = isOpponent ? 'rgba(16, 20, 30, 0.85)' : 'rgba(30, 22, 16, 0.85)';
              const labelW = labelTextWidth + 8 + 24 + 8;
              return (
                <Group key={`territory-overlay-${isOpponent ? 'opp' : 'my'}`}>
                  <Rect
                    x={zone.x}
                    y={zone.y}
                    width={Math.min(labelW + 6, zone.width)}
                    height={20}
                    fill={bgFill}
                    cornerRadius={[3, 0, 4, 0]}
                  />
                  <Text
                    x={zone.x + 6}
                    y={zone.y + 4}
                    text={zone.label.toUpperCase()}
                    fontSize={11}
                    fontFamily="Cinzel, Georgia, serif"
                    fill={fillColor}
                    letterSpacing={1}
                    width={zone.width - 44}
                    ellipsis={true}
                  />
                  <Rect
                    x={zone.x + 6 + labelTextWidth + 8}
                    y={zone.y + 4}
                    width={24}
                    height={14}
                    fill={badgeFill}
                    cornerRadius={3}
                    stroke={badgeStroke}
                    strokeWidth={0.5}
                  />
                  <Text
                    x={zone.x + 6 + labelTextWidth + 8}
                    y={zone.y + 4}
                    width={24}
                    text={String(cards.length)}
                    fontSize={11}
                    fill={fillColor}
                    align="center"
                  />
                </Group>
              );
            });
          })()}

          {/* ================================================================
              Sidebar pile indicators — My zones (NOT draggable, interactions via context menu)
              ================================================================ */}
          {SIDEBAR_ZONES.map((zoneKey) => {
            const zone = myZones[zoneKey];
            if (!zone) return null;
            const cards = myCards[zoneKey] ?? [];
            const count = cards.length;
            const cx = zone.x + zone.width / 2 - pileCardWidth / 2;
            // Center card vertically in remaining space after count badge (18px top)
            const cy = zone.y + 18 + Math.max(0, (zone.height - 18 - pileCardHeight) / 2);

            // Discard, LOR, and Reserve show top card face-up; everything else shows card back
            // Reserve always shows face-up to the owner regardless of isFlipped
            // Reserve sorts by type then name to match the browse modal order
            const sortedCards = zoneKey === 'reserve'
              ? [...cards].sort((a, b) => (a.cardType ?? '').localeCompare(b.cardType ?? '') || (a.cardName ?? '').localeCompare(b.cardName ?? ''))
              : cards;
            const topCard = sortedCards[sortedCards.length - 1];
            const showFace = topCard && ((zoneKey === 'discard' || zoneKey === 'land-of-redemption') ? !topCard.isFlipped : zoneKey === 'reserve');

            return (
              <Group
                key={`my-pile-${zoneKey}`}
                onClick={zoneKey !== 'deck' ? () => {
                  setBrowseMyZone(zoneKey);
                } : undefined}
                onDblClick={zoneKey === 'deck' ? () => {
                  multiplayerActions.drawCard();
                } : undefined}
                onContextMenu={zoneKey === 'deck' ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  const stage = stageRef.current;
                  if (!stage) return;
                  const container = stage.container().getBoundingClientRect();
                  closeAllMenus();
                  setDeckMenu({
                    x: e.evt.clientX,
                    y: e.evt.clientY,
                  });
                } : zoneKey === 'land-of-redemption' ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  const stage = stageRef.current;
                  if (!stage) return;
                  const container = stage.container().getBoundingClientRect();
                  closeAllMenus();
                  setLorMenu({
                    x: e.evt.clientX,
                    y: e.evt.clientY,
                  });
                } : undefined}
              >
                {/* Count badge */}
                <Group x={zone.x + zone.width - 32} y={zone.y + 2}>
                  <Rect width={26} height={18} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
                  <Text
                    text={String(count)}
                    fontSize={12}
                    fontStyle="bold"
                    fill="#e8d5a3"
                    width={26}
                    height={18}
                    align="center"
                    verticalAlign="middle"
                  />
                </Group>

                {/* LOR: spread all cards face-up with horizontal overlap */}
                {zoneKey === 'land-of-redemption' && count > 0 && (() => {
                  const pad = 4;
                  const availW = zone.width - pad * 2;
                  const overlap = count <= 1 ? 0 : Math.min(pileCardWidth * 0.3, (availW - pileCardWidth) / (count - 1));
                  return cards.map((c, i) => {
                    const img = getCardImage(c);
                    const gameCard = adaptCard(c, 'player1');
                    const cardX = zone.x + pad + i * overlap;
                    const cardY = zone.y + (zone.height - pileCardHeight) / 2;
                    return img ? (
                      <GameCardNode
                        key={String(c.id)}
                        card={gameCard}
                        x={cardX}
                        y={cardY}
                        rotation={0}
                        cardWidth={pileCardWidth}
                        cardHeight={pileCardHeight}
                        image={img}
                        isSelected={isSelected(String(c.id))}
                        isDraggable={true}
                        nodeRef={registerCardNode}
                        hoverProgress={hoveredInstanceId === String(c.id) ? hoverProgress : 0}
                        onClick={handleCardClick}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onDblClick={noopDblClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    ) : (
                      <Group key={String(c.id)} x={cardX} y={cardY}>
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      </Group>
                    );
                  });
                })()}

                {/* Pile visual — only if zone has cards (non-LOR) */}
                {zoneKey !== 'land-of-redemption' && count > 0 && (
                  <Group x={cx} y={cy}>
                    {/* Shadow card for depth if multiple — hide when showing face-up */}
                    {count > 1 && !showFace && (
                      <Group x={-2} y={-2}>
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      </Group>
                    )}
                    {/* Second card underneath for face-up piles (visible when top card is dragged) */}
                    {count > 1 && showFace && (() => {
                      const secondCard = sortedCards[sortedCards.length - 2];
                      if (!secondCard) return null;
                      const effectiveSecond = zoneKey === 'reserve' && secondCard.isFlipped
                        ? { ...secondCard, isFlipped: false }
                        : secondCard;
                      const secondImg = getCardImage(effectiveSecond);
                      return secondImg ? (
                        <GameCardNode
                          card={adaptCard(effectiveSecond, 'player1')}
                          x={0}
                          y={0}
                          rotation={0}
                          cardWidth={pileCardWidth}
                          cardHeight={pileCardHeight}
                          image={secondImg}
                          isSelected={false}
                          isDraggable={zoneKey === 'discard' || zoneKey === 'reserve'}
                          nodeRef={(zoneKey === 'discard' || zoneKey === 'reserve') ? registerCardNode : undefined}
                          hoverProgress={hoveredInstanceId === String(secondCard.id) ? hoverProgress : 0}
                          onDragStart={(zoneKey === 'discard' || zoneKey === 'reserve') ? handleCardDragStart : noopCardDrag}
                          onDragMove={(zoneKey === 'discard' || zoneKey === 'reserve') ? handleCardDragMove : noopDrag}
                          onDragEnd={(zoneKey === 'discard' || zoneKey === 'reserve') ? handleCardDragEnd : noopCardDragEnd}
                          onContextMenu={handleCardContextMenu}
                          onDblClick={noopDblClick}
                          onMouseEnter={handleMouseEnter}
                          onMouseLeave={handleMouseLeave}
                        />
                      ) : (
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      );
                    })()}
                    {showFace && topCard ? (
                      (() => {
                        // For reserve, force face-up image even if card.isFlipped is true
                        const effectiveCard = zoneKey === 'reserve' && topCard.isFlipped
                          ? { ...topCard, isFlipped: false }
                          : topCard;
                        const img = getCardImage(effectiveCard);
                        return img ? (
                          <Group>
                            <Rect
                              width={pileCardWidth}
                              height={pileCardHeight}
                              cornerRadius={4}
                            />
                            <GameCardNode
                              card={adaptCard(effectiveCard, 'player1')}
                              x={0}
                              y={0}
                              rotation={0}
                              cardWidth={pileCardWidth}
                              cardHeight={pileCardHeight}
                              image={img}
                              isSelected={false}
                              isDraggable={zoneKey === 'discard' || zoneKey === 'reserve' || zoneKey === 'deck'}
                              nodeRef={(zoneKey === 'discard' || zoneKey === 'reserve' || zoneKey === 'deck') ? registerCardNode : undefined}
                              hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                              onDragStart={(zoneKey === 'discard' || zoneKey === 'reserve' || zoneKey === 'deck') ? handleCardDragStart : noopCardDrag}
                              onDragMove={(zoneKey === 'discard' || zoneKey === 'reserve' || zoneKey === 'deck') ? handleCardDragMove : noopDrag}
                              onDragEnd={(zoneKey === 'discard' || zoneKey === 'reserve' || zoneKey === 'deck') ? handleCardDragEnd : noopCardDragEnd}
                              onContextMenu={handleCardContextMenu}
                              onDblClick={noopDblClick}
                              onMouseEnter={handleMouseEnter}
                              onMouseLeave={handleMouseLeave}
                            />
                          </Group>
                        ) : (
                          <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                        );
                      })()
                    ) : zoneKey === 'deck' && topCard ? (
                      <GameCardNode
                        card={adaptCard(topCard, 'player1')}
                        x={0}
                        y={0}
                        rotation={0}
                        cardWidth={pileCardWidth}
                        cardHeight={pileCardHeight}
                        image={undefined}
                        isSelected={false}
                        isDraggable={true}
                        nodeRef={registerCardNode}
                        hoverProgress={0}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onDblClick={noopDblClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    ) : (
                      <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                    )}
                  </Group>
                )}
              </Group>
            );
          })}

          {/* ================================================================
              Sidebar pile indicators — Opponent zones (NOT draggable)
              ================================================================ */}
          {SIDEBAR_ZONES.map((zoneKey) => {
            const zone = opponentZones[zoneKey];
            if (!zone) return null;
            const cards = opponentCards[zoneKey] ?? [];
            const count = cards.length;
            const cx = zone.x + zone.width / 2 - pileCardWidth / 2;
            // Center card vertically in remaining space after count badge (18px top)
            const cy = zone.y + 18 + Math.max(0, (zone.height - 18 - pileCardHeight) / 2);

            const topCard = cards[cards.length - 1];
            const showFace = (zoneKey === 'discard' || zoneKey === 'land-of-redemption') && topCard && !topCard.isFlipped;

            return (
              <Group
                key={`opp-pile-${zoneKey}`}
                onClick={zoneKey !== 'deck' && zoneKey !== 'reserve' ? () => {
                  const zoneLabels: Record<string, string> = { discard: "Opponent's Discard", banish: "Opponent's Banish", lor: "Opponent's Land of Redemption" };
                  setBrowseOpponentZone({ zone: zoneKey, cards, label: zoneLabels[zoneKey] ?? zoneKey });
                } : undefined}
                onContextMenu={['deck', 'reserve'].includes(zoneKey) ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  closeAllMenus();
                  if (zoneKey === 'deck') {
                    setOpponentDeckMenu({ x: e.evt.clientX, y: e.evt.clientY });
                  } else {
                    const zoneNames: Record<string, string> = { reserve: 'Reserve' };
                    setOpponentZoneMenu({
                      x: e.evt.clientX,
                      y: e.evt.clientY,
                      zone: zoneKey,
                      zoneName: zoneNames[zoneKey] ?? zoneKey,
                    });
                  }
                } : undefined}
              >
                {/* Count badge */}
                <Group x={zone.x + zone.width - 32} y={zone.y + 2}>
                  <Rect width={26} height={18} fill="#101828" cornerRadius={4} stroke="#4a7ab5" strokeWidth={1} />
                  <Text
                    text={String(count)}
                    fontSize={12}
                    fontStyle="bold"
                    fill="#a3c5e8"
                    width={26}
                    height={18}
                    align="center"
                    verticalAlign="middle"
                  />
                </Group>

                {/* Opponent LOR: spread all cards face-up with horizontal overlap (rotated 180°) */}
                {zoneKey === 'land-of-redemption' && count > 0 && (() => {
                  const pad = 4;
                  const availW = zone.width - pad * 2;
                  const overlap = count <= 1 ? 0 : Math.min(pileCardWidth * 0.3, (availW - pileCardWidth) / (count - 1));
                  return cards.map((c, i) => {
                    const img = getCardImage(c);
                    const gameCard = adaptCard(c, 'player2');
                    const cardX = zone.x + pad + i * overlap + pileCardWidth;
                    const cardY = zone.y + (zone.height - pileCardHeight) / 2 + pileCardHeight;
                    return img ? (
                      <GameCardNode
                        key={String(c.id)}
                        card={gameCard}
                        x={cardX}
                        y={cardY}
                        rotation={180}
                        cardWidth={pileCardWidth}
                        cardHeight={pileCardHeight}
                        image={img}
                        isSelected={isSelected(String(c.id))}
                        isDraggable={true}
                        nodeRef={registerCardNode}
                        hoverProgress={hoveredInstanceId === String(c.id) ? hoverProgress : 0}
                        onClick={handleCardClick}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onDblClick={noopDblClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    ) : (
                      <Group key={String(c.id)} x={cardX} y={cardY}>
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      </Group>
                    );
                  });
                })()}

                {/* Non-LOR pile visual — rotated 180° for opponent */}
                {zoneKey !== 'land-of-redemption' && count > 0 && (
                  <Group x={cx + pileCardWidth} y={cy + pileCardHeight} rotation={180}>
                    {count > 1 && !showFace && (
                      <Group x={-2} y={-2}>
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      </Group>
                    )}
                    {showFace && topCard ? (
                      (() => {
                        const img = getCardImage(topCard);
                        return img ? (
                          <Group>
                            <GameCardNode
                              card={adaptCard(topCard, 'player2')}
                              x={0}
                              y={0}
                              rotation={0}
                              cardWidth={pileCardWidth}
                              cardHeight={pileCardHeight}
                              image={img}
                              isSelected={false}
                              isDraggable={zoneKey === 'discard'}
                              nodeRef={zoneKey === 'discard' ? registerCardNode : undefined}
                              hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                              onDragStart={zoneKey === 'discard' ? handleCardDragStart : noopCardDrag}
                              onDragMove={zoneKey === 'discard' ? handleCardDragMove : noopDrag}
                              onDragEnd={zoneKey === 'discard' ? handleCardDragEnd : noopCardDragEnd}
                              onContextMenu={handleCardContextMenu}
                              onDblClick={noopDblClick}
                              onMouseEnter={handleMouseEnter}
                              onMouseLeave={handleMouseLeave}
                            />
                          </Group>
                        ) : (
                          <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                        );
                      })()
                    ) : (
                      <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                    )}
                  </Group>
                )}
              </Group>
            );
          })}

          {/* ================================================================
              Opponent hand — card backs or face-up if hand is revealed
              ================================================================ */}
          {(() => {
            const opponentHandCards = opponentCards['hand'] ?? [];
            if (opponentHandCards.length === 0) return null;

            const oppHandPositions = calculateHandPositions(
              opponentHandCards.length,
              opponentHandRect!,
              oppHandCard.cardWidth,
              oppHandCard.cardHeight,
              true, // flat spread — no fan arc for opponent
            );

            const oppHandRevealed = gameState.opponentPlayer?.handRevealed ?? false;

            return (
              <Group
                clipX={opponentHandRect!.x}
                clipY={opponentHandRect!.y}
                clipWidth={opponentHandRect!.width}
                clipHeight={opponentHandRect!.height}
                onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  const stage = stageRef.current;
                  if (!stage) return;
                  const container = stage.container().getBoundingClientRect();
                  closeAllMenus();
                  setOpponentZoneMenu({
                    x: e.evt.clientX,
                    y: e.evt.clientY,
                    zone: 'hand',
                    zoneName: 'Hand',
                  });
                }}
              >
                {oppHandPositions.map((pos, i) => {
                  const card = opponentHandCards[i];
                  if (oppHandRevealed && card) {
                    const gameCard = adaptCard(card, 'player2');
                    return (
                      <GameCardNode
                        key={String(card.id)}
                        card={gameCard}
                        x={pos.x}
                        y={pos.y}
                        rotation={pos.rotation}
                        cardWidth={oppHandCard.cardWidth}
                        cardHeight={oppHandCard.cardHeight}
                        image={getCardImage(card)}
                        isDraggable={false}
                        hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                        onDragStart={noopCardDrag}
                        onDragMove={noopDrag}
                        onDragEnd={noopCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onDblClick={noopDblClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    );
                  }
                  return (
                    <Group key={`opp-hand-${i}`} x={pos.x} y={pos.y}>
                      <CardBackShape width={oppHandCard.cardWidth} height={oppHandCard.cardHeight} />
                    </Group>
                  );
                })}
              </Group>
            );
          })()}

          {/* ================================================================
              My hand — fan/spread layout at bottom (draggable)
              ================================================================ */}
          {(() => {
            const handCards = myCards['hand'] ?? [];
            if (handCards.length === 0) return null;

            const positions = calculateHandPositions(
              handCards.length,
              myHandRect!,
              cardWidth,
              cardHeight,
              isSpreadHand,
            );

            return (
              <Group>
                {handCards.map((card, i) => {
                  const pos = positions[i];
                  if (!pos) return null;
                  const gameCard = adaptCard(card, 'player1');
                  return (
                    <GameCardNode
                      key={String(card.id)}
                      card={gameCard}
                      x={pos.x}
                      y={pos.y}
                      rotation={pos.rotation}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getCardImage(card)}
                      isSelected={isSelected(String(card.id))}
                      isDraggable={true}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onClick={handleCardClick}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onDblClick={handleDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })()}
        </Layer>

        {/* Selection rectangle layer — scaled to match game layer */}
        <Layer
          ref={selectionLayerRef as any}
          listening={false}
          scaleX={scale}
          scaleY={scale}
          x={offsetX}
          y={offsetY}
        >
          <Rect
            ref={selectionRectRef as any}
            visible={false}
            fill="rgba(196,149,90,0.12)"
            stroke="#c4955a"
            strokeWidth={1}
            dash={[6, 3]}
          />
        </Layer>
      </Stage>

      {/* Card size settings gear */}
      <CardScaleControl
        cardScale={cardScale}
        setCardScale={setCardScale}
        resetScale={resetScale}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        step={STEP}
        onLoadDeck={onLoadDeck}
      />

      {/* ================================================================
          Zone highlight overlay during drag
          ================================================================ */}

      {/* ================================================================
          Dice roll overlay — synced via lastDiceRoll field from SpacetimeDB
          ================================================================ */}
      <DiceOverlay
        lastDiceRoll={gameState.game?.lastDiceRoll ?? ''}
        myPlayer={gameState.myPlayer}
        opponentPlayer={gameState.opponentPlayer}
        identityHex={gameState.identityHex}
      />

      {dragHoverZone !== null && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 450 }}>
          {allZoneRects.map(({ key, rect, owner }) => {
            // Don't highlight the source zone
            const sourceKey = dragSourceZoneRef.current
              ? `my:${dragSourceZoneRef.current}`
              : null;
            if (key === sourceKey) return null;

            const isHovered = dragHoverZone === key;
            const borderColor =
              owner === 'my'
                ? isHovered
                  ? 'rgba(196,149,90,0.6)'
                  : 'rgba(196,149,90,0.2)'
                : isHovered
                  ? 'rgba(100,149,237,0.6)'
                  : 'rgba(100,149,237,0.2)';
            const bgColor =
              owner === 'my'
                ? isHovered
                  ? 'rgba(196,149,90,0.12)'
                  : 'transparent'
                : isHovered
                  ? 'rgba(100,149,237,0.12)'
                  : 'transparent';

            const screenTopLeft = virtualToScreen(rect.x, rect.y, scale, offsetX, offsetY);
            const screenBottomRight = virtualToScreen(rect.x + rect.width, rect.y + rect.height, scale, offsetX, offsetY);

            return (
              <div
                key={key}
                style={{
                  position: 'absolute',
                  left: screenTopLeft.x,
                  top: screenTopLeft.y,
                  width: screenBottomRight.x - screenTopLeft.x,
                  height: screenBottomRight.y - screenTopLeft.y,
                  border: `1px solid ${borderColor}`,
                  background: bgColor,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    color: isHovered
                      ? owner === 'my'
                        ? 'rgba(232,213,163,0.7)'
                        : 'rgba(163,197,232,0.7)'
                      : owner === 'my'
                        ? 'rgba(232,213,163,0.3)'
                        : 'rgba(163,197,232,0.3)',
                    fontSize: 12,
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    textTransform: 'uppercase',
                    letterSpacing: 2,
                  }}
                >
                  {rect.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================
          Shared context menu — positioned relative to canvas container
          ================================================================ */}
      {contextMenu && (
        <CardContextMenu
          card={contextMenu.card}
          x={contextMenu.x}
          y={contextMenu.y}
          actions={multiplayerActions}
          onClose={() => setContextMenu(null)}
          onExchange={(cardIds) => { setContextMenu(null); setExchangeCardIds(cardIds); }}
        />
      )}

      {multiCardContextMenu && (
        <MultiCardContextMenu
          selectedIds={Array.from(selectedIds)}
          x={multiCardContextMenu.x}
          y={multiCardContextMenu.y}
          actions={multiplayerActions}
          onClose={() => setMultiCardContextMenu(null)}
          onClearSelection={() => { clearSelection(); setMultiCardContextMenu(null); }}
        />
      )}

      {zoneMenu && (
        <ZoneContextMenu
          x={zoneMenu.x}
          y={zoneMenu.y}
          spawnX={zoneMenu.spawnX}
          spawnY={zoneMenu.spawnY}
          onClose={() => setZoneMenu(null)}
          onAddOpponentLostSoul={(testament, posX, posY) => {
            gameState.spawnLostSoul(testament, String(posX), String(posY), zoneMenu.targetPlayerId);
          }}
        />
      )}

      {deckMenu && (
        <DeckContextMenu
          x={deckMenu.x}
          y={deckMenu.y}
          deckSize={(myCards['deck'] ?? []).length}
          onClose={() => setDeckMenu(null)}
          onSearchDeck={() => { setDeckMenu(null); setShowDeckSearch(true); }}
          onShuffleDeck={() => { multiplayerActions.shuffleDeck(); setDeckMenu(null); }}
          onDrawTop={(n) => { multiplayerActions.drawMultiple(n); setDeckMenu(null); }}
          onRevealTop={(n) => { setDeckMenu(null); setPeekState({ position: 'top', count: n }); }}
          onDiscardTop={(n) => { moveDeckCardsToZone('top', n, 'discard'); setDeckMenu(null); }}
          onReserveTop={(n) => { moveDeckCardsToZone('top', n, 'reserve'); setDeckMenu(null); }}
          onDrawBottom={(n) => { moveDeckCardsToZone('bottom', n, 'hand'); setDeckMenu(null); }}
          onRevealBottom={(n) => { setDeckMenu(null); setPeekState({ position: 'bottom', count: n }); }}
          onDiscardBottom={(n) => { moveDeckCardsToZone('bottom', n, 'discard'); setDeckMenu(null); }}
          onReserveBottom={(n) => { moveDeckCardsToZone('bottom', n, 'reserve'); setDeckMenu(null); }}
          onDrawRandom={(n) => { moveDeckCardsToZone('random', n, 'hand'); setDeckMenu(null); }}
          onRevealRandom={(n) => { setDeckMenu(null); setPeekState({ position: 'random', count: n }); }}
          onDiscardRandom={(n) => { moveDeckCardsToZone('random', n, 'discard'); setDeckMenu(null); }}
          onReserveRandom={(n) => { moveDeckCardsToZone('random', n, 'reserve'); setDeckMenu(null); }}
        />
      )}

      {handMenu && (
        <HandContextMenu
          x={handMenu.x}
          y={handMenu.y}
          handSize={myCards['hand']?.length ?? 0}
          onClose={() => setHandMenu(null)}
          onRandomToDiscard={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'discard', ''); }}
          onRandomToReserve={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'reserve', ''); }}
          onRandomToDeckTop={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'top'); }}
          onRandomToDeckBottom={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'bottom'); }}
          onShuffleRandomIntoDeck={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'shuffle'); }}
          isHandRevealed={gameState.myPlayer?.handRevealed ?? false}
          onRevealHand={(revealed) => { setHandMenu(null); gameState.revealHand(revealed); }}
        />
      )}

      {opponentDeckMenu && (
        <DeckContextMenu
          x={opponentDeckMenu.x}
          y={opponentDeckMenu.y}
          deckSize={(opponentCards['deck'] ?? []).length}
          onClose={() => setOpponentDeckMenu(null)}
          onSearchDeck={() => {
            setOpponentDeckMenu(null);
            requestZoneSearch('deck');
            showGameToast('Waiting for opponent to approve...');
          }}
          onShuffleDeck={() => { gameState.shuffleDeck(); setOpponentDeckMenu(null); }}
          onDrawTop={(n) => { moveOpponentDeckCardsToZone('top', n, 'hand'); setOpponentDeckMenu(null); }}
          onRevealTop={(n) => { setOpponentDeckMenu(null); setOpponentPeekState({ position: 'top', count: n }); }}
          onDiscardTop={(n) => { moveOpponentDeckCardsToZone('top', n, 'discard'); setOpponentDeckMenu(null); }}
          onReserveTop={(n) => { moveOpponentDeckCardsToZone('top', n, 'reserve'); setOpponentDeckMenu(null); }}
          onDrawBottom={(n) => { moveOpponentDeckCardsToZone('bottom', n, 'hand'); setOpponentDeckMenu(null); }}
          onRevealBottom={(n) => { setOpponentDeckMenu(null); setOpponentPeekState({ position: 'bottom', count: n }); }}
          onDiscardBottom={(n) => { moveOpponentDeckCardsToZone('bottom', n, 'discard'); setOpponentDeckMenu(null); }}
          onReserveBottom={(n) => { moveOpponentDeckCardsToZone('bottom', n, 'reserve'); setOpponentDeckMenu(null); }}
          onDrawRandom={(n) => { moveOpponentDeckCardsToZone('random', n, 'hand'); setOpponentDeckMenu(null); }}
          onRevealRandom={(n) => { setOpponentDeckMenu(null); setOpponentPeekState({ position: 'random', count: n }); }}
          onDiscardRandom={(n) => { moveOpponentDeckCardsToZone('random', n, 'discard'); setOpponentDeckMenu(null); }}
          onReserveRandom={(n) => { moveOpponentDeckCardsToZone('random', n, 'reserve'); setOpponentDeckMenu(null); }}
        />
      )}

      {lorMenu && (
        <LorContextMenu
          x={lorMenu.x}
          y={lorMenu.y}
          onClose={() => setLorMenu(null)}
          onAddSoul={() => {
            multiplayerActions.spawnLostSoul?.('NT', '0.5', '0.5');
            setLorMenu(null);
          }}
        />
      )}

      {deckDrop && (() => {
        const ids = deckDrop.batchIds ?? [deckDrop.cardId];
        const isBatch = ids.length > 1;
        return (
          <DeckDropPopup
            x={deckDrop.x}
            y={deckDrop.y}
            onShuffleIn={() => {
              for (const id of ids) multiplayerActions.shuffleCardIntoDeck(id);
              setDeckDrop(null);
            }}
            onTopDeck={() => {
              for (const id of ids) multiplayerActions.moveCardToTopOfDeck(id);
              setDeckDrop(null);
            }}
            onBottomDeck={() => {
              for (const id of ids) multiplayerActions.moveCardToBottomOfDeck(id);
              setDeckDrop(null);
            }}
            onExchange={!isBatch ? () => { setDeckDrop(null); setExchangeCardIds([deckDrop.cardId]); } : undefined}
            onCancel={() => setDeckDrop(null)}
          />
        );
      })()}

      {/* ================================================================
          Opponent zone search — context menu, consent dialog, browse modal
          ================================================================ */}
      {opponentZoneMenu && (
        <OpponentZoneContextMenu
          x={opponentZoneMenu.x}
          y={opponentZoneMenu.y}
          zone={opponentZoneMenu.zone}
          zoneName={opponentZoneMenu.zoneName}
          onSearch={() => {
            requestZoneSearch(opponentZoneMenu.zone);
            showGameToast('Waiting for opponent to approve...');
            setOpponentZoneMenu(null);
          }}
          onRevealHand={opponentZoneMenu.zone === 'hand' ? () => {
            requestZoneSearch('hand-reveal');
            showGameToast('Asking opponent to reveal hand...');
            setOpponentZoneMenu(null);
          } : undefined}
          onClose={() => setOpponentZoneMenu(null)}
        />
      )}

      {incomingSearchRequest && (
        <ConsentDialog
          requesterName={gameState.opponentPlayer?.displayName ?? 'Opponent'}
          zoneName={incomingSearchRequest.zone === 'hand-reveal' ? 'hand' : incomingSearchRequest.zone}
          requestType={incomingSearchRequest.zone === 'hand-reveal' ? 'reveal' : 'search'}
          onAllow={() => {
            approveZoneSearch(BigInt(incomingSearchRequest.id));
            if (incomingSearchRequest.zone === 'hand-reveal') {
              gameState.revealHand(true);
            }
          }}
          onDeny={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
        />
      )}

      {approvedSearchRequest && approvedSearchRequest.zone !== 'hand-reveal' && (() => {
        const zoneCards = (opponentCards[approvedSearchRequest.zone] ?? [])
          .map((c: any) => cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player2'));
        return (
          <OpponentBrowseModal
            zoneName={approvedSearchRequest.zone}
            cards={zoneCards}
            onMoveCard={(cardId, action) => {
              const reqId = BigInt(approvedSearchRequest.id);
              if (action === 'discard') {
                moveOpponentCard(reqId, BigInt(cardId), 'discard');
              } else if (action === 'banish') {
                moveOpponentCard(reqId, BigInt(cardId), 'banish');
              } else if (action === 'deck-top') {
                moveOpponentCard(reqId, BigInt(cardId), 'deck');
              } else if (action === 'deck-bottom') {
                moveOpponentCard(reqId, BigInt(cardId), 'deck');
              } else if (action === 'deck-shuffle') {
                moveOpponentCard(reqId, BigInt(cardId), 'deck');
                gameState.shuffleDeck();
              }
            }}
            onClose={() => completeZoneSearch(BigInt(approvedSearchRequest.id))}
            onStartDrag={opponentModalStartDrag}
            didDragRef={opponentModalDidDragRef}
            isDragActive={opponentModalDrag.isDragging}
          />
        );
      })()}

      {/* ================================================================
          Zone browse overlay — card grid for browsing pile contents
          ================================================================ */}
      {browseOpponentZone && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.7)',
          }}
          onClick={() => setBrowseOpponentZone(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(20, 16, 12, 0.97)',
              border: '1px solid rgba(107, 78, 39, 0.5)',
              borderRadius: 8,
              padding: 16,
              maxWidth: '80%',
              maxHeight: '70%',
              overflow: 'auto',
              minWidth: 300,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 14,
                color: '#e8d5a3',
                letterSpacing: '0.05em',
              }}>
                {browseOpponentZone.label} ({browseOpponentZone.cards.length})
              </span>
              <button
                onClick={() => setBrowseOpponentZone(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#e8d5a3',
                  cursor: 'pointer',
                  fontSize: 18,
                  padding: '2px 6px',
                }}
              >
                ✕
              </button>
            </div>
            {browseOpponentZone.cards.length === 0 ? (
              <div style={{ color: 'rgba(232, 213, 163, 0.4)', fontSize: 13, textAlign: 'center', padding: 24 }}>
                No cards in this zone
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                gap: 8,
              }}>
                {browseOpponentZone.cards.map((card) => {
                  const imgUrl = getSharedCardImageUrl(card.cardImgFile);
                  return (
                    <div
                      key={String(card.id)}
                      style={{
                        borderRadius: 4,
                        overflow: 'hidden',
                        border: '1px solid rgba(107, 78, 39, 0.3)',
                        cursor: 'default',
                      }}
                      title={card.cardName}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl}
                        alt={card.cardName}
                        style={{ width: '100%', display: 'block' }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================
          Shared deck modals — wrapped in ModalGameProvider
          ================================================================ */}
      <ModalGameProvider value={modalGameValue}>
        {browseMyZone && (
          <ZoneBrowseModal
            zoneId={browseMyZone as ZoneId}
            onClose={() => setBrowseMyZone(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}

        {showDeckSearch && (
          <DeckSearchModal
            onClose={() => setShowDeckSearch(false)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}

        {peekState && (
          <DeckPeekModal
            cardIds={peekCardIds}
            title={`${peekState.position === 'top' ? 'Top' : peekState.position === 'bottom' ? 'Bottom' : 'Random'} ${peekState.count}`}
            onClose={() => { setPeekState(null); gameState.clearRevealedCards(); }}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}

        {exchangeCardIds && (
          <DeckExchangeModal
            exchangeCardIds={exchangeCardIds}
            onComplete={() => { setExchangeCardIds(null); clearSelection(); }}
            onCancel={() => setExchangeCardIds(null)}
            onStartDrag={modalStartDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}
      </ModalGameProvider>

      {/* Opponent deck modals — wrapped in ModalGameProvider with opponent card data.
          Uses regular modalStartDrag (not opponentModalStartDrag) because move_card
          allows either player to move any card in sandbox mode. The moveOpponentCard
          gate is only for the consent-flow OpponentBrowseModal. */}
      <ModalGameProvider value={opponentModalGameValue}>
        {opponentPeekState && (
          <DeckPeekModal
            cardIds={opponentPeekCardIds}
            title={`Opponent ${opponentPeekState.position === 'top' ? 'Top' : opponentPeekState.position === 'bottom' ? 'Bottom' : 'Random'} ${opponentPeekState.count}`}
            onClose={() => setOpponentPeekState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}
      </ModalGameProvider>

      {/* Opponent's server-revealed cards (read-only view) */}
      {opponentRevealedCardIds.length > 0 && !opponentRevealDismissed && (
        <ModalGameProvider value={opponentModalGameValue}>
          <DeckPeekModal
            cardIds={opponentRevealedCardIds}
            title={`${gameState.opponentPlayer?.displayName ?? 'Opponent'} Revealed ${opponentRevealedCardIds.length}`}
            onClose={() => setOpponentRevealDismissed(true)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        </ModalGameProvider>
      )}

      {/* Floating drag ghost (modal → canvas drag) */}
      {modalDrag.isDragging && modalDrag.imageUrl && (
        modalDrag.additionalCards.length > 0 ? (
          <div
            ref={modalGhostRef as React.RefObject<HTMLDivElement>}
            style={{
              position: 'fixed',
              pointerEvents: 'none',
              zIndex: 700,
            }}
          >
            {[...modalDrag.additionalCards.slice(0, 2)].reverse().map((extra, i) => (
              <img
                key={extra.card.instanceId}
                src={extra.imageUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  width: 80,
                  borderRadius: 4,
                  border: '1px solid var(--gf-text-dim)',
                  opacity: 0.4 - i * 0.15,
                  top: -(6 + i * 4),
                  left: 4 + i * 2,
                  zIndex: -1 - i,
                }}
              />
            ))}
            <img
              src={modalDrag.imageUrl}
              alt="Dragging cards"
              draggable={false}
              style={{
                width: 80,
                borderRadius: 4,
                border: '2px solid var(--gf-accent)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                opacity: 0.9,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: -8,
                right: -8,
                background: 'var(--gf-accent)',
                color: '#1e1610',
                borderRadius: '50%',
                width: 22,
                height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 'bold',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}
            >
              {modalDrag.additionalCards.length + 1}
            </div>
          </div>
        ) : (
          <img
            ref={modalGhostRef as React.RefObject<HTMLImageElement>}
            src={modalDrag.imageUrl}
            alt="Dragging card"
            draggable={false}
            style={{
              position: 'fixed',
              width: 80,
              borderRadius: 4,
              border: '2px solid var(--gf-accent)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              zIndex: 700,
              opacity: 0.9,
            }}
          />
        )
      )}

      {/* Floating drag ghost (opponent modal → canvas drag) */}
      {opponentModalDrag.isDragging && opponentModalDrag.imageUrl && (
        <img
          ref={opponentModalGhostRef as React.RefObject<HTMLImageElement>}
          src={opponentModalDrag.imageUrl}
          alt="Dragging card"
          draggable={false}
          style={{
            position: 'fixed',
            width: 80,
            borderRadius: 4,
            border: '2px solid var(--gf-accent)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            zIndex: 700,
            opacity: 0.9,
          }}
        />
      )}

      {/* ================================================================
          Card hover preview — floating tooltip near cursor
          ================================================================ */}
      {hoveredCard && hoverReady && !isLoupeVisible && !isDraggingRef.current && !contextMenu && !multiCardContextMenu && !deckMenu && !zoneMenu && !lorMenu && !opponentZoneMenu && !handMenu && (() => {
        const previewWidth = 280;
        const previewHeight = Math.round(previewWidth * 1.4);
        const imageUrl = getSharedCardImageUrl(hoveredCard.cardImgFile);
        if (!imageUrl) return null;

        // Position above-right of cursor by default, flip if overflowing
        let left = mousePos.x + 16;
        let top = mousePos.y - previewHeight - 16;

        if (typeof window !== 'undefined') {
          if (left + previewWidth > window.innerWidth - 8) {
            left = mousePos.x - previewWidth - 16;
          }
          if (top < 8) {
            top = mousePos.y + 16;
          }
        }

        return (
          <div
            style={{
              position: 'fixed',
              left,
              top,
              width: previewWidth,
              height: previewHeight,
              zIndex: 1000,
              pointerEvents: 'none',
              borderRadius: 6,
              boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 12px rgba(212,168,103,0.3)',
              overflow: 'hidden',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={hoveredCard.cardName}
              width={previewWidth}
              height={previewHeight}
              style={{
                display: 'block',
                width: previewWidth,
                height: previewHeight,
                borderRadius: 6,
                transform: hoveredCard.isMeek ? 'rotate(180deg)' : undefined,
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}
