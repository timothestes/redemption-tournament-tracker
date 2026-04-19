'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Stage, Layer, Rect, Text, Group, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';

import { useGameState } from '../hooks/useGameState';
import { useSpreadHand } from '../contexts/SpreadHandContext';
import { useMultiplayerImagePreloader } from '../hooks/useMultiplayerImagePreloader';
import {
  calculateMultiplayerLayout,
  type ZoneRect,
} from '../layout/multiplayerLayout';
import { toScreenPos, toDbPos, cardCenter, adjustAnchorForRotationChange } from '../utils/coordinateTransforms';
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
import { CardNotePopover } from './CardNotePopover';
import { MultiCardContextMenu } from '@/app/shared/components/MultiCardContextMenu';
import { ZoneContextMenu } from '@/app/shared/components/ZoneContextMenu';
import { DeckContextMenu } from '@/app/shared/components/DeckContextMenu';
import { DeckDropPopup } from '@/app/shared/components/DeckDropPopup';
import { LorContextMenu } from '@/app/shared/components/LorContextMenu';
import { OpponentZoneContextMenu } from '@/app/shared/components/OpponentZoneContextMenu';
import { HandContextMenu } from '@/app/shared/components/HandContextMenu';
import { ReserveContextMenu } from '@/app/shared/components/ReserveContextMenu';
import { ConsentDialog } from '@/app/shared/components/ConsentDialog';
import { OpponentBrowseModal } from '@/app/shared/components/OpponentBrowseModal';
import { showGameToast } from '@/app/shared/components/GameToast';
import type { GameActions } from '@/app/shared/types/gameActions';
import { ModalGameProvider, type ModalGameContextValue } from '@/app/shared/contexts/ModalGameContext';
import { DeckSearchModal } from '@/app/shared/components/DeckSearchModal';
import { DeckPeekModal } from '@/app/shared/components/DeckPeekModal';
import { getAbilitiesForCard } from '@/lib/cards/cardAbilities';
import { DeckExchangeModal } from '@/app/shared/components/DeckExchangeModal';
import { ZoneBrowseModal } from '@/app/shared/components/ZoneBrowseModal';
import { useModalCardDrag } from '@/app/shared/hooks/useModalCardDrag';
import type { ZoneId } from '@/app/shared/types/gameCard';
import type { ZoneRect as GoldfishZoneRect } from '@/app/goldfish/layout/zoneLayout';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import DiceOverlay from './DiceOverlay';
import { getCardImageUrl as getSharedCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useVirtualCanvas, VIRTUAL_WIDTH, VIRTUAL_HEIGHT, virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import { computeEquipOffset, hitTestWarrior, MAX_EQUIPPED_WEAPONS_PER_WARRIOR } from '@/app/goldfish/utils/equipLayout';
import { findCard, isWarrior, isWeapon, isSite } from '@/lib/cards/lookup';
import { normalizeDeckFormat } from '@/lib/deck-format';
import { SOUL_DECK_BACK_IMG } from '@/app/shared/paragon/soulDeck';
import { Link2Off } from 'lucide-react';
import { useCardScale } from '@/app/shared/hooks/useCardScale';
import { CardScaleControl } from '@/app/shared/components/CardScaleControl';
import { useLobArrivalEffect } from '@/app/shared/hooks/useLobArrivalEffect';
import type { UndoStack } from '../hooks/useUndoStack';

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
    reference: card.reference,
    alignment: card.alignment,
    isMeek: card.isMeek,
    isFlipped: card.isFlipped,
    isToken: card.isToken,
    zone: card.zone as GameCard['zone'],
    ownerId: owner,
    notes: card.notes,
    posX: card.posX ? parseFloat(card.posX) : undefined,
    posY: card.posY ? parseFloat(card.posY) : undefined,
    equippedTo: card.equippedToInstanceId !== 0n ? String(card.equippedToInstanceId) : undefined,
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

/** Build a human-readable fragment for an opponent-action request, used in the
 *  consent dialog (e.g. "draw 3 from the top of your deck"). */
function describeOpponentAction(action: string, paramsJson: string): string {
  let parsed: any = {};
  try { parsed = paramsJson ? JSON.parse(paramsJson) : {}; } catch {}
  const count = parsed.count ?? 0;
  const plural = count === 1 ? '' : 's';
  if (action === 'shuffle_and_draw') {
    const s = parsed.shuffleCount ?? 0;
    const d = parsed.drawCount ?? 0;
    return `shuffle ${s} random card${s === 1 ? '' : 's'} from your hand into your deck and draw ${d}`;
  }
  switch (action) {
    case 'shuffle_deck': return 'shuffle your deck';
    case 'look_deck_top': return `look at the top ${count} card${plural} of your deck`;
    case 'look_deck_bottom': return `look at the bottom ${count} card${plural} of your deck`;
    case 'look_deck_random': return `look at ${count} random card${plural} from your deck`;
    case 'reveal_deck_top': return `reveal the top ${count} card${plural} of your deck`;
    case 'reveal_deck_bottom': return `reveal the bottom ${count} card${plural} of your deck`;
    case 'reveal_deck_random': return `reveal ${count} random card${plural} from your deck`;
    case 'draw_deck_top': return `draw ${count} from the top of your deck`;
    case 'draw_deck_bottom': return `draw ${count} from the bottom of your deck`;
    case 'draw_deck_random': return `draw ${count} random card${plural} from your deck`;
    case 'discard_deck_top': return `discard the top ${count} card${plural} of your deck`;
    case 'discard_deck_bottom': return `discard the bottom ${count} card${plural} of your deck`;
    case 'discard_deck_random': return `discard ${count} random card${plural} from your deck`;
    case 'reserve_deck_top': return `send the top ${count} card${plural} of your deck to reserve`;
    case 'reserve_deck_bottom': return `send the bottom ${count} card${plural} of your deck to reserve`;
    case 'reserve_deck_random': return `send ${count} random card${plural} from your deck to reserve`;
    case 'random_hand_to_discard': return `discard ${count} random card${plural} from your hand`;
    case 'random_hand_to_reserve': return `send ${count} random card${plural} from your hand to reserve`;
    case 'random_hand_to_deck_top': return `send ${count} random card${plural} from your hand to the top of your deck`;
    case 'random_hand_to_deck_bottom': return `send ${count} random card${plural} from your hand to the bottom of your deck`;
    case 'random_hand_to_deck_shuffle': return `shuffle ${count} random card${plural} from your hand into your deck`;
    default: return 'perform an action on your deck';
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MultiplayerCanvasProps {
  gameId: bigint;
  onLoadDeck?: () => void;
  /** Client-side undo stack for recording reverse actions */
  undoStack?: UndoStack;
  /** Called when any search/browse modal opens or closes. `true` = at least one modal is open. */
  onSearchModalChange?: (isOpen: boolean) => void;
  /** Whether the game timer is visible (passed through to CardScaleControl). */
  isTimerVisible?: boolean;
  /** Toggle timer visibility (passed through to CardScaleControl). */
  onToggleTimer?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MultiplayerCanvas({ gameId, onLoadDeck, undoStack, onSearchModalChange, isTimerVisible, onToggleTimer }: MultiplayerCanvasProps) {
  const { setPreviewCard, isLoupeVisible } = useCardPreview();

  // ---- Container sizing (respects flex layout) ----
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY, containerWidth, containerHeight, virtualWidth } = useVirtualCanvas(containerRef);

  // ---- Game state ----
  const gameState = useGameState(gameId);
  const {
    myCards,
    opponentCards,
    sharedCards,
    counters,
    moveCard: rawMoveCard,
    moveCardsBatch: rawMoveCardsBatch,
    updateCardPosition,
    incomingSearchRequest,
    approvedSearchRequest,
    logSearchDeck,
    logLookAtTop,
    requestZoneSearch,
    requestOpponentAction,
    approveZoneSearch,
    denyZoneSearch,
    completeZoneSearch,
    moveOpponentCard,
    shuffleOpponentDeck,
    zoneSearchRequests,
  } = gameState;

  // Undo-aware wrappers for moveCard / moveCardsBatch used in drag handlers.
  const findCardForUndo = useCallback((id: string) => {
    for (const cards of Object.values(myCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    for (const cards of Object.values(opponentCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    return undefined;
  }, [myCards, opponentCards]);

  const moveCard: typeof rawMoveCard = useCallback(
    (cardInstanceId, toZone, zoneIndex, posX, posY, targetOwnerId) => {
      if (undoStack) {
        const card = findCardForUndo(String(cardInstanceId));
        if (card && card.zone !== toZone) {
          undoStack.push({
            description: `Moved ${card.cardName || 'card'} to ${toZone}`,
            reverseAction: () => rawMoveCard(cardInstanceId, card.zone, undefined, card.posX, card.posY, String(card.ownerId)),
          });
        }
      }
      rawMoveCard(cardInstanceId, toZone, zoneIndex, posX, posY, targetOwnerId);
    },
    [rawMoveCard, undoStack, findCardForUndo],
  );

  const moveCardsBatch: typeof rawMoveCardsBatch = useCallback(
    (cardInstanceIds, toZone, positions, targetOwnerId, fromSource) => {
      if (undoStack) {
        const ids: string[] = JSON.parse(cardInstanceIds);
        const originals = ids.map(id => {
          const card = findCardForUndo(id);
          return { id, zone: card?.zone, posX: card?.posX, posY: card?.posY, name: card?.cardName, ownerId: card?.ownerId };
        }).filter(o => o.zone && o.zone !== toZone);
        if (originals.length > 0) {
          const desc = originals.length === 1
            ? `Moved ${originals[0].name || 'card'} to ${toZone}`
            : `Moved ${originals.length} cards to ${toZone}`;
          undoStack.push({
            description: desc,
            reverseAction: () => {
              const byZone: Record<string, { id: string; posX: string; posY: string; ownerId: string }[]> = {};
              for (const o of originals) {
                const z = o.zone!;
                if (!byZone[z]) byZone[z] = [];
                byZone[z].push({ id: o.id, posX: o.posX || '', posY: o.posY || '', ownerId: String(o.ownerId ?? '') });
              }
              for (const [zone, cards] of Object.entries(byZone)) {
                if (cards.length === 1) {
                  rawMoveCard(BigInt(cards[0].id), zone, undefined, cards[0].posX, cards[0].posY, cards[0].ownerId);
                } else {
                  const positionsMap: Record<string, { posX: string; posY: string }> = {};
                  for (const c of cards) {
                    positionsMap[c.id] = { posX: c.posX, posY: c.posY };
                  }
                  rawMoveCardsBatch(
                    JSON.stringify(cards.map(c => c.id)),
                    zone,
                    JSON.stringify(positionsMap),
                    cards[0].ownerId,
                  );
                }
              }
            },
          });
        }
      }
      rawMoveCardsBatch(cardInstanceIds, toZone, positions, targetOwnerId, fromSource);
    },
    [rawMoveCardsBatch, rawMoveCard, undoStack, findCardForUndo],
  );

  const [claimBannerDismissed, setClaimBannerDismissed] = useState(false);

  // Reset claim banner when opponent reconnects
  useEffect(() => {
    if (!gameState.disconnectTimeoutFired) {
      setClaimBannerDismissed(false);
    }
  }, [gameState.disconnectTimeoutFired]);

  // ---- Layout ----
  // Normalize the raw game.format string (e.g. "Paragon Type 1", "Type 2") to
  // the canonical 'T1' | 'T2' | 'Paragon' expected by the layout function.
  const normalizedFormat = normalizeDeckFormat(gameState.game?.format ?? '');
  const mpLayout = useMemo(
    () => calculateMultiplayerLayout(virtualWidth, VIRTUAL_HEIGHT, normalizedFormat),
    [virtualWidth, normalizedFormat],
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
    };
  }, [mpLayout]);

  const myHandRect = mpLayout?.zones.playerHand ?? null;
  const opponentHandRect = mpLayout?.zones.opponentHand ?? null;

  // ---- LOB arrival glow effect ----
  const myLobIds = useMemo(
    () => (myCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [myCards],
  );
  const oppLobIds = useMemo(
    () => (opponentCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [opponentCards],
  );
  const { getGlowIntensity: getMyLobGlow } = useLobArrivalEffect(myLobIds);
  const { getGlowIntensity: getOppLobGlow } = useLobArrivalEffect(oppLobIds);

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
      ...Object.values(sharedCards).flat(),
    ];
    for (const card of allCards) {
      if (card.cardImgFile) {
        urls.push(getCardImageUrl(card.cardImgFile));
      }
    }
    return [...new Set(urls)];
  }, [myCards, opponentCards, sharedCards]);

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

  // Soul Deck back image (Paragon-only). Load once; re-render when ready.
  const soulDeckBackRef = useRef<HTMLImageElement | null>(null);
  const [soulDeckBackReady, setSoulDeckBackReady] = useState(false);
  useEffect(() => {
    if (normalizedFormat !== 'Paragon') return;
    if (soulDeckBackRef.current) return;
    const img = new window.Image();
    img.onload = () => {
      soulDeckBackRef.current = img;
      setSoulDeckBackReady(true);
    };
    img.src = SOUL_DECK_BACK_IMG;
  }, [normalizedFormat]);

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

  // (Hover → CardPreview context sync moved below findAnyCardById.)

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
  const [notePopover, setNotePopover] = useState<{
    cardId: string;
    x: number;
    y: number;
    initialValue: string;
  } | null>(null);

  // ---- Zone browse overlay state ----
  const [browseMyZone, setBrowseMyZone] = useState<string | null>(null);
  const [browseOpponentZone, setBrowseOpponentZone] = useState<string | null>(null);
  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; spawnX: number; spawnY: number; targetPlayerId?: string } | null>(null);
  const [deckMenu, setDeckMenu] = useState<{ x: number; y: number } | null>(null);
  // Paragon-only: right-click context menu for the shared Soul Deck pile. Shared by
  // both players, so there's no approval flow — handlers dispatch reducers directly.
  const [soulDeckMenu, setSoulDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [browseSoulDeck, setBrowseSoulDeck] = useState(false);
  const [soulDeckLookState, setSoulDeckLookState] = useState<
    { cardIds: string[]; title: string } | null
  >(null);
  const [lorMenu, setLorMenu] = useState<{ x: number; y: number } | null>(null);
  const [deckDrop, setDeckDrop] = useState<{ x: number; y: number; cardId: string; batchIds?: string[] } | null>(null);
  const pendingBatchRef = useRef<string[] | null>(null);
  const [showDeckSearch, setShowDeckSearch] = useState(false);
  const [peekState, setPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number; source?: { cardName: string } } | null>(null);
  const [lookState, setLookState] = useState<{ count: number; position: 'top' | 'bottom' | 'random' } | null>(null);
  const [exchangeState, setExchangeState] = useState<
    { cardIds: string[]; targetZone: ZoneId } | null
  >(null);
  const [opponentZoneMenu, setOpponentZoneMenu] = useState<{ x: number; y: number; zone: string; zoneName: string } | null>(null);
  const [opponentDeckMenu, setOpponentDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [opponentPeekState, setOpponentPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number } | null>(null);
  const [opponentLookState, setOpponentLookState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number } | null>(null);
  const [opponentRevealDismissed, setOpponentRevealDismissed] = useState(false);
  const [opponentRevealSnapshot, setOpponentRevealSnapshot] = useState<string[]>([]);
  const [handMenu, setHandMenu] = useState<{ x: number; y: number } | null>(null);
  const [opponentHandMenu, setOpponentHandMenu] = useState<{ x: number; y: number } | null>(null);
  const [reserveMenu, setReserveMenu] = useState<{ x: number; y: number } | null>(null);
  const [opponentReserveMenu, setOpponentReserveMenu] = useState<{ x: number; y: number } | null>(null);
  const revealAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revealBarShrinking, setRevealBarShrinking] = useState(false);

  // ---- Report search/browse modal open state to parent (for timer pause) ----
  useEffect(() => {
    if (!onSearchModalChange) return;
    const anyModalOpen = showDeckSearch ||
      browseMyZone !== null ||
      browseOpponentZone !== null ||
      peekState !== null ||
      exchangeState !== null ||
      opponentPeekState !== null ||
      opponentLookState !== null ||
      browseSoulDeck ||
      soulDeckLookState !== null ||
      (approvedSearchRequest != null &&
        !approvedSearchRequest.action &&
        approvedSearchRequest.zone !== 'hand-reveal' &&
        approvedSearchRequest.zone !== 'action-priority');
    onSearchModalChange(anyModalOpen);
  }, [
    onSearchModalChange,
    showDeckSearch,
    browseMyZone,
    browseOpponentZone,
    peekState,
    exchangeState,
    opponentPeekState,
    opponentLookState,
    browseSoulDeck,
    soulDeckLookState,
    approvedSearchRequest,
  ]);

  // ---- Turn 1 reserve protection ----
  // On each player's first turn, cards should not leave the reserve zone.
  // We show a gentle confirmation dialog instead of hard-blocking.
  type PendingReserveMove =
    | { kind: 'single'; execute: () => void }
    | { kind: 'batch'; execute: () => void };
  const [pendingReserveMove, setPendingReserveMove] = useState<PendingReserveMove | null>(null);

  // turnNumber only increments when play cycles back to seat 0 (see END_TURN reducer),
  // so both players' first turns share turnNumber === 1n — distinguish by currentTurn.
  const isMyFirstTurn = useMemo(() => {
    const { game, myPlayer } = gameState;
    if (!game || !myPlayer) return false;
    return game.turnNumber === BigInt(1) && game.currentTurn === myPlayer.seat;
  }, [gameState]);

  const isOpponentFirstTurn = useMemo(() => {
    const { game, opponentPlayer } = gameState;
    if (!game || !opponentPlayer) return false;
    return game.turnNumber === BigInt(1) && game.currentTurn === opponentPlayer.seat;
  }, [gameState]);

  // Skip reserve protection in goldfish/practice mode (no opponent)
  const hasOpponent = !!gameState.opponentPlayer;

  /** Look up a card instance by its string ID across my cards. */
  const findMyCardById = useCallback((id: string): CardInstance | undefined => {
    for (const cards of Object.values(myCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    return undefined;
  }, [myCards]);

  /** Look up a card instance by its string ID across both players' cards and shared zones. */
  const findAnyCardById = useCallback((id: string): CardInstance | undefined => {
    for (const cards of Object.values(myCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    for (const cards of Object.values(opponentCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    for (const cards of Object.values(sharedCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    return undefined;
  }, [myCards, opponentCards, sharedCards]);

  // Propagate hoveredCard to the shared CardPreview context (drives CardLoupePanel).
  // Resolve the live card (by instanceId) from the current zone data so fields like
  // `notes` stay fresh while the mouse is still hovering.
  const liveHoveredNotes = hoveredCard
    ? findAnyCardById(hoveredCard.instanceId)?.notes ?? hoveredCard.notes
    : '';
  useEffect(() => {
    if (hoveredCard) {
      setPreviewCard({
        cardName: hoveredCard.cardName,
        cardImgFile: hoveredCard.cardImgFile,
        isMeek: hoveredCard.isMeek,
        notes: liveHoveredNotes,
      });
    }
  }, [hoveredCard, liveHoveredNotes, setPreviewCard]);

  /**
   * Check if a move should be intercepted by the Turn 1 reserve protection rule.
   * Returns true if the move was intercepted (dialog shown), false if it should proceed.
   */
  const checkReserveProtection = useCallback((
    fromZone: string | undefined,
    toZone: string,
    execute: () => void,
  ): boolean => {
    if (!isMyFirstTurn || !hasOpponent) return false;
    if (fromZone !== 'reserve' || toZone === 'reserve') return false;
    setPendingReserveMove({ kind: 'single', execute });
    return true;
  }, [isMyFirstTurn, hasOpponent]);

  /**
   * Check if a batch move contains any cards leaving the reserve on Turn 1.
   * Returns true if intercepted.
   */
  const checkReserveBatchProtection = useCallback((
    cardIds: string[],
    toZone: string,
    execute: () => void,
  ): boolean => {
    if (!isMyFirstTurn || !hasOpponent) return false;
    if (toZone === 'reserve') return false;
    const anyFromReserve = cardIds.some(id => {
      const card = findMyCardById(id);
      return card?.zone === 'reserve';
    });
    if (!anyFromReserve) return false;
    setPendingReserveMove({ kind: 'batch', execute });
    return true;
  }, [isMyFirstTurn, hasOpponent, findMyCardById]);

  // ---- Multiplayer GameActions adapter ----
  // Wraps moveCard/moveCardsBatch with Turn 1 reserve protection and undo tracking.
  const multiplayerActions: GameActions = useMemo(() => ({
    moveCard: (cardId, toZone, posX, posY) => {
      const card = findMyCardById(cardId);
      const fromZone = card?.zone;
      const execute = () => {
        // Record undo entry before executing
        if (undoStack && card && fromZone && fromZone !== toZone) {
          const prevPosX = card.posX;
          const prevPosY = card.posY;
          undoStack.push({
            description: `Moved ${card.cardName || 'card'} to ${toZone}`,
            reverseAction: () => gameState.moveCard(BigInt(cardId), fromZone, undefined, prevPosX, prevPosY),
          });
        }
        gameState.moveCard(BigInt(cardId), toZone, undefined, posX, posY);
      };
      if (checkReserveProtection(fromZone, toZone, execute)) return;
      execute();
    },
    moveCardsBatch: (cardIds, toZone) => {
      const execute = () => {
        // Record undo entry: reverse each card back to its original zone
        if (undoStack && cardIds.length > 0) {
          const originals = cardIds.map(id => {
            const card = findMyCardById(id);
            return { id, zone: card?.zone, posX: card?.posX, posY: card?.posY, name: card?.cardName };
          }).filter(o => o.zone && o.zone !== toZone);
          if (originals.length > 0) {
            const desc = originals.length === 1
              ? `Moved ${originals[0].name || 'card'} to ${toZone}`
              : `Moved ${originals.length} cards to ${toZone}`;
            undoStack.push({
              description: desc,
              reverseAction: () => {
                // Group by original zone and move back
                const byZone: Record<string, { id: string; posX: string; posY: string }[]> = {};
                for (const o of originals) {
                  const z = o.zone!;
                  if (!byZone[z]) byZone[z] = [];
                  byZone[z].push({ id: o.id, posX: o.posX || '', posY: o.posY || '' });
                }
                for (const [zone, cards] of Object.entries(byZone)) {
                  if (cards.length === 1) {
                    gameState.moveCard(BigInt(cards[0].id), zone, undefined, cards[0].posX, cards[0].posY);
                  } else {
                    const positions: Record<string, { posX: string; posY: string }> = {};
                    for (const c of cards) {
                      positions[c.id] = { posX: c.posX, posY: c.posY };
                    }
                    gameState.moveCardsBatch(
                      JSON.stringify(cards.map(c => c.id)),
                      zone,
                      JSON.stringify(positions),
                    );
                  }
                }
              },
            });
          }
        }
        gameState.moveCardsBatch(JSON.stringify(cardIds), toZone);
      };
      if (checkReserveBatchProtection(cardIds, toZone, execute)) return;
      execute();
    },
    flipCard: (cardId) => {
      // Flip is a toggle — reverse is just flip again
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Flipped ${card?.cardName || 'card'}`,
          reverseAction: () => gameState.flipCard(BigInt(cardId)),
        });
      }
      gameState.flipCard(BigInt(cardId));
    },
    meekCard: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Set ${card?.cardName || 'card'} meek`,
          reverseAction: () => gameState.unmeekCard(BigInt(cardId)),
        });
      }
      gameState.meekCard(BigInt(cardId));
    },
    unmeekCard: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Removed meek from ${card?.cardName || 'card'}`,
          reverseAction: () => gameState.meekCard(BigInt(cardId)),
        });
      }
      gameState.unmeekCard(BigInt(cardId));
    },
    addCounter: (cardId, color) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Added ${color} counter to ${card?.cardName || 'card'}`,
          reverseAction: () => gameState.removeCounter(BigInt(cardId), color),
        });
      }
      gameState.addCounter(BigInt(cardId), color);
    },
    removeCounter: (cardId, color) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Removed ${color} counter from ${card?.cardName || 'card'}`,
          reverseAction: () => gameState.addCounter(BigInt(cardId), color),
        });
      }
      gameState.removeCounter(BigInt(cardId), color);
    },
    shuffleCardIntoDeck: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        const fromZone = card?.zone;
        if (fromZone && fromZone !== 'deck') {
          undoStack.push({
            description: `Shuffled ${card?.cardName || 'card'} into deck`,
            reverseAction: () => gameState.moveCard(BigInt(cardId), fromZone!, undefined, card?.posX, card?.posY),
          });
        }
      }
      gameState.shuffleCardIntoDeck(BigInt(cardId));
    },
    shuffleDeck: () => gameState.shuffleDeck(),
    setNote: (cardId, text) => gameState.setNote(BigInt(cardId), text),
    exchangeCards: (cardIds) => gameState.exchangeCards(JSON.stringify(cardIds)),
    drawCard: () => gameState.drawCard(),
    drawMultiple: (count) => gameState.drawMultiple(BigInt(count)),
    moveCardToTopOfDeck: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        const fromZone = card?.zone;
        if (fromZone && fromZone !== 'deck') {
          undoStack.push({
            description: `Moved ${card?.cardName || 'card'} to top of deck`,
            reverseAction: () => gameState.moveCard(BigInt(cardId), fromZone!, undefined, card?.posX, card?.posY),
          });
        }
      }
      gameState.moveCardToTopOfDeck(BigInt(cardId));
    },
    moveCardToBottomOfDeck: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        const fromZone = card?.zone;
        if (fromZone && fromZone !== 'deck') {
          undoStack.push({
            description: `Moved ${card?.cardName || 'card'} to bottom of deck`,
            reverseAction: () => gameState.moveCard(BigInt(cardId), fromZone!, undefined, card?.posX, card?.posY),
          });
        }
      }
      gameState.moveCardToBottomOfDeck(BigInt(cardId));
    },
    spawnLostSoul: (testament, posX, posY) =>
      gameState.spawnLostSoul(testament, posX ?? '0.5', posY ?? '0.5'),
    removeToken: (cardId) => gameState.removeToken(BigInt(cardId)),
    removeOpponentToken: undefined,
    executeCardAbility: (sourceInstanceId, abilityIndex) => {
      // Intercept modal-driven abilities (reveal_own_deck) client-side — the
      // server reducer throws SenderError for these. setPeekState → existing
      // useEffect broadcasts via revealCards so the opponent sees the reveal.
      const source = findMyCardById(sourceInstanceId);
      const ability = source ? getAbilitiesForCard(source.cardName)[abilityIndex] : undefined;
      if (ability?.type === 'reveal_own_deck') {
        setPeekState({
          position: ability.position,
          count: ability.count,
          source: { cardName: source!.cardName },
        });
        return;
      }
      gameState.executeCardAbility(sourceInstanceId, abilityIndex);
    },
    randomHandToZone: (count, toZone, deckPosition) =>
      gameState.randomHandToZone(count, toZone, deckPosition),
    randomReserveToZone: (count, toZone, deckPosition) =>
      gameState.randomReserveToZone(count, toZone, deckPosition),
    reloadDeck: (deckId, deckData, paragon) => gameState.reloadDeck(deckId, deckData, paragon),
    attachCard: (weaponId, warriorId) => {
      gameState.attachCard(BigInt(weaponId), BigInt(warriorId));
    },
    detachCard: (cardId, posX, posY) => {
      gameState.detachCard(
        BigInt(cardId),
        posX !== undefined ? String(posX) : '',
        posY !== undefined ? String(posY) : '',
      );
    },
  }), [gameState, findMyCardById, checkReserveProtection, checkReserveBatchProtection, undoStack]);

  // ---- ModalGameProvider value (for shared deck modals) ----
  const modalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: Object.fromEntries(
      Object.entries(myCards).map(([zone, cards]) => [
        zone,
        cards.map(c => cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1'))
      ])
    ),
    actions: {
      moveCard: (id, toZone, _idx, posX, posY) => {
        const card = findMyCardById(String(id));
        const fromZone = card?.zone;
        const execute = () => gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString());
        if (checkReserveProtection(fromZone, String(toZone), execute)) return;
        execute();
      },
      moveCardsBatch: (ids, toZone) => {
        const execute = () => gameState.moveCardsBatch(JSON.stringify(ids), String(toZone));
        if (checkReserveBatchProtection(ids.map(String), String(toZone), execute)) return;
        execute();
      },
      moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
      moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
      shuffleDeck: () => gameState.shuffleDeck(),
      shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
      exchangeFromDeck: (exchangeCardIds, replacementMoves) => {
        gameState.exchangeFromDeck(
          JSON.stringify(exchangeCardIds),
          JSON.stringify(replacementMoves),
        );
      },
    },
  }), [myCards, counters, gameState, findMyCardById, checkReserveProtection, checkReserveBatchProtection]);

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

  // ---- ModalGameProvider value for shared Soul Deck modals (Paragon). Shared
  //      pile — no reserve protection, no consent flow. ----
  const soulDeckModalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: Object.fromEntries(
      Object.entries(sharedCards).map(([zone, cards]) => [
        zone,
        cards.map(c => cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1'))
      ])
    ),
    actions: {
      moveCard: (id, toZone, _idx, posX, posY) =>
        gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString()),
      moveCardsBatch: (ids, toZone) =>
        gameState.moveCardsBatch(JSON.stringify(ids), String(toZone)),
      // The shared Soul Deck has no "deck" semantics — redirect the generic
      // "Top/Bottom of Deck" and "Shuffle into Deck" context-menu actions back
      // to 'soul-deck' so they don't escape into the viewer's private deck and
      // corrupt both piles.
      moveCardToTopOfDeck: (id) => gameState.moveCard(BigInt(id), 'soul-deck', '0'),
      moveCardToBottomOfDeck: (id) => gameState.moveCard(BigInt(id), 'soul-deck'),
      shuffleDeck: () => gameState.shuffleSoulDeck(),
      shuffleCardIntoDeck: (_id) => gameState.shuffleSoulDeck(),
    },
  }), [sharedCards, counters, gameState]);

  // ---- Combined zones for context menu (includes both players' cards so counters
  //      update live when right-clicking opponent cards) ----
  const allZonesForContextMenu = useMemo(() => {
    const myZonesMap = modalGameValue.zones as Record<string, GameCard[]>;
    const oppZonesMap = opponentModalGameValue.zones as Record<string, GameCard[]>;
    const combined: Record<string, GameCard[]> = {};
    const allKeys = new Set([...Object.keys(myZonesMap), ...Object.keys(oppZonesMap)]);
    for (const key of allKeys) {
      combined[key] = [...(myZonesMap[key] ?? []), ...(oppZonesMap[key] ?? [])];
    }
    return combined;
  }, [modalGameValue.zones, opponentModalGameValue.zones]);

  // ---- Close all menus helper ----
  const closeAllMenus = useCallback(() => {
    setContextMenu(null);
    setMultiCardContextMenu(null);
    setNotePopover(null);
    setZoneMenu(null);
    setDeckMenu(null);
    setLorMenu(null);
    setDeckDrop(null);
    setShowDeckSearch(false);
    setPeekState(null);
    setLookState(null);
    setExchangeState(null);
    setBrowseMyZone(null);
    setBrowseOpponentZone(null);
    setOpponentZoneMenu(null);
    setOpponentDeckMenu(null);
    setOpponentPeekState(null);
    setOpponentLookState(null);
    setHandMenu(null);
    setOpponentHandMenu(null);
    setReserveMenu(null);
    setOpponentReserveMenu(null);
    setSoulDeckMenu(null);
    setBrowseSoulDeck(false);
    setSoulDeckLookState(null);
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
    const fromSource = position === 'top' ? 'top-of-deck' : position === 'bottom' ? 'bottom-of-deck' : 'random-from-deck';
    if (ids.length > 0) {
      const execute = () => gameState.moveCardsBatch(JSON.stringify(ids), targetZone, undefined, undefined, fromSource);
      if (checkReserveBatchProtection(ids, targetZone, execute)) return;
      execute();
    }
  }, [myCards, gameState, checkReserveBatchProtection]);

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
    const ids = selected.map(c => String(c.id));
    const fromSource = position === 'top' ? 'top-of-deck' : position === 'bottom' ? 'bottom-of-deck' : 'random-from-deck';
    if (ids.length > 0) gameState.moveCardsBatch(JSON.stringify(ids), targetZone, undefined, undefined, fromSource);
  }, [opponentCards, gameState]);

  // ---- Shared Soul Deck handlers (Paragon). Pick N card IDs from the shared
  //      soul-deck by position, then reveal (→ shared LoB) or look (private). ----
  const handleSharedSoulDeckContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      setSoulDeckMenu({ x: e.evt.clientX, y: e.evt.clientY });
    },
    [],
  );

  const pickSoulDeckIds = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number): string[] => {
      const pile = [...(sharedCards['soul-deck'] ?? [])].sort(
        (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex),
      );
      if (pile.length === 0) return [];
      const count = Math.min(n, pile.length);
      if (mode === 'top') return pile.slice(0, count).map(c => String(c.id));
      if (mode === 'bottom') return pile.slice(-count).map(c => String(c.id));
      const shuffled = [...pile];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count).map(c => String(c.id));
    },
    [sharedCards],
  );

  const revealFromSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      if ((sharedCards['soul-deck'] ?? []).length === 0) {
        showGameToast('Soul Deck is empty');
        return;
      }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      // Rescue-attempt reveals are intentionally non-undoable — skip the undo wrapper.
      if (ids.length === 1) {
        gameState.moveCard(BigInt(ids[0]), 'land-of-bondage');
      } else {
        gameState.moveCardsBatch(JSON.stringify(ids), 'land-of-bondage');
      }
    },
    [sharedCards, pickSoulDeckIds, gameState],
  );

  const lookAtSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      if ((sharedCards['soul-deck'] ?? []).length === 0) {
        showGameToast('Soul Deck is empty');
        return;
      }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      const count = ids.length;
      const title = mode === 'top'
        ? `Looking at Top ${count} of Soul Deck`
        : mode === 'bottom'
          ? `Looking at Bottom ${count} of Soul Deck`
          : `Looking at Random ${count} from Soul Deck`;
      setSoulDeckLookState({ cardIds: ids, title });
    },
    [sharedCards, pickSoulDeckIds],
  );

  const searchSoulDeck = useCallback(() => {
    setSoulDeckMenu(null);
    setBrowseSoulDeck(true);
  }, []);

  const handleShuffleSoulDeck = useCallback(() => {
    setSoulDeckMenu(null);
    gameState.shuffleSoulDeck();
  }, [gameState]);

  const soulDeckDragTopIdRef = useRef<string | null>(null);

  // ---- Drag state ----
  const isDraggingRef = useRef(false);
  const dragEndTimeRef = useRef<number>(0);
  const dragSourceZoneRef = useRef<string | null>(null);
  const dragOriginalPosRef = useRef<{ x: number; y: number } | null>(null);
  // Local coords in the original parent (before reparenting to the layer).
  // Used by snapBack to restore the card inside its source Group accurately.
  const dragOriginalLocalPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Tracks the rendered card dimensions during drag (pile vs territory vs LOB). */
  const dragCardSizeRef = useRef<{ w: number; h: number } | null>(null);
  /** Tracks the original parent Group so we can move the node back on snap-back. */
  const dragOriginalParentRef = useRef<Konva.Container | null>(null);
  /** Tracks the card's z-index within its original parent so we can restore stacking order after drag. */
  const dragOriginalZIndexRef = useRef<number | null>(null);
  const [dragHoverZone, setDragHoverZone] = useState<DropZoneKey | null>(null);
  const dragHoverZoneRef = useRef<DropZoneKey | null>(null);
  // Re-renderable signal so overlays (e.g. detach icons) can hide during drag.
  const [isCardDraggingUi, setIsCardDraggingUi] = useState(false);
  // Timer that delays revealing drag-only overlays until DB state settles.
  const dragSettleTimerRef = useRef<number | null>(null);

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
  // Ghost image for multi-card drag — a single rasterized snapshot of all followers
  const dragGhostRef = useRef<Konva.Image | null>(null);
  const dragGhostLayerRef = useRef<Konva.Layer | null>(null);
  const dragGhostOffsetRef = useRef<{ dx: number; dy: number } | null>(null);

  // ---- Zone hit-testing ----
  /**
   * Find which zone a point falls into, checking both player and opponent zones
   * plus hand zone. Priority: my zones first, then opponent free-form zones.
   */
  const findZoneAtPosition = useCallback(
    (x: number, y: number): { zone: DropZoneKey; owner: 'my' | 'opponent' | 'shared' } | null => {
      if (!mpLayout || !myHandRect) return null;

      // Check my hand zone
      if (pointInRect(x, y, myHandRect)) {
        return { zone: 'hand', owner: 'my' };
      }

      // Check opponent hand zone
      if (opponentHandRect && pointInRect(x, y, opponentHandRect)) {
        return { zone: 'hand', owner: 'opponent' };
      }

      // Paragon: the shared LoB is a drop target that resets ownership to the shared sentinel.
      if (normalizedFormat === 'Paragon' && mpLayout.zones.sharedLob && pointInRect(x, y, mpLayout.zones.sharedLob)) {
        return { zone: 'land-of-bondage', owner: 'shared' };
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
    [mpLayout, myZones, opponentZones, myHandRect, opponentHandRect, normalizedFormat],
  );

  // Dragging the Soul Deck pile: capture the top soul's ID at drag-start,
  // hit-test the drop point at drag-end, move the top soul into the shared
  // LoB if dropped there. Pile always snaps back to (0,0) since its inner
  // shapes carry absolute coords.
  const handleSoulDeckPileDragStart = useCallback(
    (_e: Konva.KonvaEventObject<DragEvent>) => {
      const sorted = [...(sharedCards['soul-deck'] ?? [])].sort(
        (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex),
      );
      soulDeckDragTopIdRef.current = sorted.length > 0 ? String(sorted[0].id) : null;
    },
    [sharedCards],
  );

  const handleSoulDeckPileDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const topId = soulDeckDragTopIdRef.current;
      soulDeckDragTopIdRef.current = null;
      const dragNode = e.target;
      const dragX = dragNode.x();
      const dragY = dragNode.y();
      dragNode.position({ x: 0, y: 0 });

      if (!topId) return;
      const sharedLobRect = mpLayout?.zones.sharedLob;
      const soulDeckZone = mpLayout?.zones.soulDeck;
      if (!sharedLobRect || !soulDeckZone) return;

      const pileWidth = Math.min(lobCard.cardWidth, soulDeckZone.width - 4);
      const pileHeight = Math.round(pileWidth * 1.4);
      const centerX = soulDeckZone.x + (soulDeckZone.width - pileWidth) / 2 + pileWidth / 2 + dragX;
      const centerY = soulDeckZone.y + (soulDeckZone.height - pileHeight) / 2 + pileHeight / 2 + dragY;

      const hit = findZoneAtPosition(centerX, centerY);
      if (!hit || hit.owner !== 'shared' || hit.zone !== 'land-of-bondage') return;

      const db = toDbPos(centerX - pileWidth / 2, centerY - pileHeight / 2, sharedLobRect, 'my', {
        cardWidth: lobCard.cardWidth,
        cardHeight: lobCard.cardHeight,
      });
      gameState.moveCard(BigInt(topId), 'land-of-bondage', undefined, String(db.x), String(db.y), '0');
    },
    [sharedCards, mpLayout, lobCard.cardWidth, lobCard.cardHeight, findZoneAtPosition, gameState],
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
    validDropRef: modalValidDropRef,
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

      const execute = () => {
        if (zone && posX != null && posY != null) {
          const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
          const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
          const db = toDbPos(posX, posY, zone, owner, clamp);
          gameState.moveCard(BigInt(id), String(toZone), undefined, db.x.toString(), db.y.toString(), ownerId);
        } else {
          gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString(), ownerId);
        }
      };
      const card = findMyCardById(id);
      if (checkReserveProtection(card?.zone, String(toZone), execute)) return;
      execute();
    },
    moveCardsBatch: (ids: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => {
      const execute = () => {
        if (positions && (toZone === 'territory' || toZone === 'land-of-bondage')) {
          const first = positions[ids[0]];
          const hit = first ? findZoneAtPosition(first.posX + cardWidth / 2, first.posY + cardHeight / 2) : null;
          const isOppZone = hit?.owner === 'opponent';
          const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];
          const ownerId = isOppZone && gameState.opponentPlayer
            ? String(gameState.opponentPlayer.id)
            : gameState.myPlayer ? String(gameState.myPlayer.id) : '';
          if (zone) {
            const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
            const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
            const normalized: Record<string, { posX: string; posY: string }> = {};
            for (const id of ids) {
              const p = positions[id];
              if (!p) continue;
              const db = toDbPos(p.posX, p.posY, zone, owner, clamp);
              normalized[id] = { posX: db.x.toString(), posY: db.y.toString() };
            }
            gameState.moveCardsBatch(JSON.stringify(ids), String(toZone), JSON.stringify(normalized), ownerId);
            return;
          }
        }
        gameState.moveCardsBatch(JSON.stringify(ids), String(toZone));
      };
      if (checkReserveBatchProtection(ids, String(toZone), execute)) return;
      execute();
    },
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
    startMultiDrag: opponentModalStartMultiDrag,
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
        const execute = () => {
          // Determine which player's zone was hit so we can normalize correctly
          const hit = posX != null && posY != null
            ? findZoneAtPosition(posX + cardWidth / 2, posY + cardHeight / 2)
            : null;
          const isOppZone = hit?.owner === 'opponent';
          const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];

          let normX = posX?.toString();
          let normY = posY?.toString();
          if (zone && posX != null && posY != null) {
            const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
            const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
            const db = toDbPos(posX, posY, zone, owner, clamp);
            normX = db.x.toString();
            normY = db.y.toString();
          }
          moveOpponentCard(
            BigInt(approvedSearchRequest.id),
            BigInt(id),
            String(toZone),
            normX,
            normY
          );
        };
        // T1 reserve protection for opponent's reserve
        if (isOpponentFirstTurn && approvedSearchRequest.zone === 'reserve' && toZone !== 'reserve') {
          setPendingReserveMove({ kind: 'single', execute });
        } else {
          execute();
        }
      }
    },
    moveCardsBatch: (ids: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => {
      if (approvedSearchRequest) {
        const execute = () => {
          if (positions && (toZone === 'territory' || toZone === 'land-of-bondage')) {
            const first = positions[ids[0]];
            const hit = first ? findZoneAtPosition(first.posX + cardWidth / 2, first.posY + cardHeight / 2) : null;
            const isOppZone = hit?.owner === 'opponent';
            const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];
            if (zone) {
              const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
              const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
              for (const id of ids) {
                const p = positions[id];
                if (!p) {
                  moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone));
                  continue;
                }
                const db = toDbPos(p.posX, p.posY, zone, owner, clamp);
                moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone), db.x.toString(), db.y.toString());
              }
              return;
            }
          }
          for (const id of ids) {
            moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone));
          }
        };
        // T1 reserve protection for opponent's reserve
        if (isOpponentFirstTurn && approvedSearchRequest.zone === 'reserve' && toZone !== 'reserve') {
          setPendingReserveMove({ kind: 'batch', execute });
        } else {
          execute();
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
      const prev = pendingSearchRef.current;
      const zone = prev.zone;
      const msg = prev.action ? 'Action denied'
        : zone === 'hand-reveal' ? 'Reveal request denied'
        : zone === 'action-priority' ? 'Priority request denied'
        : 'Search request denied';
      showGameToast(msg);
    }
    pendingSearchRef.current = myPending ?? null;
  }, [zoneSearchRequests, gameState.myPlayer, approvedSearchRequest]);

  // Auto-complete hand-reveal and action-priority requests — no browse modal needed
  useEffect(() => {
    if (approvedSearchRequest && approvedSearchRequest.zone === 'hand-reveal') {
      completeZoneSearch(BigInt(approvedSearchRequest.id));
      showGameToast('Opponent revealed their hand');
    }
    if (approvedSearchRequest && approvedSearchRequest.zone === 'action-priority') {
      completeZoneSearch(BigInt(approvedSearchRequest.id));
      showGameToast('Action priority granted — take your action');
    }
  }, [approvedSearchRequest, completeZoneSearch]);

  // Dispatch approved opponent-action requests — fires the appropriate reducer
  // client-side, then completes the request so the row is cleaned up.
  const dispatchedActionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!approvedSearchRequest || !approvedSearchRequest.action) return;
    const reqId = String(approvedSearchRequest.id);
    if (dispatchedActionRef.current === reqId) return;
    dispatchedActionRef.current = reqId;

    const { action, actionParams } = approvedSearchRequest;
    let params: { count?: number; shuffleCount?: number; drawCount?: number } = {};
    try { params = actionParams ? JSON.parse(actionParams) : {}; } catch {}
    const count = params.count ?? 0;
    const reqIdBig = BigInt(approvedSearchRequest.id);

    const complete = () => completeZoneSearch(reqIdBig);

    switch (action) {
      case 'shuffle_deck':
        shuffleOpponentDeck(reqIdBig);
        complete();
        break;
      case 'look_deck_top':
        setOpponentLookState({ position: 'top', count });
        complete();
        break;
      case 'look_deck_bottom':
        setOpponentLookState({ position: 'bottom', count });
        complete();
        break;
      case 'look_deck_random':
        setOpponentLookState({ position: 'random', count });
        complete();
        break;
      case 'reveal_deck_top':
        setOpponentPeekState({ position: 'top', count });
        complete();
        break;
      case 'reveal_deck_bottom':
        setOpponentPeekState({ position: 'bottom', count });
        complete();
        break;
      case 'reveal_deck_random':
        setOpponentPeekState({ position: 'random', count });
        complete();
        break;
      case 'draw_deck_top':
        moveOpponentDeckCardsToZone('top', count, 'hand');
        complete();
        break;
      case 'draw_deck_bottom':
        moveOpponentDeckCardsToZone('bottom', count, 'hand');
        complete();
        break;
      case 'draw_deck_random':
        moveOpponentDeckCardsToZone('random', count, 'hand');
        complete();
        break;
      case 'discard_deck_top':
        moveOpponentDeckCardsToZone('top', count, 'discard');
        complete();
        break;
      case 'discard_deck_bottom':
        moveOpponentDeckCardsToZone('bottom', count, 'discard');
        complete();
        break;
      case 'discard_deck_random':
        moveOpponentDeckCardsToZone('random', count, 'discard');
        complete();
        break;
      case 'reserve_deck_top':
        moveOpponentDeckCardsToZone('top', count, 'reserve');
        complete();
        break;
      case 'reserve_deck_bottom':
        moveOpponentDeckCardsToZone('bottom', count, 'reserve');
        complete();
        break;
      case 'reserve_deck_random':
        moveOpponentDeckCardsToZone('random', count, 'reserve');
        complete();
        break;
      case 'random_hand_to_discard':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'discard', '');
        complete();
        break;
      case 'random_hand_to_reserve':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'reserve', '');
        complete();
        break;
      case 'random_hand_to_deck_top':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'deck', 'top');
        complete();
        break;
      case 'random_hand_to_deck_bottom':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'deck', 'bottom');
        complete();
        break;
      case 'random_hand_to_deck_shuffle':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'deck', 'shuffle');
        complete();
        break;
      case 'shuffle_and_draw':
        gameState.opponentShuffleAndDraw(reqIdBig, params.shuffleCount ?? 0, params.drawCount ?? 0);
        complete();
        break;
      default:
        // Unknown action — complete to unblock, then warn.
        complete();
        console.warn('Unknown opponent action:', action);
    }
  }, [approvedSearchRequest, completeZoneSearch, shuffleOpponentDeck, moveOpponentDeckCardsToZone, gameState]);

  // Track opponent hand reveal — show/hide countdown bar
  const oppHandRevealed = gameState.opponentPlayer?.handRevealed ?? false;
  useEffect(() => {
    if (oppHandRevealed) {
      setRevealBarShrinking(false);
      // Start shrinking after a frame so the transition animates
      const frame = requestAnimationFrame(() => setRevealBarShrinking(true));
      return () => cancelAnimationFrame(frame);
    } else {
      setRevealBarShrinking(false);
    }
  }, [oppHandRevealed]);

  // Cleanup auto-hide timer on unmount
  useEffect(() => {
    return () => {
      if (revealAutoHideRef.current) clearTimeout(revealAutoHideRef.current);
    };
  }, []);

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

  // ---- Look card IDs (private peek — no broadcast to opponent) ----
  const lookCardIds = useMemo(() => {
    if (!lookState) return [];
    const sorted = [...(myCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof sorted;
    if (lookState.position === 'top') selected = sorted.slice(0, lookState.count);
    else if (lookState.position === 'bottom') selected = sorted.slice(-lookState.count);
    else {
      const shuffled = [...sorted];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, lookState.count);
    }
    return selected.map(c => String(c.id));
  }, [lookState, myCards]);

  // Broadcast revealed cards to opponent via SpacetimeDB. Dedup: peekCardIds
  // returns a fresh array reference whenever myCards updates (which happens
  // on any subscription event), so compare serialized contents against the
  // last-sent ref to avoid firing the reducer twice for the same reveal.
  const peekCardIdsRef = useRef<string>('');
  useEffect(() => {
    if (peekCardIds.length === 0) {
      peekCardIdsRef.current = '';
      return;
    }
    const serialized = JSON.stringify(peekCardIds);
    if (peekCardIdsRef.current === serialized) return;
    peekCardIdsRef.current = serialized;
    const context = peekState?.source
      ? JSON.stringify({
          sourceCardName: peekState.source.cardName,
          position: peekState.position,
          count: peekState.count,
        })
      : '';
    gameState.revealCards(serialized, context);
  }, [peekCardIds, peekState]);

  // Opponent's revealed cards — driven by SpacetimeDB player.revealedCards
  const opponentRevealedCardIds = useMemo(() => {
    const raw = gameState.opponentPlayer?.revealedCards;
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }, [gameState.opponentPlayer?.revealedCards]);

  // Snapshot revealed card IDs when they arrive — persist until opponent dismisses or clears
  useEffect(() => {
    if (opponentRevealedCardIds.length > 0) {
      setOpponentRevealSnapshot(opponentRevealedCardIds);
      setOpponentRevealDismissed(false);
    } else if (opponentRevealSnapshot.length > 0) {
      setOpponentRevealSnapshot([]);
      setOpponentRevealDismissed(true);
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

  // Private look at opponent's deck — never broadcasts
  const opponentLookCardIds = useMemo(() => {
    if (!opponentLookState) return [];
    const sorted = [...(opponentCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof sorted;
    if (opponentLookState.position === 'top') selected = sorted.slice(0, opponentLookState.count);
    else if (opponentLookState.position === 'bottom') selected = sorted.slice(-opponentLookState.count);
    else {
      const shuffled = [...sorted];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, opponentLookState.count);
    }
    return selected.map(c => String(c.id));
  }, [opponentLookState, opponentCards]);

  // ---- Drag handlers ----

  const handleCardDragStart = useCallback(
    (card: GameCard) => {
      isDraggingRef.current = true;
      if (dragSettleTimerRef.current !== null) {
        clearTimeout(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }
      setIsCardDraggingUi(true);
      dragSourceZoneRef.current = card.zone;

      // Turn off Konva's pixel-based hit detection for the duration of the drag.
      // Hit graph = an offscreen canvas where every listening shape is painted in a
      // unique color; on every pointermove Konva reads the pixel under the cursor
      // via getImageData to decide the target. With many visible cards that read
      // dominates CPU. During a drag we determine the target zone ourselves via
      // findZoneAtPosition, so Konva's hit test is pure overhead. Re-enabled in
      // handleCardDragEnd. Konva's drag system captures pointer events at the
      // document level so the drag itself keeps working while the layer is silenced.
      const gameLayer = gameLayerRef.current;
      if (gameLayer) gameLayer.listening(false);

      // If there is an active selection and the dragged card is not part of it,
      // clear the selection so the stale highlight doesn't persist.
      if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
        clearSelection();
      }

      // Determine the card's rendered dimensions based on its source zone.
      // Pile zones render at pileCardWidth/pileCardHeight, LOB at lobCard size,
      // everything else at the main cardWidth/cardHeight.
      if (SIDEBAR_PILE_ZONES.includes(card.zone as any)) {
        dragCardSizeRef.current = { w: pileCardWidth, h: pileCardHeight };
      } else if (isAutoArrangeZone(card.zone)) {
        dragCardSizeRef.current = { w: lobCard.cardWidth, h: lobCard.cardHeight };
      } else {
        dragCardSizeRef.current = { w: cardWidth, h: cardHeight };
      }

      // Store original position for snap-back (updated below after reparenting)
      const node = cardNodeRefs.current.get(card.instanceId);
      if (node) {
        // Move the card node to the top of the game layer so it escapes
        // any clipped parent Group and renders above all other zones/cards
        // during the drag.
        const layer = gameLayerRef.current;
        // Capture the node's local position in its original parent BEFORE
        // reparenting — snap-back restores these coords into the same parent.
        dragOriginalLocalPosRef.current = { x: node.x(), y: node.y() };
        if (layer && node.parent !== layer) {
          // Save original parent and z-index so we can restore on snap-back
          dragOriginalParentRef.current = node.parent as Konva.Container;
          dragOriginalZIndexRef.current = node.zIndex();
          // Convert the node's position from its current parent's coordinate
          // space to the layer's coordinate space. Without this, cards nested
          // in offset Groups (e.g. sidebar pile cards at local (0,0) inside a
          // Group at (cx, cy)) would jump to (0,0) in layer coords and become
          // unable to drag left due to the canvas-bounds clamp.
          const absPos = node.getAbsolutePosition();
          node.moveTo(layer);
          node.setAbsolutePosition(absPos);
        } else {
          dragOriginalParentRef.current = null;
          dragOriginalZIndexRef.current = null;
        }
        // Capture position after reparenting so drag-move logic uses layer coords
        dragOriginalPosRef.current = { x: node.x(), y: node.y() };
        node.moveToTop();
        layer?.batchDraw();
      }

      // Clear hover state
      setHoveredInstanceId(null);
      setHoveredCard(null);
      setHoverReady(false);
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
      stopHoverAnimation();

      // Multi-card drag: rasterize followers into a single ghost image.
      // Follower set: multi-select takes precedence; otherwise, for a warrior
      // being dragged within my own territory, attached weapons come along.
      const isMultiSelectDrag = selectedIds.has(card.instanceId) && selectedIds.size > 1;
      // A host being dragged carries its attached accessories along.
      // Applies to territory warriors (with weapons) and LOB souls (with sites).
      const followerZones: readonly string[] = ['territory', 'land-of-bondage'];
      const equipFollowerIds: string[] =
        !isMultiSelectDrag && followerZones.includes(card.zone) && card.ownerId === 'player1'
          ? (myCards[card.zone] ?? [])
              .filter((c) => c.equippedToInstanceId === BigInt(card.instanceId))
              .map((c) => String(c.id))
          : [];
      const followerIds: string[] = isMultiSelectDrag
        ? Array.from(selectedIds).filter((id) => id !== card.instanceId)
        : equipFollowerIds;

      if (followerIds.length > 0) {
        const dragNode = cardNodeRefs.current.get(card.instanceId);
        if (dragNode) {
          const offsets = new Map<string, { dx: number; dy: number }>();
          const baseX = dragNode.x();
          const baseY = dragNode.y();

          const followers: { id: string; node: Konva.Group; dx: number; dy: number }[] = [];
          for (const id of followerIds) {
            const node = cardNodeRefs.current.get(id);
            if (node) {
              const dx = node.x() - baseX;
              const dy = node.y() - baseY;
              offsets.set(id, { dx, dy });
              followers.push({ id, node, dx, dy });
            }
          }
          dragFollowerOffsets.current = offsets;

          if (followers.length > 0) {
            // Use getClientRect to get the actual visual bounding box of each follower,
            // which correctly handles rotation=180 (opponent cards).
            const dragRect = dragNode.getClientRect({ skipTransform: false, skipShadow: true, skipStroke: true });
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const followerRects: { f: typeof followers[0]; rect: { x: number; y: number; width: number; height: number } }[] = [];
            for (const f of followers) {
              const rect = f.node.getClientRect({ skipTransform: false, skipShadow: true, skipStroke: true });
              // Compute visual offset relative to drag card's visual top-left
              const relX = rect.x - dragRect.x;
              const relY = rect.y - dragRect.y;
              followerRects.push({ f, rect: { x: relX, y: relY, width: rect.width, height: rect.height } });
              minX = Math.min(minX, relX);
              minY = Math.min(minY, relY);
              maxX = Math.max(maxX, relX + rect.width);
              maxY = Math.max(maxY, relY + rect.height);
            }
            const ghostW = maxX - minX;
            const ghostH = maxY - minY;

            // Sort followers by zoneIndex so the ghost image preserves stacking order
            // (lower zoneIndex drawn first = underneath; higher drawn last = on top).
            followerRects.sort((a, b) => {
              const aCard = findAnyCardById(a.f.id);
              const bCard = findAnyCardById(b.f.id);
              return Number(aCard?.zoneIndex ?? 0) - Number(bCard?.zoneIndex ?? 0);
            });

            const offscreen = document.createElement('canvas');
            offscreen.width = ghostW * 2;
            offscreen.height = ghostH * 2;
            const ctx = offscreen.getContext('2d');
            if (ctx) {
              ctx.scale(2, 2);
              ctx.globalAlpha = 0.5;
              for (const { f, rect } of followerRects) {
                const cardCanvas = f.node.toCanvas({ pixelRatio: 1 });
                ctx.drawImage(cardCanvas, rect.x - minX, rect.y - minY, rect.width, rect.height);
              }

              // Position the ghost relative to the drag card's visual top-left
              // The ghost layer has the same scale/offset as the game layer,
              // so we need to convert from screen coords back to virtual coords.
              const ghostImage = new KonvaLib.Image({
                image: offscreen,
                // Convert screen-space offset to virtual coords by dividing by scale
                x: dragRect.x / scale - offsetX / scale + minX / scale,
                y: dragRect.y / scale - offsetY / scale + minY / scale,
                width: ghostW / scale,
                height: ghostH / scale,
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
    [selectedIds, stopHoverAnimation, cardWidth, cardHeight, pileCardWidth, pileCardHeight, lobCard.cardWidth, lobCard.cardHeight, scale, offsetX, offsetY, findAnyCardById, myCards],
  );

  const handleCardDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;

      // Use the dragged card's actual rendered size, not the territory default
      const dragW = dragCardSizeRef.current?.w ?? cardWidth;
      const dragH = dragCardSizeRef.current?.h ?? cardHeight;

      // Clamp card position to virtual canvas bounds
      const clampedX = Math.max(-dragW / 2, Math.min(node.x(), virtualWidth - dragW / 2));
      const clampedY = Math.max(-dragH / 2, Math.min(node.y(), VIRTUAL_HEIGHT - dragH / 2));
      if (clampedX !== node.x() || clampedY !== node.y()) {
        node.x(clampedX);
        node.y(clampedY);
      }

      const x = node.x();
      const y = node.y();
      // For rotation=180 cards (opponent territory), the node position is
      // the bottom-right corner, so compute center accordingly.
      const rot = (node as Konva.Group).rotation?.() ?? 0;
      const center = cardCenter(x, y, dragW, dragH, rot);
      const hit = findZoneAtPosition(center.x, center.y);
      const zoneKey = hit ? `${hit.owner}:${hit.zone}` : null;

      // Only trigger re-render when hovered zone changes
      if (zoneKey !== dragHoverZoneRef.current) {
        dragHoverZoneRef.current = zoneKey;
        setDragHoverZone(zoneKey);
      }

      // Multi-card drag: move the single ghost image
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
      const originalLocalPos = dragOriginalLocalPosRef.current;
      const sourceZone = dragSourceZoneRef.current;
      const originalParent = dragOriginalParentRef.current;
      const originalZIndex = dragOriginalZIndexRef.current;
      // Capture the dragged card's actual rendered size before resetting
      const dragW = dragCardSizeRef.current?.w ?? cardWidth;
      const dragH = dragCardSizeRef.current?.h ?? cardHeight;

      // Reset drag state
      isDraggingRef.current = false;
      // Delay revealing drag-only overlays (e.g. detach icons) until the
      // SpacetimeDB subscription has a chance to deliver the new posX/posY.
      // Without the delay, the overlay renders from stale state for a frame
      // and the icon visibly flashes at the pre-drag position.
      if (dragSettleTimerRef.current !== null) {
        clearTimeout(dragSettleTimerRef.current);
      }
      dragSettleTimerRef.current = window.setTimeout(() => {
        dragSettleTimerRef.current = null;
        setIsCardDraggingUi(false);
      }, 220);
      dragEndTimeRef.current = performance.now();
      dragSourceZoneRef.current = null;
      dragOriginalPosRef.current = null;
      dragOriginalLocalPosRef.current = null;
      dragCardSizeRef.current = null;
      dragOriginalParentRef.current = null;
      dragOriginalZIndexRef.current = null;
      dragHoverZoneRef.current = null;
      dragFollowerOffsets.current = null;
      dragGhostOffsetRef.current = null;
      setDragHoverZone(null);

      // Re-enable layer listening (disabled in handleCardDragStart for perf).
      const gameLayer = gameLayerRef.current;
      if (gameLayer) gameLayer.listening(true);

      // Clean up ghost image and restore card visibility
      if (dragGhostRef.current) {
        dragGhostRef.current.destroy();
        dragGhostRef.current = null;
        dragGhostLayerRef.current?.batchDraw();
      }
      // Restore follower visibility
      if (followerOffsets) {
        for (const [id] of followerOffsets) {
          const fNode = cardNodeRefs.current.get(id);
          if (fNode) fNode.visible(true);
        }
      }

      const node = e.target;
      const dropX = node.x();
      const dropY = node.y();
      // For rotation=180 cards (opponent territory), the node position is
      // the bottom-right corner, so compute center accordingly.
      // Use the actual dragged card dimensions, not the territory default.
      const dropRot = (node as Konva.Group).rotation?.() ?? 0;
      const center = cardCenter(dropX, dropY, dragW, dragH, dropRot);
      const hit = findZoneAtPosition(center.x, center.y);

      const isMultiSelectDrag = selectedIds.has(card.instanceId) && selectedIds.size > 1;
      const hasEquipFollowers =
        !isMultiSelectDrag && followerOffsets !== null && followerOffsets.size > 0;
      const isGroupDrag = isMultiSelectDrag || hasEquipFollowers;
      // Sort selected card IDs by their current zoneIndex so the server
      // assigns new zoneIndices in the same relative order — prevents
      // card order from getting scrambled during group drags.
      const cardIds = isMultiSelectDrag
        ? Array.from(selectedIds).sort((a, b) => {
            const aCard = findAnyCardById(a);
            const bCard = findAnyCardById(b);
            return Number(aCard?.zoneIndex ?? BigInt(0)) - Number(bCard?.zoneIndex ?? BigInt(0));
          })
        : hasEquipFollowers
        ? [card.instanceId, ...Array.from(followerOffsets!.keys())]
        : [card.instanceId];
      const cardId = BigInt(card.instanceId);

      // Helper to snap back to original position and restore to original parent.
      // During dragStart the node was reparented from its clipped Group to the
      // layer so it renders above everything. On snap-back we need to reverse
      // that — move it back to the original parent and convert position from
      // layer coords back to the parent's local coords.
      const snapBack = () => {
        if (originalParent && node.parent !== originalParent) {
          node.moveTo(originalParent);
          // Restore the node's position in its original parent's coord space.
          // Using the pre-reparent local coords avoids the offset accumulation
          // that would occur if we applied layer-local coords inside a parent
          // that itself has a non-zero transform (e.g. sidebar pile Groups).
          if (originalLocalPos) {
            node.x(originalLocalPos.x);
            node.y(originalLocalPos.y);
          } else if (originalPos) {
            node.x(originalPos.x);
            node.y(originalPos.y);
          }
          // Restore original z-index so stacking order is preserved after snap-back
          if (originalZIndex != null) {
            const maxIdx = originalParent.getChildren().length - 1;
            node.zIndex(Math.min(originalZIndex, maxIdx));
          }
        } else if (originalPos) {
          node.x(originalPos.x);
          node.y(originalPos.y);
        }
        node.getLayer()?.batchDraw();
      };

      if (!hit) {
        // No valid drop zone — snap primary and followers back to original positions
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        snapBack();
        return;
      }

      const targetZone = hit.zone;
      // Same zone = same zone name AND same owner (my hand ≠ opponent hand)
      const sourceOwner = card.ownerId === 'player1' ? 'my' : 'opponent';
      const isSameZone = targetZone === sourceZone && hit.owner === sourceOwner;

      // Equip: if a weapon is dropped on a warrior in the local player's
      // territory, attach instead of moving. Gated to single-card drags
      // (group drags are intentional batch moves, not equip intents).
      //
      // Note: `hitTestWarrior` was written for goldfish where GameCard.posX/posY
      // are pixel coords. In multiplayer they're normalized 0–1 DB values, so
      // we convert each candidate's position to virtual-canvas pixels first.
      if (
        !isGroupDrag &&
        targetZone === 'territory' &&
        hit.owner === 'my' &&
        card.ownerId === 'player1'
      ) {
        const cardMeta = findCard(card.cardName, card.cardSet, card.cardImgFile);
        const myTerritoryZone = myZones['territory'];
        if (isWeapon(cardMeta) && myTerritoryZone) {
          const myTerritoryRaw = myCards['territory'] ?? [];
          const myTerritoryCards = myTerritoryRaw.map((c) => {
            const adapted = cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1');
            if (adapted.posX !== undefined && adapted.posY !== undefined) {
              const { x, y } = toScreenPos(adapted.posX, adapted.posY, myTerritoryZone, 'my');
              return { ...adapted, posX: x, posY: y };
            }
            return adapted;
          });
          const warriorCandidates = myTerritoryCards.filter((c) => {
            if (c.instanceId === card.instanceId) return false;
            if (c.equippedTo) return false;
            const meta = findCard(c.cardName, c.cardSet, c.cardImgFile);
            if (!isWarrior(meta)) return false;
            const attached = myTerritoryCards.filter((x) => x.equippedTo === c.instanceId);
            return attached.length < MAX_EQUIPPED_WEAPONS_PER_WARRIOR;
          });
          const hitWarrior = hitTestWarrior(
            center.x,
            center.y,
            cardWidth,
            cardHeight,
            warriorCandidates,
            card.instanceId,
          );
          if (hitWarrior) {
            gameState.attachCard(cardId, BigInt(hitWarrior.instanceId));
            snapBack();
            return;
          }
        }
      }

      // Site attach in LOB: the site is always the accessory, the other card
      // is always the host — regardless of which one the user dragged.
      //   - Dragged site → any free LOB card becomes the host.
      //   - Dragged non-site → a free LOB site becomes the accessory, the
      //     dragged card becomes the host.
      // Gated to single-card drags. Note: we check geometrically against the
      // LOB zone rect (plus the peek extension above) rather than relying on
      // `targetZone === 'land-of-bondage'` — attached sites peek above the
      // zone, and a drop on the peeking portion lands in territory's rect.
      if (!isGroupDrag && card.ownerId === 'player1') {
        const myLobZone = myZones['land-of-bondage'];
        const peekUp = myLobZone
          ? lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO
          : 0;
        const dropInLobArea = !!(
          myLobZone &&
          center.x >= myLobZone.x &&
          center.x <= myLobZone.x + myLobZone.width &&
          center.y >= myLobZone.y - peekUp &&
          center.y <= myLobZone.y + myLobZone.height
        );
        const cardMeta = findCard(card.cardName, card.cardSet, card.cardImgFile);
        const draggedIsSite = isSite(cardMeta);
        if (myLobZone && dropInLobArea) {
          const myLobRaw = myCards['land-of-bondage'] ?? [];
          const sortedLob = [...myLobRaw].sort(
            (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex),
          );
          const lobHosts = sortedLob.filter((c) => c.equippedToInstanceId === 0n);
          const slotPositions = calculateAutoArrangePositions(
            lobHosts.length,
            myLobZone,
            lobCard.cardWidth,
            lobCard.cardHeight,
          );
          // Build pseudo-GameCards for the candidates with pixel posX/posY
          // taken from their auto-arrange slot (not their stored posX/posY).
          const lobCandidates = lobHosts.map((c, i) => {
            const slot = slotPositions[i];
            const adapted = cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1');
            return {
              ...adapted,
              posX: slot?.x,
              posY: slot?.y,
            };
          });
          // Filter by role. Dragged site → candidates are any free non-site
          // LOB cards (that don't already host an accessory). Dragged non-site
          // → candidates are free sites in LOB.
          const candidates = lobCandidates.filter((c) => {
            if (c.instanceId === card.instanceId) return false;
            if (c.equippedTo) return false;
            if (c.posX === undefined || c.posY === undefined) return false;
            const meta = findCard(c.cardName, c.cardSet, c.cardImgFile);
            const candidateIsSite = isSite(meta);
            if (draggedIsSite) {
              // Host candidate: any non-site LOB card with space for an accessory.
              if (candidateIsSite) return false;
              const attached = lobCandidates.filter((x) => x.equippedTo === c.instanceId);
              return attached.length < MAX_EQUIPPED_WEAPONS_PER_WARRIOR;
            }
            // Dragged non-site → accessory candidate is a free site.
            return candidateIsSite;
          });
          const hitHost = hitTestWarrior(
            center.x,
            center.y,
            lobCard.cardWidth,
            lobCard.cardHeight,
            candidates,
            card.instanceId,
          );
          if (hitHost) {
            // Site is always the accessory, other card is always the host.
            const siteId = draggedIsSite ? cardId : BigInt(hitHost.instanceId);
            const hostId = draggedIsSite ? BigInt(hitHost.instanceId) : cardId;
            gameState.attachCard(siteId, hostId);
            snapBack();
            return;
          }
        }
      }

      // Resolve the zone rect for the drop target so we can store normalized positions
      // (0–1 ratios). This ensures cards render at the correct proportional position
      // regardless of each player's screen/window size.
      const zoneRect =
        hit.owner === 'my'
          ? myZones[targetZone]
          : hit.owner === 'opponent'
          ? opponentZones[targetZone]
          : mpLayout?.zones.sharedLob;
      // Resolve target owner ID — always set to the target zone's owner so
      // cards transfer ownership when moving between players' zones.
      const targetOwnerId =
        hit.owner === 'shared'
          ? '0'
          : hit.owner === 'my' && gameState.myPlayer
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
      const sourceIsRotated = sourceOwner === 'opponent' && (isFreeFormZone(sourceZone ?? '') || isAutoArrangeZone(sourceZone ?? '') || SIDEBAR_PILE_ZONES.includes(sourceZone as any));
      const targetIsRotated = isOpponentTarget && isFreeFormZone(targetZone);
      const { x: adjDropX, y: adjDropY } = adjustAnchorForRotationChange(
        dropX, dropY, dragW, dragH, sourceIsRotated, targetIsRotated,
      );

      const targetOwner: 'my' | 'opponent' = isOpponentTarget ? 'opponent' : 'my';
      const clampOpts = isFreeFormZone(targetZone) ? { cardWidth, cardHeight } : undefined;
      const toDb = (px: number, py: number) => toDbPos(px, py, zoneRect!, targetOwner, clampOpts);

      // Same free-form zone: just update position.
      // Restore the node to its original parent Group first — it was reparented
      // to the layer during dragStart and needs to go back so React-Konva's tree
      // stays in sync and the clipping Group works correctly.
      if (isSameZone && isFreeFormZone(targetZone)) {
        if (originalParent && node.parent !== originalParent) {
          const absPos = node.getAbsolutePosition();
          node.moveTo(originalParent);
          node.setAbsolutePosition(absPos);
        }
        if (isGroupDrag) {
          // Followers are already at drop positions from handleCardDragMove; confirm positions
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              const fNode = cardNodeRefs.current.get(id);
              if (fNode) {
                if (originalParent && fNode.parent !== originalParent) {
                  const fAbsPos = fNode.getAbsolutePosition();
                  fNode.moveTo(originalParent);
                  fNode.setAbsolutePosition(fAbsPos);
                }
                fNode.x(dropX + offset.dx);
                fNode.y(dropY + offset.dy);
              }
            }
          }
          // Preserve relative z-order within the group, but place the entire
          // group above all other cards. Collect the group's Konva nodes and
          // moveToTop in an order that keeps attached weapons BELOW their
          // warrior (weapons first, then warriors). Within each class, preserve
          // zoneIndex ordering. moveToTop is last-wins, so emitting weapons
          // first leaves them beneath the warriors that are moved afterward.
          if (originalParent) {
            type GroupNode = { node: Konva.Node; zoneIndex: number; isWeapon: boolean };
            const groupNodes: GroupNode[] = [];
            const leadCard = findAnyCardById(card.instanceId);
            groupNodes.push({
              node,
              zoneIndex: Number(leadCard?.zoneIndex ?? 0),
              isWeapon: !!(leadCard && leadCard.equippedToInstanceId && leadCard.equippedToInstanceId !== 0n),
            });
            if (followerOffsets) {
              for (const [id] of followerOffsets) {
                const fNode = cardNodeRefs.current.get(id);
                if (fNode) {
                  const fCard = findAnyCardById(id);
                  groupNodes.push({
                    node: fNode,
                    zoneIndex: Number(fCard?.zoneIndex ?? 0),
                    isWeapon: !!(fCard && fCard.equippedToInstanceId && fCard.equippedToInstanceId !== 0n),
                  });
                }
              }
            }
            groupNodes.sort((a, b) => {
              if (a.isWeapon !== b.isWeapon) return a.isWeapon ? -1 : 1;
              return a.zoneIndex - b.zoneIndex;
            });
            for (const { node: gNode } of groupNodes) {
              gNode.moveToTop();
            }
          }
          // Build positions for batch move (normalized 0–1)
          const leadDb = toDb(dropX, dropY);
          const positions: Record<string, { posX: string; posY: string }> = {
            [card.instanceId]: { posX: String(leadDb.x), posY: String(leadDb.y) },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              const fDb = toDb(dropX + offset.dx, dropY + offset.dy);
              positions[id] = { posX: String(fDb.x), posY: String(fDb.y) };
            }
          }
          moveCardsBatch(
            JSON.stringify(cardIds),
            targetZone,
            JSON.stringify(positions),
          );
          clearSelection();
        } else {
          const singleDb = toDb(dropX, dropY);
          updateCardPosition(cardId, String(singleDb.x), String(singleDb.y));
        }
        return;
      }

      // Same non-free-form zone
      if (isSameZone && !isFreeFormZone(targetZone)) {
        // Hand: compute drop index and reorder
        if (targetZone === 'hand' && hit.owner === 'my' && myHandRect) {
          const handCards = myCards['hand'] ?? [];
          if (handCards.length > 1) {
            const positions = calculateHandPositions(
              handCards.length,
              myHandRect,
              cardWidth,
              cardHeight,
              isSpreadHand,
            );
            let targetIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < positions.length; i++) {
              const dist = Math.abs(positions[i].x + cardWidth / 2 - center.x);
              if (dist < minDist) {
                minDist = dist;
                targetIdx = i;
              }
            }
            const draggedCardId = card.instanceId;
            const currentIdx = handCards.findIndex((c) => String(c.id) === draggedCardId);
            if (currentIdx !== -1 && currentIdx !== targetIdx) {
              const newOrder = [...handCards];
              const [dragged] = newOrder.splice(currentIdx, 1);
              newOrder.splice(targetIdx, 0, dragged);
              gameState.reorderHand(JSON.stringify(newOrder.map((c) => String(c.id))));
            }
          }
        }
        // Snap followers back to their original positions
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        snapBack();
        return;
      }

      // Turn 1 reserve protection — check before executing the move
      if (sourceZone === 'reserve' && targetZone !== 'reserve' && isMyFirstTurn && hasOpponent) {
        const executeDragMove = () => {
          // Re-execute the move logic without protection check
          if (isGroupDrag) {
            if (targetZone === 'deck') {
              moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
            } else if (isFreeFormZone(targetZone)) {
              const leadDb = toDb(adjDropX, adjDropY);
              const positions: Record<string, { posX: string; posY: string }> = {
                [card.instanceId]: { posX: String(leadDb.x), posY: String(leadDb.y) },
              };
              if (followerOffsets) {
                for (const [id, offset] of followerOffsets) {
                  const fDb = toDb(adjDropX + offset.dx, adjDropY + offset.dy);
                  positions[id] = { posX: String(fDb.x), posY: String(fDb.y) };
                }
              }
              moveCardsBatch(JSON.stringify(cardIds), targetZone, JSON.stringify(positions), targetOwnerId);
            } else {
              moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
            }
          } else if (isFreeFormZone(targetZone)) {
            const db = toDb(adjDropX, adjDropY);
            moveCard(cardId, targetZone, '', String(db.x), String(db.y), targetOwnerId);
          } else if (isAutoArrangeZone(targetZone)) {
            moveCard(cardId, targetZone, '', '0', '0', targetOwnerId);
          } else {
            moveCard(cardId, targetZone, '', undefined, undefined, targetOwnerId);
          }
          if (isGroupDrag) clearSelection();
        };
        setPendingReserveMove({ kind: isGroupDrag ? 'batch' : 'single', execute: executeDragMove });
        snapBack();
        return;
      }

      // Different zone — perform move.
      // For deck drops that show a popup, we snap the card back instead of
      // destroying the node. This prevents the card from disappearing if the
      // user cancels the popup without picking an option.
      const isDeckDropWithPopup = targetZone === 'deck' && stageRef.current;

      if (isDeckDropWithPopup) {
        // Deck drop: snap card back to original position while popup is open.
        // The reducer will fire when the user picks an option, and the
        // subscription update will properly move the card.
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        snapBack();
      } else {
        // Non-deck zone: destroy the reparented node so React-Konva creates
        // a fresh node in the correct parent Group with correct dimensions.
        const draggedNode = cardNodeRefs.current.get(card.instanceId);
        if (draggedNode) {
          cardNodeRefs.current.delete(card.instanceId);
          draggedNode.destroy();
        }
        // Also clean up any follower nodes that were reparented
        if (followerOffsets) {
          for (const [id] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              cardNodeRefs.current.delete(id);
              fNode.destroy();
            }
          }
        }
        gameLayerRef.current?.batchDraw();
      }

      if (isGroupDrag) {
        if (targetZone === 'deck') {
          // Show deck drop popup for batch
          const stage = stageRef.current;
          if (stage) {
            const screenPos = virtualToScreen(center.x, center.y, scale, offsetX, offsetY);
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
          const leadDb = toDb(adjDropX, adjDropY);
          const positions: Record<string, { posX: string; posY: string }> = {
            [card.instanceId]: { posX: String(leadDb.x), posY: String(leadDb.y) },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              const fDb = toDb(adjDropX + offset.dx, adjDropY + offset.dy);
              positions[id] = { posX: String(fDb.x), posY: String(fDb.y) };
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
        const db = toDb(adjDropX, adjDropY);
        moveCard(cardId, targetZone, '', String(db.x), String(db.y), targetOwnerId);
      } else if (isAutoArrangeZone(targetZone)) {
        // Auto-arrange zone: positions are ignored by rendering
        moveCard(cardId, targetZone, '', '0', '0', targetOwnerId);
      } else if (targetZone === 'deck') {
        const stage = stageRef.current;
        if (stage) {
          const screenPos = virtualToScreen(center.x, center.y, scale, offsetX, offsetY);
          setDeckDrop({
            x: screenPos.x,
            y: screenPos.y,
            cardId: String(cardId),
          });
        } else {
          moveCard(cardId, targetZone, '0', undefined, undefined, targetOwnerId);
        }
      } else {
        // Stacked zone — omit zoneIndex so server auto-appends to end
        moveCard(cardId, targetZone, '', undefined, undefined, targetOwnerId);
      }
    },
    [
      findZoneAtPosition,
      findAnyCardById,
      moveCard,
      moveCardsBatch,
      updateCardPosition,
      cardWidth,
      cardHeight,
      selectedIds,
      clearSelection,
      myZones,
      opponentZones,
      mpLayout,
      gameState.myPlayer,
      gameState.opponentPlayer,
      scale,
      offsetX,
      offsetY,
      myCards,
      isMyFirstTurn,
      hasOpponent,
      gameState,
      counters,
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

  const handleSharedLobContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      closeAllMenus();
      const sharedRect = mpLayout?.zones.sharedLob;
      if (!sharedRect) return;
      const layer = gameLayerRef.current;
      const pointer = layer?.getRelativePointerPosition();
      const spawnX = pointer ? (pointer.x - sharedRect.x) / sharedRect.width : 0.5;
      const spawnY = pointer ? (pointer.y - sharedRect.y) / sharedRect.height : 0.5;
      setZoneMenu({
        x: e.evt.clientX,
        y: e.evt.clientY,
        spawnX,
        spawnY,
        targetPlayerId: '0',
      });
    },
    [mpLayout, closeAllMenus],
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
      e.cancelBubble = true;
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
    const willBeMeek = !card.isMeek;
    if (card.isMeek) {
      multiplayerActions.unmeekCard(card.instanceId);
    } else {
      multiplayerActions.meekCard(card.instanceId);
    }
    setPreviewCard({
      cardName: card.cardName,
      cardImgFile: card.cardImgFile,
      isMeek: willBeMeek,
      notes: card.notes,
    });
  }, [multiplayerActions, setPreviewCard]);
  const noopDblClick = useCallback((_card: GameCard) => {}, []);
  const noopContextMenu = useCallback((_card: GameCard, _e: Konva.KonvaEventObject<PointerEvent>) => {}, []);

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

  // ---- LOB layout: host + attached-accessory positions ----
  // LOB packs cards in a horizontal strip. Attached sites render BEHIND the
  // host, with a small portion peeking upward (my side) or downward (opponent
  // side, rotated 180°). `LOB_ATTACH_PEEK_VISIBLE_RATIO` is the fraction of
  // the site's height that pokes out beyond the host — the rest (e.g. 85%)
  // tucks behind. Hosts still use plain auto-arrange slots (no extra slot).
  const LOB_ATTACH_PEEK_VISIBLE_RATIO = 0.15;

  const myLobLayout = useMemo(() => {
    const hostPositions = new Map<string, { x: number; y: number }>();
    const accessoryPositions = new Map<
      string,
      { x: number; y: number; seamX: number; seamY: number }
    >();
    const cards = myCards['land-of-bondage'] ?? [];
    const zone = myZones['land-of-bondage'];
    if (!zone || cards.length === 0) {
      return { hostPositions, accessoryPositions };
    }
    const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
    const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
    const accessoriesByHost = new Map<bigint, CardInstance[]>();
    for (const c of sorted) {
      if (c.equippedToInstanceId === 0n) continue;
      const list = accessoriesByHost.get(c.equippedToInstanceId);
      if (list) list.push(c);
      else accessoriesByHost.set(c.equippedToInstanceId, [c]);
    }
    const slotPositions = calculateAutoArrangePositions(
      hosts.length,
      zone,
      lobCard.cardWidth,
      lobCard.cardHeight,
    );
    const peekUp = lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO;
    hosts.forEach((host, i) => {
      const hostSlot = slotPositions[i];
      if (!hostSlot) return;
      hostPositions.set(String(host.id), hostSlot);
      const accessories = accessoriesByHost.get(host.id);
      if (!accessories) return;
      accessories.forEach((acc, ai) => {
        // Accessory sits directly above the host, 15% visible above, 85%
        // tucked behind. Each stacked accessory (rare) peeks a bit higher
        // than the previous.
        const ay = hostSlot.y - peekUp * (ai + 1);
        accessoryPositions.set(String(acc.id), {
          x: hostSlot.x,
          y: ay,
          // Seam in the overlap band (between accessory's bottom and host's
          // top), horizontally centered on the host.
          seamX: hostSlot.x + lobCard.cardWidth * 0.5,
          seamY: hostSlot.y,
        });
      });
    });
    return { hostPositions, accessoryPositions };
  }, [myCards, myZones, lobCard.cardWidth, lobCard.cardHeight]);

  const opponentLobLayout = useMemo(() => {
    const hostPositions = new Map<string, { x: number; y: number }>();
    const accessoryPositions = new Map<string, { x: number; y: number }>();
    const cards = opponentCards['land-of-bondage'] ?? [];
    const zone = opponentZones['land-of-bondage'];
    if (!zone || cards.length === 0) {
      return { hostPositions, accessoryPositions };
    }
    const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
    const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
    const accessoriesByHost = new Map<bigint, CardInstance[]>();
    for (const c of sorted) {
      if (c.equippedToInstanceId === 0n) continue;
      const list = accessoriesByHost.get(c.equippedToInstanceId);
      if (list) list.push(c);
      else accessoriesByHost.set(c.equippedToInstanceId, [c]);
    }
    const slotPositions = calculateAutoArrangePositions(
      hosts.length,
      zone,
      lobCard.cardWidth,
      lobCard.cardHeight,
    );
    const peekAmount = lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO;
    hosts.forEach((host, i) => {
      const hostSlot = slotPositions[i];
      if (!hostSlot) return;
      hostPositions.set(String(host.id), hostSlot);
      const accessories = accessoriesByHost.get(host.id);
      if (!accessories) return;
      accessories.forEach((acc, ai) => {
        // Opponent LOB renders rotated 180°. The site should peek DOWNWARD
        // in screen coords (toward the center of the play area) so it's
        // visually oriented toward the player who owns it.
        // Accessory visual rect: (slot.x, slot.y + peekAmount*(ai+1)) to
        //                         (slot.x + w, slot.y + h + peekAmount*(ai+1)).
        // Anchor for rotation=180 is bottom-right.
        const anchorX = hostSlot.x + lobCard.cardWidth;
        const anchorY = hostSlot.y + lobCard.cardHeight + peekAmount * (ai + 1);
        accessoryPositions.set(String(acc.id), {
          x: anchorX,
          y: anchorY,
        });
      });
    });
    return { hostPositions, accessoryPositions };
  }, [opponentCards, opponentZones, lobCard.cardWidth, lobCard.cardHeight]);

  // Paragon-only: shared LoB hosts/accessory positions. No rotation mirror —
  // cards render upright (rotation=0) in the shared band between territories.
  const sharedLobLayout = useMemo(() => {
    const hostPositions = new Map<string, { x: number; y: number }>();
    const accessoryPositions = new Map<
      string,
      { x: number; y: number; seamX: number; seamY: number }
    >();
    const cards = sharedCards['land-of-bondage'] ?? [];
    const zone = mpLayout?.zones.sharedLob;
    if (!zone || cards.length === 0) {
      return { hostPositions, accessoryPositions };
    }
    const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
    const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
    const accessoriesByHost = new Map<bigint, CardInstance[]>();
    for (const c of sorted) {
      if (c.equippedToInstanceId === 0n) continue;
      const list = accessoriesByHost.get(c.equippedToInstanceId);
      if (list) list.push(c);
      else accessoriesByHost.set(c.equippedToInstanceId, [c]);
    }
    const slotPositions = calculateAutoArrangePositions(
      hosts.length,
      zone,
      lobCard.cardWidth,
      lobCard.cardHeight,
    );
    const peekUp = lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO;
    hosts.forEach((host, i) => {
      const hostSlot = slotPositions[i];
      if (!hostSlot) return;
      hostPositions.set(String(host.id), hostSlot);
      const accessories = accessoriesByHost.get(host.id);
      if (!accessories) return;
      accessories.forEach((acc, ai) => {
        const ay = hostSlot.y - peekUp * (ai + 1);
        accessoryPositions.set(String(acc.id), {
          x: hostSlot.x,
          y: ay,
          seamX: hostSlot.x + lobCard.cardWidth * 0.5,
          seamY: hostSlot.y,
        });
      });
    });
    return { hostPositions, accessoryPositions };
  }, [sharedCards, mpLayout, lobCard.cardWidth, lobCard.cardHeight]);

  // ---- Derive per-accessory screen positions + seam (for detach overlay) ----
  // Accessories (weapons in territory, sites in LOB) don't use their own posX/
  // posY at render time — they're anchored to their host at an offset so they
  // peek out from behind. `seam` is the point where the accessory meets the
  // host, used to position the "unlink" icon.
  const myDerivedWeaponPositions = useMemo(() => {
    const result = new Map<string, { x: number; y: number; seamX: number; seamY: number }>();

    // Territory attachments (warrior + weapon)
    const territory = myCards['territory'] ?? [];
    const myTerrZone = myZones['territory'];
    if (myTerrZone && territory.length > 0) {
      const byHost = new Map<bigint, CardInstance[]>();
      for (const c of territory) {
        if (c.equippedToInstanceId === 0n) continue;
        const list = byHost.get(c.equippedToInstanceId);
        if (list) list.push(c);
        else byHost.set(c.equippedToInstanceId, [c]);
      }
      for (const [hostId, accessories] of byHost) {
        const host = territory.find((c) => c.id === hostId);
        if (!host || !host.posX) continue;
        const { x: hostX, y: hostY } = toScreenPos(
          parseFloat(host.posX),
          parseFloat(host.posY),
          myTerrZone,
          'my',
        );
        accessories.forEach((w, i) => {
          const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
          const x = hostX + dx;
          const y = hostY + dy;
          const seam =
            i === 0
              ? { x: hostX, y: hostY }
              : (() => {
                  const { dx: adx, dy: ady } = computeEquipOffset(cardWidth, cardHeight, i - 1);
                  return { x: hostX + adx, y: hostY + ady };
                })();
          result.set(String(w.id), { x, y, seamX: seam.x, seamY: seam.y });
        });
      }
    }

    // LOB attachments (soul + site) — positions come from `myLobLayout`.
    for (const [id, pos] of myLobLayout.accessoryPositions) {
      result.set(id, pos);
    }

    return result;
  }, [myCards, myZones, cardWidth, cardHeight, myLobLayout]);

  // Opponent accessory offsets are mirror-flipped (opponent zones render
  // rotated 180° from the local player's perspective). Seams aren't tracked
  // for the opponent since detach is local-player-only.
  const opponentDerivedWeaponPositions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();

    // Territory attachments (warrior + weapon)
    const territory = opponentCards['territory'] ?? [];
    const oppTerrZone = opponentZones['territory'];
    if (oppTerrZone && territory.length > 0) {
      const byHost = new Map<bigint, CardInstance[]>();
      for (const c of territory) {
        if (c.equippedToInstanceId === 0n) continue;
        const list = byHost.get(c.equippedToInstanceId);
        if (list) list.push(c);
        else byHost.set(c.equippedToInstanceId, [c]);
      }
      for (const [hostId, accessories] of byHost) {
        const host = territory.find((c) => c.id === hostId);
        if (!host || !host.posX) continue;
        const { x: hostX, y: hostY } = toScreenPos(
          parseFloat(host.posX),
          parseFloat(host.posY),
          oppTerrZone,
          'opponent',
        );
        accessories.forEach((w, i) => {
          const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
          // Rotation=180 anchors cards at their bottom-right; flipping the offset
          // sign places accessories visually up-and-left from the opponent's perspective.
          result.set(String(w.id), { x: hostX - dx, y: hostY - dy });
        });
      }
    }

    // LOB attachments (soul + site) — positions come from `opponentLobLayout`.
    for (const [id, pos] of opponentLobLayout.accessoryPositions) {
      result.set(id, pos);
    }

    return result;
  }, [opponentCards, opponentZones, cardWidth, cardHeight, opponentLobLayout]);

  // ---- Card bounds for marquee selection (my + opponent free-form, LOB, hand cards) ----
  const allCardBounds = useMemo((): CardBound[] => {
    if (!mpLayout || !myHandRect) return [];
    const bounds: CardBound[] = [];

    // My free-form zone cards
    for (const zoneKey of FREE_FORM_ZONES) {
      const cards = myCards[zoneKey] ?? [];
      for (const card of cards) {
        const zone = myZones[zoneKey];
        let x: number, y: number;
        if (card.posX && zone) {
          ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), zone, 'my'));
        } else {
          x = (zone?.x ?? 0) + 20;
          y = (zone?.y ?? 0) + 24;
        }
        bounds.push({
          instanceId: String(card.id),
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          rotation: 0,
          owner: 'my',
        });
      }
    }

    // Opponent free-form zone cards (rotated 180°)
    for (const zoneKey of FREE_FORM_ZONES) {
      const cards = opponentCards[zoneKey] ?? [];
      for (const card of cards) {
        const zone = opponentZones[zoneKey];
        if (!zone) continue;
        const { x: anchorX, y: anchorY } = toScreenPos(
          card.posX ? parseFloat(card.posX) : 0,
          card.posY ? parseFloat(card.posY) : 0,
          zone, 'opponent',
        );
        // Rotation=180 means anchor is bottom-right corner; bounding box is (anchor-w, anchor-h) to (anchor)
        bounds.push({
          instanceId: String(card.id),
          x: anchorX - cardWidth,
          y: anchorY - cardHeight,
          width: cardWidth,
          height: cardHeight,
          rotation: 180,
          owner: 'opponent',
        });
      }
    }

    // My auto-arrange zone cards (LOB). Attached sites don't get a slot —
    // their bounds come from the derived offset relative to the host slot.
    for (const zoneKey of AUTO_ARRANGE_ZONES) {
      const cards = myCards[zoneKey] ?? [];
      const zone = myZones[zoneKey];
      if (cards.length > 0 && zone) {
        const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
        const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
        const positions = calculateAutoArrangePositions(hosts.length, zone, lobCard.cardWidth, lobCard.cardHeight);
        hosts.forEach((host, i) => {
          const pos = positions[i];
          if (!pos) return;
          bounds.push({
            instanceId: String(host.id),
            x: pos.x,
            y: pos.y,
            width: lobCard.cardWidth,
            height: lobCard.cardHeight,
            rotation: 0,
            owner: 'my',
          });
          const attached = sorted.filter((c) => c.equippedToInstanceId === host.id);
          for (const accessory of attached) {
            const derived = myDerivedWeaponPositions.get(String(accessory.id));
            if (!derived) continue;
            bounds.push({
              instanceId: String(accessory.id),
              x: derived.x,
              y: derived.y,
              width: lobCard.cardWidth,
              height: lobCard.cardHeight,
              rotation: 0,
              owner: 'my',
            });
          }
        });
      }
    }

    // Opponent auto-arrange zone cards (LOB, rotated 180°). Attached sites
    // use their derived anchor, which is pre-computed with the mirror offset.
    for (const zoneKey of AUTO_ARRANGE_ZONES) {
      const cards = opponentCards[zoneKey] ?? [];
      const zone = opponentZones[zoneKey];
      if (cards.length > 0 && zone) {
        const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
        const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
        const positions = calculateAutoArrangePositions(hosts.length, zone, lobCard.cardWidth, lobCard.cardHeight);
        hosts.forEach((host, i) => {
          const pos = positions[i];
          if (!pos) return;
          // Opponent LOB cards render at (pos.x + w, pos.y + h) with rotation=180.
          // Bounding box is (pos.x, pos.y) to (pos.x + w, pos.y + h).
          bounds.push({
            instanceId: String(host.id),
            x: pos.x,
            y: pos.y,
            width: lobCard.cardWidth,
            height: lobCard.cardHeight,
            rotation: 180,
            owner: 'opponent',
          });
          const attached = sorted.filter((c) => c.equippedToInstanceId === host.id);
          for (const accessory of attached) {
            const derived = opponentDerivedWeaponPositions.get(String(accessory.id));
            if (!derived) continue;
            // Derived anchor is bottom-right of the accessory (rotation=180).
            bounds.push({
              instanceId: String(accessory.id),
              x: derived.x - lobCard.cardWidth,
              y: derived.y - lobCard.cardHeight,
              width: lobCard.cardWidth,
              height: lobCard.cardHeight,
              rotation: 180,
              owner: 'opponent',
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
            owner: 'my',
          });
        }
      });
    }

    return bounds;
  }, [mpLayout, myHandRect, myZones, myCards, opponentZones, opponentCards, cardWidth, cardHeight, lobCard, isSpreadHand, myDerivedWeaponPositions, opponentDerivedWeaponPositions]);

  // ---- Stage mouse handlers for marquee selection ----
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return;

      // Only start selection on empty canvas (not on cards or clickable zones).
      // Walks target + ancestors; treats anything draggable, named "zone-click",
      // or with a click/tap listener as interactive so we don't swallow the click.
      let node: Konva.Node | null = e.target;
      let isInteractive = false;
      while (node && node !== stageRef.current) {
        const listeners = (node as any).eventListeners;
        if (
          node.draggable?.() ||
          node.name?.() === 'zone-click' ||
          listeners?.click ||
          listeners?.tap
        ) {
          isInteractive = true;
          break;
        }
        node = node.parent;
      }
      if (isInteractive) return;

      if (!e.evt.shiftKey && selectedIds.size > 0) {
        clearSelection();
      }

      const layer = gameLayerRef.current;
      if (!layer) return;
      const pos = layer.getRelativePointerPosition();
      if (!pos) return;
      startSelectionDrag(pos.x, pos.y, e.evt.shiftKey);
      // Silence the game layer's hit canvas while the marquee is active — same
      // reasoning as card drag. Stage-level mouse handlers still fire because
      // the Stage itself doesn't depend on layer hit detection. Re-enabled in
      // handleStageMouseUp.
      layer.listening(false);
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
      // Re-enable layer listening (silenced in handleStageMouseDown for perf).
      const layer = gameLayerRef.current;
      if (layer) layer.listening(true);
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
  const allZoneRects: { key: string; rect: ZoneRect; owner: 'my' | 'opponent' | 'shared' }[] = [];
  for (const [key, rect] of Object.entries(myZones)) {
    // Skip the collapsed zero-height per-seat LoB rect in Paragon — shared LoB takes over.
    if (normalizedFormat === 'Paragon' && key === 'land-of-bondage') continue;
    allZoneRects.push({ key: `my:${key}`, rect, owner: 'my' });
  }
  allZoneRects.push({ key: 'my:hand', rect: myHandRect, owner: 'my' });
  for (const [key, rect] of Object.entries(opponentZones)) {
    if (normalizedFormat === 'Paragon' && key === 'land-of-bondage') continue;
    allZoneRects.push({ key: `opponent:${key}`, rect, owner: 'opponent' });
  }
  if (opponentHandRect) {
    allZoneRects.push({ key: 'opponent:hand', rect: opponentHandRect, owner: 'opponent' });
  }
  if (normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob) {
    allZoneRects.push({ key: 'shared:land-of-bondage', rect: mpLayout.zones.sharedLob, owner: 'shared' });
  }

  return (
    <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
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
          {normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob && (
            <Rect
              x={mpLayout.zones.sharedLob.x}
              y={mpLayout.zones.sharedLob.y}
              width={mpLayout.zones.sharedLob.width}
              height={mpLayout.zones.sharedLob.height}
              fill="#1e1610"
              stroke="#6b4e27"
              strokeWidth={1}
              cornerRadius={3}
              opacity={0.45}
              onContextMenu={handleSharedLobContextMenu}
            />
          )}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.soulDeck && (
            <Rect
              x={mpLayout.zones.soulDeck.x}
              y={mpLayout.zones.soulDeck.y}
              width={mpLayout.zones.soulDeck.width}
              height={mpLayout.zones.soulDeck.height}
              fill="#1e1610"
              stroke="#6b4e27"
              strokeWidth={1}
              cornerRadius={3}
              opacity={0.45}
            />
          )}
          {Object.entries(myZones).map(([key, zone]) => {
            // LOB + territory zones get their label+badge rendered as an overlay after cards
            const isLob = isAutoArrangeZone(key);
            const isFreeForm = isFreeFormZone(key);
            const skipLabel = isLob || isFreeForm;
            const cardsInZone = myCards[key] ?? [];
            // Approximate label width: ~7px per uppercase char at fontSize 11 + letterSpacing 1
            const labelTextWidth = zone.label.toUpperCase().length * 7;
            const myPileContextHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              closeAllMenus();
              const pt = { x: e.evt.clientX, y: e.evt.clientY };
              if (key === 'deck') setDeckMenu(pt);
              else if (key === 'reserve') setReserveMenu(pt);
              else if (key === 'land-of-redemption') setLorMenu(pt);
              else if (key === 'discard' || key === 'banish') setBrowseMyZone(key);
            };
            const myPileClickHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              if (e.evt.button !== 0) return;
              if (key === 'discard' || key === 'banish' || key === 'reserve') setBrowseMyZone(key);
            };
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
                  onClick={SIDEBAR_PILE_ZONES.includes(key as (typeof SIDEBAR_PILE_ZONES)[number]) ? myPileClickHandler : undefined}
                  onContextMenu={isLob ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                    e.evt.preventDefault();
                    // Compute spawn position as normalized 0-1 within the LOB zone
                    const layer = gameLayerRef.current;
                    const pointer = layer?.getRelativePointerPosition();
                    const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
                    const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
                    setZoneMenu({ x: e.evt.clientX, y: e.evt.clientY, spawnX, spawnY });
                  } : SIDEBAR_PILE_ZONES.includes(key as (typeof SIDEBAR_PILE_ZONES)[number]) ? myPileContextHandler : undefined}
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
                      listening={false}
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
            const oppPileContextHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              closeAllMenus();
              const pt = { x: e.evt.clientX, y: e.evt.clientY };
              if (key === 'deck') setOpponentDeckMenu(pt);
              else if (key === 'reserve') setOpponentReserveMenu(pt);
              else if (key === 'discard' || key === 'banish') setBrowseOpponentZone(key);
            };
            const oppReserveRevealedBg = gameState.opponentPlayer?.reserveRevealed ?? false;
            const oppPileClickHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              if (e.evt.button !== 0) return;
              if (key === 'discard' || key === 'banish') setBrowseOpponentZone(key);
              else if (key === 'reserve' && oppReserveRevealedBg) setBrowseOpponentZone('reserve');
            };
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
                  onClick={SIDEBAR_PILE_ZONES.includes(key as (typeof SIDEBAR_PILE_ZONES)[number]) ? oppPileClickHandler : undefined}
                  onContextMenu={isLob ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                    e.evt.preventDefault();
                    const layer = gameLayerRef.current;
                    const pointer = layer?.getRelativePointerPosition();
                    const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
                    const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
                    const oppId = gameState.opponentPlayer?.id;
                    setZoneMenu({ x: e.evt.clientX, y: e.evt.clientY, spawnX, spawnY, targetPlayerId: oppId != null ? String(oppId) : undefined });
                  } : SIDEBAR_PILE_ZONES.includes(key as (typeof SIDEBAR_PILE_ZONES)[number]) ? oppPileContextHandler : undefined}
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
                      listening={false}
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
          {(() => {
            const areaRight = myHandRect.x + myHandRect.width;
            const bw = 26;
            const lw = 52; // "HAND" at fontSize 12 + letterSpacing 2
            const sx = areaRight - lw - 8 - bw - 6;
            return (
              <>
                <Text x={sx} y={myHandRect.y + 4} text="HAND" fontSize={12} fontFamily="Cinzel, Georgia, serif" fill="#e8d5a3" letterSpacing={2} listening={false} />
                <Group x={sx + lw + 8} y={myHandRect.y + 2} listening={false}>
                  <Rect width={bw} height={18} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
                  <Text text={String(myCards['hand']?.length ?? 0)} fontSize={12} fontStyle="bold" fill="#e8d5a3" width={bw} height={18} align="center" verticalAlign="middle" />
                </Group>
              </>
            );
          })()}

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
              setOpponentHandMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
              });
            }}
          />
          {(() => {
            const areaRight = opponentHandRect.x + opponentHandRect.width;
            const bw = 26;
            const lw = 178; // "OPPONENT'S HAND" at fontSize 12 + letterSpacing 2
            const totalW = lw + 8 + bw;
            const sx = areaRight - totalW - 6;
            return (
              <>
                <Text x={sx} y={opponentHandRect.y + 4} text="OPPONENT'S HAND" fontSize={12} fontFamily="Cinzel, Georgia, serif" fill="#a3c5e8" letterSpacing={2} listening={false} />
                <Group x={sx + lw + 8} y={opponentHandRect.y + 2} listening={false}>
                  <Rect width={bw} height={18} fill="#101828" cornerRadius={4} stroke="#4a7ab5" strokeWidth={1} />
                  <Text text={String(opponentCards['hand']?.length ?? 0)} fontSize={12} fontStyle="bold" fill="#a3c5e8" width={bw} height={18} align="center" verticalAlign="middle" />
                </Group>
              </>
            );
          })()}

          {/* ================================================================
              Cards in free-form zones — My territory (draggable, clipped).
              Two-pass per-cluster render: for each unequipped card, emit its
              attached weapons first (drawn behind) and then the card itself.
              This keeps equipped weapons visually tucked behind their warriors.
              ================================================================ */}
          {FREE_FORM_ZONES.map((zoneKey) => {
            const cards = myCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = myZones[zoneKey];
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const unequipped = sorted.filter((c) => c.equippedToInstanceId === 0n);
            const renderCard = (card: CardInstance, overridePos?: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player1');
              const myZone = myZones[zoneKey];
              let x: number, y: number;
              if (overridePos) {
                x = overridePos.x;
                y = overridePos.y;
              } else if (card.posX && myZone) {
                ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), myZone, 'my'));
              } else {
                x = (myZone?.x ?? 0) + 20;
                y = (myZone?.y ?? 0) + 24;
              }
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
            };
            return (
              <Group
                key={`my-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? VIRTUAL_WIDTH}
                clipHeight={zone?.height ?? VIRTUAL_HEIGHT}
              >
                {unequipped.flatMap((card) => {
                  const attachedWeapons = sorted.filter(
                    (w) => w.equippedToInstanceId === card.id
                  );
                  const nodes: React.ReactNode[] = [];
                  for (const weapon of attachedWeapons) {
                    const derived = myDerivedWeaponPositions.get(String(weapon.id));
                    nodes.push(renderCard(weapon, derived ? { x: derived.x, y: derived.y } : undefined));
                  }
                  nodes.push(renderCard(card));
                  return nodes;
                })}
              </Group>
            );
          })}

          {/* ================================================================
              Cards in free-form zones — Opponent territory (draggable).
              Same two-pass cluster render as my territory, mirrored at 180°.
              ================================================================ */}
          {FREE_FORM_ZONES.map((zoneKey) => {
            const cards = opponentCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = opponentZones[zoneKey];
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const unequipped = sorted.filter((c) => c.equippedToInstanceId === 0n);
            const renderCard = (card: CardInstance, overridePos?: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player2');
              const oppZone = opponentZones[zoneKey];
              if (!oppZone) return null;
              let x: number, y: number;
              if (overridePos) {
                x = overridePos.x;
                y = overridePos.y;
              } else {
                ({ x, y } = toScreenPos(
                  card.posX ? parseFloat(card.posX) : 0,
                  card.posY ? parseFloat(card.posY) : 0,
                  oppZone,
                  'opponent',
                ));
              }
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
            };
            return (
              <Group
                key={`opp-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? VIRTUAL_WIDTH}
                clipHeight={zone?.height ?? VIRTUAL_HEIGHT}
              >
                {unequipped.flatMap((card) => {
                  const attachedWeapons = sorted.filter(
                    (w) => w.equippedToInstanceId === card.id
                  );
                  const nodes: React.ReactNode[] = [];
                  for (const weapon of attachedWeapons) {
                    const derived = opponentDerivedWeaponPositions.get(String(weapon.id));
                    nodes.push(renderCard(weapon, derived));
                  }
                  nodes.push(renderCard(card));
                  return nodes;
                })}
              </Group>
            );
          })}

          {/* ================================================================
              Cards in auto-arrange zones — My LOB (draggable, horizontal strip).
              Two-pass cluster render: for each unattached LOB card (soul), emit
              its attached accessories (sites) first (drawn behind) and then the
              card itself. Attached sites don't occupy their own auto-arrange slot.
              Paragon: skipped — the shared LoB render block handles both seats.
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && AUTO_ARRANGE_ZONES.map((zoneKey) => {
            const cards = myCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = myZones[zoneKey];
            if (!zone) return null;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
            const renderLobCard = (card: CardInstance, overridePos: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player1');
              const cardIdStr = String(card.id);
              return (
                <GameCardNode
                  key={cardIdStr}
                  card={gameCard}
                  x={overridePos.x}
                  y={overridePos.y}
                  rotation={0}
                  cardWidth={lobCard.cardWidth}
                  cardHeight={lobCard.cardHeight}
                  image={getCardImage(card)}
                  isSelected={isSelected(cardIdStr)}
                  isDraggable={true}
                  hoverProgress={hoveredInstanceId === cardIdStr ? hoverProgress : 0}
                  lobArrivalGlow={getMyLobGlow(cardIdStr) > 0}
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
            };
            // Accessories render FIRST (behind hosts), in a separate group
            // WITHOUT zone clipping so they can peek above the LOB strip.
            const accessoryNodes: React.ReactNode[] = [];
            const hostNodes: React.ReactNode[] = [];
            for (const host of hosts) {
              const hostPos = myLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              const attached = sorted.filter((c) => c.equippedToInstanceId === host.id);
              for (const accessory of attached) {
                const pos = myLobLayout.accessoryPositions.get(String(accessory.id));
                if (!pos) continue;
                accessoryNodes.push(renderLobCard(accessory, { x: pos.x, y: pos.y }));
              }
              hostNodes.push(renderLobCard(host, hostPos));
            }
            return (
              <React.Fragment key={`my-auto-${zoneKey}`}>
                {/* Attached accessories — unclipped so they peek above the zone */}
                <Group>{accessoryNodes}</Group>
                {/* Hosts — clipped to the zone rect */}
                <Group clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                  {hostNodes}
                </Group>
              </React.Fragment>
            );
          })}

          {/* ================================================================
              Cards in auto-arrange zones — Opponent LOB (draggable, horizontal strip).
              Two-pass cluster render mirroring my LOB, rotated 180°. Accessory
              anchor comes from opponentDerivedWeaponPositions (already mirrored).
              Paragon: skipped — the shared LoB render block handles both seats.
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && AUTO_ARRANGE_ZONES.map((zoneKey) => {
            const cards = opponentCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = opponentZones[zoneKey];
            if (!zone) return null;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
            const renderOppLobCard = (
              card: CardInstance,
              anchor: { x: number; y: number },
            ) => {
              const gameCard = adaptCard(card, 'player2');
              const cardIdStr = String(card.id);
              return (
                <GameCardNode
                  key={cardIdStr}
                  card={gameCard}
                  x={anchor.x}
                  y={anchor.y}
                  rotation={180}
                  cardWidth={lobCard.cardWidth}
                  cardHeight={lobCard.cardHeight}
                  image={getCardImage(card)}
                  isSelected={isSelected(cardIdStr)}
                  isDraggable={true}
                  hoverProgress={hoveredInstanceId === cardIdStr ? hoverProgress : 0}
                  lobArrivalGlow={getOppLobGlow(cardIdStr) > 0}
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
            };
            // Accessories render FIRST (behind hosts), in a separate group
            // WITHOUT zone clipping so they can peek below the LOB strip
            // (toward the center of the play area).
            const accessoryNodes: React.ReactNode[] = [];
            const hostNodes: React.ReactNode[] = [];
            for (const host of hosts) {
              const hostPos = opponentLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              const attached = sorted.filter((c) => c.equippedToInstanceId === host.id);
              for (const accessory of attached) {
                const pos = opponentLobLayout.accessoryPositions.get(String(accessory.id));
                if (!pos) continue;
                accessoryNodes.push(renderOppLobCard(accessory, { x: pos.x, y: pos.y }));
              }
              hostNodes.push(
                renderOppLobCard(host, {
                  x: hostPos.x + lobCard.cardWidth,
                  y: hostPos.y + lobCard.cardHeight,
                }),
              );
            }
            return (
              <React.Fragment key={`opp-auto-${zoneKey}`}>
                <Group>{accessoryNodes}</Group>
                <Group clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                  {hostNodes}
                </Group>
              </React.Fragment>
            );
          })}

          {/* ================================================================
              Paragon-only: shared Land of Bondage render. Both seats draw from
              `sharedCards['land-of-bondage']` with rotation=0 (no mirror). We
              reuse `adaptCard(c, 'player1')` because sharedCards don't have a
              seat — authorization lives server-side.
              ================================================================ */}
          {normalizedFormat === 'Paragon' && (() => {
            const zoneKey = 'land-of-bondage';
            const cards = sharedCards[zoneKey] ?? [];
            if (cards.length === 0) return null;
            const zone = mpLayout?.zones.sharedLob;
            if (!zone) return null;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const hosts = sorted.filter((c) => c.equippedToInstanceId === 0n);
            const renderSharedLobCard = (card: CardInstance, overridePos: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player1');
              const cardIdStr = String(card.id);
              return (
                <GameCardNode
                  key={cardIdStr}
                  card={gameCard}
                  x={overridePos.x}
                  y={overridePos.y}
                  rotation={0}
                  cardWidth={lobCard.cardWidth}
                  cardHeight={lobCard.cardHeight}
                  image={getCardImage(card)}
                  isSelected={isSelected(cardIdStr)}
                  isDraggable={true}
                  hoverProgress={hoveredInstanceId === cardIdStr ? hoverProgress : 0}
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
            };
            const accessoryNodes: React.ReactNode[] = [];
            const hostNodes: React.ReactNode[] = [];
            for (const host of hosts) {
              const hostPos = sharedLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              const attached = sorted.filter((c) => c.equippedToInstanceId === host.id);
              for (const accessory of attached) {
                const pos = sharedLobLayout.accessoryPositions.get(String(accessory.id));
                if (!pos) continue;
                accessoryNodes.push(renderSharedLobCard(accessory, { x: pos.x, y: pos.y }));
              }
              hostNodes.push(renderSharedLobCard(host, hostPos));
            }
            return (
              <React.Fragment key="shared-auto-land-of-bondage">
                <Group>{accessoryNodes}</Group>
                <Group clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                  {hostNodes}
                </Group>
              </React.Fragment>
            );
          })()}

          {/* ================================================================
              Paragon-only: Soul Deck pile. Face-down stack anchored in the
              soul-deck rect (left of shared LoB). Right-click opens a deck-
              style context menu (Search / Shuffle / Look / Reveal).
              ================================================================ */}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.soulDeck && (sharedCards['soul-deck']?.length ?? 0) > 0 && (() => {
            const zone = mpLayout.zones.soulDeck!;
            const count = sharedCards['soul-deck']?.length ?? 0;
            const pileWidth = Math.min(lobCard.cardWidth, zone.width - 4);
            const pileHeight = Math.round(pileWidth * 1.4);
            const px = zone.x + (zone.width - pileWidth) / 2;
            const py = zone.y + (zone.height - pileHeight) / 2;
            return (
              <Group
                key="soul-deck-pile"
                draggable={true}
                onContextMenu={handleSharedSoulDeckContextMenu}
                onDragStart={handleSoulDeckPileDragStart}
                onDragEnd={handleSoulDeckPileDragEnd}
              >
                {count > 1 && (
                  soulDeckBackReady && soulDeckBackRef.current ? (
                    <KonvaImage
                      image={soulDeckBackRef.current}
                      x={px - 2}
                      y={py - 2}
                      width={pileWidth}
                      height={pileHeight}
                      cornerRadius={4}
                      opacity={0.85}
                    />
                  ) : (
                    <Rect
                      x={px - 2}
                      y={py - 2}
                      width={pileWidth}
                      height={pileHeight}
                      fill="#2a1410"
                      stroke="#6b4e27"
                      strokeWidth={1}
                      cornerRadius={4}
                    />
                  )
                )}
                {soulDeckBackReady && soulDeckBackRef.current ? (
                  <KonvaImage
                    image={soulDeckBackRef.current}
                    x={px}
                    y={py}
                    width={pileWidth}
                    height={pileHeight}
                    cornerRadius={4}
                  />
                ) : (
                  <Rect
                    x={px}
                    y={py}
                    width={pileWidth}
                    height={pileHeight}
                    fill="#3a1e18"
                    stroke="#c4955a"
                    strokeWidth={1}
                    cornerRadius={4}
                  />
                )}
                <Group x={px + pileWidth - 30} y={py + 4}>
                  <Rect width={28} height={20} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
                  <Text
                    text={String(count)}
                    fontSize={14}
                    fontStyle="bold"
                    fill="#e8d5a3"
                    width={28}
                    height={20}
                    align="center"
                    verticalAlign="middle"
                  />
                </Group>
                <Text
                  x={px}
                  y={py + pileHeight - 16}
                  width={pileWidth}
                  text="SOUL DECK"
                  fontSize={9}
                  fontFamily="Cinzel, Georgia, serif"
                  fill="#e8d5a3"
                  letterSpacing={1}
                  align="center"
                />
              </Group>
            );
          })()}

          {/* ================================================================
              LOB label overlays — rendered AFTER cards so labels sit on top
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && (() => {
            const lobEntries: { zone: typeof myZones[string]; isOpponent: boolean }[] = [];
            const myLob = myZones['land-of-bondage'];
            const oppLob = opponentZones['land-of-bondage'];
            if (myLob) lobEntries.push({ zone: myLob, isOpponent: false });
            if (oppLob) lobEntries.push({ zone: oppLob, isOpponent: true });
            return lobEntries.map(({ zone, isOpponent }) => {
              const cards = isOpponent ? (opponentCards['land-of-bondage'] ?? []) : (myCards['land-of-bondage'] ?? []);
              const labelTextWidth = zone.label.toUpperCase().length * 8.5;
              const fillColor = isOpponent ? '#a3c5e8' : '#e8d5a3';
              const badgeFill = isOpponent ? 'rgba(100, 149, 237, 0.25)' : 'rgba(196, 149, 90, 0.25)';
              const badgeStroke = isOpponent ? 'rgba(100, 149, 237, 0.5)' : 'rgba(196, 149, 90, 0.5)';
              const bgFill = isOpponent ? 'rgba(16, 20, 30, 0.85)' : 'rgba(30, 22, 16, 0.85)';
              const badgeW = 24;
              const labelW = labelTextWidth + 8 + badgeW + 8;
              const bgW = Math.min(labelW + 6, zone.width);
              const bgX = zone.x + zone.width - bgW;
              const labelX = bgX + 6;
              const badgeX = labelX + labelTextWidth + 8;
              return (
                <Group key={`lob-overlay-${isOpponent ? 'opp' : 'my'}`} listening={false}>
                  <Rect
                    x={bgX}
                    y={zone.y}
                    width={bgW}
                    height={20}
                    fill={bgFill}
                    cornerRadius={[0, 3, 0, 4]}
                  />
                  <Text
                    x={labelX}
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
                    x={badgeX}
                    y={zone.y + 3}
                    width={badgeW}
                    height={14}
                    fill={badgeFill}
                    cornerRadius={3}
                    stroke={badgeStroke}
                    strokeWidth={0.5}
                  />
                  <Text
                    x={badgeX}
                    y={zone.y + 4}
                    width={badgeW}
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
              Paragon-only: shared LoB label overlay ("Land of Bondage (Shared)").
              ================================================================ */}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob && (() => {
            const zone = mpLayout.zones.sharedLob!;
            const cards = sharedCards['land-of-bondage'] ?? [];
            const labelTextWidth = zone.label.toUpperCase().length * 8.5;
            const fillColor = '#e8d5a3';
            const badgeFill = 'rgba(196, 149, 90, 0.25)';
            const badgeStroke = 'rgba(196, 149, 90, 0.5)';
            const bgFill = 'rgba(30, 22, 16, 0.85)';
            const badgeW = 24;
            const labelW = labelTextWidth + 8 + badgeW + 8;
            const bgW = Math.min(labelW + 6, zone.width);
            const bgX = zone.x + zone.width - bgW;
            const labelX = bgX + 6;
            const badgeX = labelX + labelTextWidth + 8;
            return (
              <Group key="lob-overlay-shared" listening={false}>
                <Rect
                  x={bgX}
                  y={zone.y}
                  width={bgW}
                  height={20}
                  fill={bgFill}
                  cornerRadius={[0, 3, 0, 4]}
                />
                <Text
                  x={labelX}
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
                  x={badgeX}
                  y={zone.y + 3}
                  width={badgeW}
                  height={14}
                  fill={badgeFill}
                  cornerRadius={3}
                  stroke={badgeStroke}
                  strokeWidth={0.5}
                />
                <Text
                  x={badgeX}
                  y={zone.y + 4}
                  width={badgeW}
                  text={String(cards.length)}
                  fontSize={11}
                  fill={fillColor}
                  align="center"
                />
              </Group>
            );
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
              const labelTextWidth = zone.label.toUpperCase().length * 8.5;
              const fillColor = isOpponent ? '#a3c5e8' : '#e8d5a3';
              const badgeFill = isOpponent ? 'rgba(100, 149, 237, 0.25)' : 'rgba(196, 149, 90, 0.25)';
              const badgeStroke = isOpponent ? 'rgba(100, 149, 237, 0.5)' : 'rgba(196, 149, 90, 0.5)';
              const bgFill = isOpponent ? 'rgba(16, 20, 30, 0.85)' : 'rgba(30, 22, 16, 0.85)';
              const badgeW = 24;
              const labelW = labelTextWidth + 8 + badgeW + 8;
              const bgW = Math.min(labelW + 6, zone.width);
              const bgX = zone.x + zone.width - bgW;
              const labelX = bgX + 6;
              const badgeX = labelX + labelTextWidth + 8;
              return (
                <Group key={`territory-overlay-${isOpponent ? 'opp' : 'my'}`} listening={false}>
                  <Rect
                    x={bgX}
                    y={zone.y}
                    width={bgW}
                    height={20}
                    fill={bgFill}
                    cornerRadius={[0, 3, 0, 4]}
                  />
                  <Text
                    x={labelX}
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
                    x={badgeX}
                    y={zone.y + 3}
                    width={badgeW}
                    height={14}
                    fill={badgeFill}
                    cornerRadius={3}
                    stroke={badgeStroke}
                    strokeWidth={0.5}
                  />
                  <Text
                    x={badgeX}
                    y={zone.y + 4}
                    width={badgeW}
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
            const showFace = topCard && ((zoneKey === 'discard' || zoneKey === 'land-of-redemption' || zoneKey === 'banish') ? !topCard.isFlipped : zoneKey === 'reserve');

            return (
              <Group
                key={`my-pile-${zoneKey}`}
                onClick={zoneKey !== 'deck' ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                  if (e.evt.button !== 0) return;
                  setBrowseMyZone(zoneKey);
                } : undefined}
                onDblClick={undefined}
                onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  closeAllMenus();
                  const pt = { x: e.evt.clientX, y: e.evt.clientY };
                  if (zoneKey === 'deck') setDeckMenu(pt);
                  else if (zoneKey === 'land-of-redemption') setLorMenu(pt);
                  else if (zoneKey === 'reserve') setReserveMenu(pt);
                  else if (zoneKey === 'discard' || zoneKey === 'banish') setBrowseMyZone(zoneKey);
                }}
              >
                {/* Count badge */}
                <Group x={zone.x + zone.width - 32} y={zone.y + 2} listening={false}>
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

                {/* Revealed indicator for own reserve — clickable to hide. Sits left of the count badge. */}
                {zoneKey === 'reserve' && (gameState.myPlayer?.reserveRevealed ?? false) && (
                  <Group
                    x={zone.x + zone.width - 56}
                    y={zone.y + 2}
                    onMouseDown={(e: Konva.KonvaEventObject<PointerEvent>) => { e.cancelBubble = true; }}
                    onClick={(e: Konva.KonvaEventObject<PointerEvent>) => {
                      e.cancelBubble = true;
                      e.evt.stopPropagation();
                      if (e.evt.button !== 0) return;
                      gameState.revealReserve(false);
                    }}
                    onMouseEnter={() => { const c = stageRef.current?.container(); if (c) c.style.cursor = 'pointer'; }}
                    onMouseLeave={() => { const c = stageRef.current?.container(); if (c) c.style.cursor = 'default'; }}
                  >
                    <Rect width={20} height={18} fill="#1a2e1a" cornerRadius={4} stroke="#5a9a5a" strokeWidth={1} />
                    <Text
                      text="👁"
                      fontSize={11}
                      width={20}
                      height={18}
                      align="center"
                      verticalAlign="middle"
                      listening={false}
                    />
                  </Group>
                )}

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
                    {showFace ? (
                      // Render all cards stacked — each is independently draggable.
                      // Only the topmost is visible, but when dragged away the next
                      // card is already rendered underneath with its own node ref.
                      sortedCards.map((c) => {
                        const effective = zoneKey === 'reserve' && c.isFlipped
                          ? { ...c, isFlipped: false }
                          : c;
                        const img = getCardImage(effective);
                        const isDraggableZone = zoneKey === 'discard' || zoneKey === 'reserve' || zoneKey === 'banish';
                        return img ? (
                          <GameCardNode
                            key={String(c.id)}
                            card={adaptCard(effective, 'player1')}
                            x={0}
                            y={0}
                            rotation={0}
                            cardWidth={pileCardWidth}
                            cardHeight={pileCardHeight}
                            image={img}
                            isSelected={false}
                            isDraggable={isDraggableZone}
                            nodeRef={isDraggableZone ? registerCardNode : undefined}
                            hoverProgress={hoveredInstanceId === String(c.id) ? hoverProgress : 0}
                            onDragStart={isDraggableZone ? handleCardDragStart : noopCardDrag}
                            onDragMove={isDraggableZone ? handleCardDragMove : noopDrag}
                            onDragEnd={isDraggableZone ? handleCardDragEnd : noopCardDragEnd}
                            onContextMenu={noopContextMenu}
                            onDblClick={noopDblClick}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                          />
                        ) : (
                          <Group key={String(c.id)}>
                            <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                          </Group>
                        );
                      })
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
                        onContextMenu={noopContextMenu}
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
            const oppReserveRevealed = gameState.opponentPlayer?.reserveRevealed ?? false;
            const showFace = ((zoneKey === 'discard' || zoneKey === 'land-of-redemption') && topCard && !topCard.isFlipped)
              || (zoneKey === 'reserve' && oppReserveRevealed && topCard);

            return (
              <Group
                key={`opp-pile-${zoneKey}`}
                name="zone-click"
                onClick={zoneKey !== 'deck' && !(zoneKey === 'reserve' && !oppReserveRevealed) ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                  if (e.evt.button !== 0) return;
                  setBrowseOpponentZone(zoneKey);
                } : undefined}
                onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  closeAllMenus();
                  const pt = { x: e.evt.clientX, y: e.evt.clientY };
                  if (zoneKey === 'deck') setOpponentDeckMenu(pt);
                  else if (zoneKey === 'reserve') setOpponentReserveMenu(pt);
                  else if (zoneKey === 'discard' || zoneKey === 'banish') setBrowseOpponentZone(zoneKey);
                }}
              >
                {/* Count badge */}
                <Group x={zone.x + zone.width - 32} y={zone.y + 2} listening={false}>
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

                {/* Revealed indicator for opponent reserve — sits left of the count badge. Not clickable (only owner can toggle). */}
                {zoneKey === 'reserve' && oppReserveRevealed && (
                  <Group x={zone.x + zone.width - 56} y={zone.y + 2} listening={false}>
                    <Rect width={20} height={18} fill="#1a2e1a" cornerRadius={4} stroke="#5a9a5a" strokeWidth={1} />
                    <Text
                      text="👁"
                      fontSize={11}
                      width={20}
                      height={18}
                      align="center"
                      verticalAlign="middle"
                    />
                  </Group>
                )}

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
                  <Group x={cx} y={cy}>
                    {count > 1 && !showFace && (
                      <Group x={pileCardWidth - 2} y={pileCardHeight - 2} rotation={180}>
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      </Group>
                    )}
                    {showFace && topCard ? (
                      (() => {
                        // When opponent reserve is revealed, force face-up even if card has isFlipped=true
                        const effectiveTop = zoneKey === 'reserve' && oppReserveRevealed && topCard.isFlipped
                          ? { ...topCard, isFlipped: false }
                          : topCard;
                        const img = getCardImage(effectiveTop);
                        return img ? (
                          <GameCardNode
                            card={adaptCard(effectiveTop, 'player2')}
                            x={pileCardWidth}
                            y={pileCardHeight}
                            rotation={180}
                            cardWidth={pileCardWidth}
                            cardHeight={pileCardHeight}
                            image={img}
                            isSelected={false}
                            isDraggable={zoneKey === 'discard'}
                            nodeRef={zoneKey === 'discard' ? registerCardNode : undefined}
                            hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                            onClick={zoneKey === 'reserve' && oppReserveRevealed ? (_c, e) => {
                              if ((e.evt as MouseEvent).button !== 0) return;
                              setBrowseOpponentZone('reserve');
                            } : undefined}
                            onDragStart={zoneKey === 'discard' ? handleCardDragStart : noopCardDrag}
                            onDragMove={zoneKey === 'discard' ? handleCardDragMove : noopDrag}
                            onDragEnd={zoneKey === 'discard' ? handleCardDragEnd : noopCardDragEnd}
                            onContextMenu={zoneKey === 'reserve' ? noopContextMenu : handleCardContextMenu}
                            onDblClick={noopDblClick}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                          />
                        ) : (
                          <Group x={pileCardWidth} y={pileCardHeight} rotation={180}>
                            <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                          </Group>
                        );
                      })()
                    ) : (
                      <Group x={pileCardWidth} y={pileCardHeight} rotation={180}>
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      </Group>
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
                  closeAllMenus();
                  setOpponentHandMenu({
                    x: e.evt.clientX,
                    y: e.evt.clientY,
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
                        isDraggable={true}
                        hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
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

      {/* ================================================================
          Detach ("unlink") icons at each weapon/warrior seam.
          HTML overlay — only local-player weapons get the icon, since
          you can't unequip the opponent's cards.
          Hidden during drag because the overlay reads from state which
          doesn't update live while dragging.
          ================================================================ */}
      {!isCardDraggingUi && myDerivedWeaponPositions.size > 0 && (
        <div className="pointer-events-none absolute inset-0 z-30">
          {[
            ...(myCards['territory'] ?? []),
            ...(myCards['land-of-bondage'] ?? []),
          ]
            .filter((accessory) => accessory.equippedToInstanceId !== 0n)
            .map((accessory) => {
              const derived = myDerivedWeaponPositions.get(String(accessory.id));
              if (!derived) return null;
              const seam = virtualToScreen(derived.seamX, derived.seamY, scale, offsetX, offsetY);
              const zone = myZones[accessory.zone];
              const isLob = accessory.zone === 'land-of-bondage';
              return (
                <button
                  key={String(accessory.id)}
                  type="button"
                  onClick={() => {
                    if (isLob) {
                      // LOB cards are auto-arranged — stored posX/posY are
                      // meaningless. Pass empty strings so the reducer keeps
                      // whatever is currently stored (which is '' anyway).
                      gameState.detachCard(accessory.id, '', '');
                      return;
                    }
                    if (!zone) return;
                    const db = toDbPos(derived.x, derived.y, zone, 'my', { cardWidth, cardHeight });
                    gameState.detachCard(accessory.id, String(db.x), String(db.y));
                  }}
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1a1510] p-1.5 text-[#c4955a] shadow-md ring-1 ring-[#c4955a]/40 transition hover:bg-[#2a1f14] hover:ring-[#c4955a]"
                  style={{ left: `${seam.x}px`, top: `${seam.y}px` }}
                  title="Detach"
                  aria-label="Detach accessory"
                >
                  <Link2Off size={14} strokeWidth={2} />
                </button>
              );
            })}
        </div>
      )}

      {/* Card size settings gear */}
      <CardScaleControl
        cardScale={cardScale}
        setCardScale={setCardScale}
        resetScale={resetScale}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        step={STEP}
        onLoadDeck={onLoadDeck}
        isTimerVisible={isTimerVisible}
        onToggleTimer={onToggleTimer}
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
            // Shared Paragon zones use the same warm tone as own zones so the
            // shared LoB glows the same way as per-seat zones during drag.
            const warm = owner === 'my' || owner === 'shared';
            const borderColor = warm
              ? isHovered ? 'rgba(196,149,90,0.6)' : 'rgba(196,149,90,0.2)'
              : isHovered ? 'rgba(100,149,237,0.6)' : 'rgba(100,149,237,0.2)';
            const bgColor = warm
              ? isHovered ? 'rgba(196,149,90,0.12)' : 'transparent'
              : isHovered ? 'rgba(100,149,237,0.12)' : 'transparent';

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
      {contextMenu && (() => {
        const ctxCard = contextMenu.card;
        const isSharedSoul =
          ctxCard?.zone === 'land-of-bondage' &&
          ctxCard?.ownerId === 'player1' &&
          findAnyCardById(ctxCard.instanceId)?.ownerId === 0n;
        const sharedSoulActions = isSharedSoul
          ? {
              moveCardToTopOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck', '0'),
              moveCardToBottomOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck'),
              shuffleCardIntoDeck: (id: string) => {
                gameState.moveCard(BigInt(id), 'soul-deck');
                gameState.shuffleSoulDeck();
              },
            }
          : null;
        return (
        <CardContextMenu
          card={contextMenu.card}
          x={contextMenu.x}
          y={contextMenu.y}
          actions={{ ...multiplayerActions, ...(sharedSoulActions ?? {}) }}
          onClose={() => setContextMenu(null)}
          onExchange={(cardIds) => {
            setContextMenu(null);
            setExchangeState({ cardIds, targetZone: isSharedSoul ? 'soul-deck' : 'deck' });
          }}
          onDetach={
            contextMenu.card.ownerId === 'player1'
              ? (weaponId) => {
                  const derived = myDerivedWeaponPositions.get(weaponId);
                  const myZone = myZones['territory'];
                  if (derived && myZone) {
                    const db = toDbPos(derived.x, derived.y, myZone, 'my', { cardWidth, cardHeight });
                    gameState.detachCard(BigInt(weaponId), String(db.x), String(db.y));
                  } else {
                    gameState.detachCard(BigInt(weaponId));
                  }
                }
              : undefined
          }
          onEditNote={
            contextMenu.card.ownerId === 'player1'
              ? (card) => {
                  setNotePopover({
                    cardId: card.instanceId,
                    x: contextMenu.x,
                    y: contextMenu.y,
                    initialValue: card.notes ?? '',
                  });
                  setContextMenu(null);
                }
              : undefined
          }
          zones={allZonesForContextMenu as any}
        />
        );
      })()}

      {multiCardContextMenu && (
        <MultiCardContextMenu
          selectedIds={Array.from(selectedIds).sort((a, b) => {
            const aCard = findAnyCardById(a);
            const bCard = findAnyCardById(b);
            return Number(aCard?.zoneIndex ?? BigInt(0)) - Number(bCard?.zoneIndex ?? BigInt(0));
          })}
          x={multiCardContextMenu.x}
          y={multiCardContextMenu.y}
          actions={multiplayerActions}
          onClose={() => setMultiCardContextMenu(null)}
          onClearSelection={() => { clearSelection(); setMultiCardContextMenu(null); }}
          zones={allZonesForContextMenu as any}
        />
      )}

      {notePopover && (
        <CardNotePopover
          x={notePopover.x}
          y={notePopover.y}
          initialValue={notePopover.initialValue}
          onSave={(text) => {
            gameState.setNote(BigInt(notePopover.cardId), text);
            setNotePopover(null);
          }}
          onCancel={() => setNotePopover(null)}
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
          onSearchDeck={() => { logSearchDeck(); setDeckMenu(null); setShowDeckSearch(true); }}
          onLookAtTop={(n) => { logLookAtTop(n); setDeckMenu(null); setLookState({ count: n, position: 'top' }); }}
          onLookAtBottom={(n) => { logLookAtTop(n); setDeckMenu(null); setLookState({ count: n, position: 'bottom' }); }}
          onLookAtRandom={(n) => { logLookAtTop(n); setDeckMenu(null); setLookState({ count: n, position: 'random' }); }}
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

      {soulDeckMenu && (
        <DeckContextMenu
          x={soulDeckMenu.x}
          y={soulDeckMenu.y}
          deckSize={sharedCards['soul-deck']?.length ?? 0}
          hideDiscardActions
          hideReserveActions
          onClose={() => setSoulDeckMenu(null)}
          onSearchDeck={searchSoulDeck}
          onShuffleDeck={handleShuffleSoulDeck}
          onLookAtTop={(n) => lookAtSoulDeck('top', n)}
          onLookAtBottom={(n) => lookAtSoulDeck('bottom', n)}
          onLookAtRandom={(n) => lookAtSoulDeck('random', n)}
          onRevealTop={(n) => revealFromSoulDeck('top', n)}
          onRevealBottom={(n) => revealFromSoulDeck('bottom', n)}
          onRevealRandom={(n) => revealFromSoulDeck('random', n)}
          // For the soul deck, Draw == Reveal: the card leaves the soul deck
          // and lands face-up in the shared LoB. There's no private equivalent.
          onDrawTop={(n) => revealFromSoulDeck('top', n)}
          onDrawBottom={(n) => revealFromSoulDeck('bottom', n)}
          onDrawRandom={(n) => revealFromSoulDeck('random', n)}
          onDiscardTop={() => {}}
          onDiscardBottom={() => {}}
          onDiscardRandom={() => {}}
          onReserveTop={() => {}}
          onReserveBottom={() => {}}
          onReserveRandom={() => {}}
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

      {opponentHandMenu && (() => {
        const requestAction = (action: string, count: number) => {
          const params = JSON.stringify({ count });
          requestOpponentAction(action, params);
          setOpponentHandMenu(null);
          showGameToast('Waiting for opponent to approve...');
        };
        return (
          <HandContextMenu
            mode="opponent"
            x={opponentHandMenu.x}
            y={opponentHandMenu.y}
            handSize={opponentCards['hand']?.length ?? 0}
            onClose={() => setOpponentHandMenu(null)}
            onRandomToDiscard={(count) => requestAction('random_hand_to_discard', count)}
            onRandomToReserve={(count) => requestAction('random_hand_to_reserve', count)}
            onRandomToDeckTop={(count) => requestAction('random_hand_to_deck_top', count)}
            onRandomToDeckBottom={(count) => requestAction('random_hand_to_deck_bottom', count)}
            onShuffleRandomIntoDeck={(count) => requestAction('random_hand_to_deck_shuffle', count)}
            isHandRevealed={gameState.opponentPlayer?.handRevealed ?? false}
            onRevealHand={() => {
              setOpponentHandMenu(null);
              requestZoneSearch('hand-reveal');
              showGameToast('Asking opponent to reveal hand...');
            }}
          />
        );
      })()}

      {reserveMenu && (
        <ReserveContextMenu
          x={reserveMenu.x}
          y={reserveMenu.y}
          cardCount={myCards['reserve']?.length ?? 0}
          isRevealed={gameState.myPlayer?.reserveRevealed ?? false}
          onToggleReveal={() => {
            const isRevealed = gameState.myPlayer?.reserveRevealed ?? false;
            gameState.revealReserve(!isRevealed);
          }}
          onLookAtReserve={() => { setReserveMenu(null); setBrowseMyZone('reserve'); }}
          onClose={() => setReserveMenu(null)}
          onRandomToDiscard={(count) => { setReserveMenu(null); multiplayerActions.randomReserveToZone(count, 'discard', ''); }}
        />
      )}

      {opponentReserveMenu && (() => {
        const oppReserveRevealed = gameState.opponentPlayer?.reserveRevealed ?? false;
        const oppReserveCards = opponentCards['reserve'] ?? [];
        const oppId = gameState.opponentPlayer?.id;
        const randomOppReserveToDiscard = (count: number) => {
          if (oppId == null || oppReserveCards.length === 0) return;
          const pool = [...oppReserveCards];
          const picks: typeof oppReserveCards = [];
          for (let i = 0; i < count && pool.length > 0; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            picks.push(pool[idx]);
            pool.splice(idx, 1);
          }
          for (const card of picks) {
            gameState.moveCard(BigInt(card.id), 'discard', '', '', '', String(oppId));
          }
        };
        return (
          <ReserveContextMenu
            x={opponentReserveMenu.x}
            y={opponentReserveMenu.y}
            cardCount={oppReserveCards.length}
            isRevealed={oppReserveRevealed}
            onLookAtReserve={oppReserveRevealed ? () => { setOpponentReserveMenu(null); setBrowseOpponentZone('reserve'); } : undefined}
            onSearchRequest={!oppReserveRevealed ? () => {
              requestZoneSearch('reserve');
              showGameToast('Waiting for opponent to approve...');
              setOpponentReserveMenu(null);
            } : undefined}
            onRandomToDiscard={(count) => { setOpponentReserveMenu(null); randomOppReserveToDiscard(count); }}
            onClose={() => setOpponentReserveMenu(null)}
          />
        );
      })()}

      {opponentDeckMenu && (() => {
        const requestAction = (action: string, count?: number) => {
          const params = count != null ? JSON.stringify({ count }) : '';
          requestOpponentAction(action, params);
          setOpponentDeckMenu(null);
          showGameToast('Waiting for opponent to approve...');
        };
        return (
          <DeckContextMenu
            x={opponentDeckMenu.x}
            y={opponentDeckMenu.y}
            deckSize={(opponentCards['deck'] ?? []).length}
            onClose={() => setOpponentDeckMenu(null)}
            hideDrawActions
            onSearchDeck={() => {
              setOpponentDeckMenu(null);
              requestZoneSearch('deck');
              showGameToast('Waiting for opponent to approve...');
            }}
            onShuffleDeck={() => requestAction('shuffle_deck')}
            onLookAtTop={(n) => requestAction('look_deck_top', n)}
            onLookAtBottom={(n) => requestAction('look_deck_bottom', n)}
            onLookAtRandom={(n) => requestAction('look_deck_random', n)}
            onDrawTop={(n) => requestAction('draw_deck_top', n)}
            onRevealTop={(n) => requestAction('reveal_deck_top', n)}
            onDiscardTop={(n) => requestAction('discard_deck_top', n)}
            onReserveTop={(n) => requestAction('reserve_deck_top', n)}
            onDrawBottom={(n) => requestAction('draw_deck_bottom', n)}
            onRevealBottom={(n) => requestAction('reveal_deck_bottom', n)}
            onDiscardBottom={(n) => requestAction('discard_deck_bottom', n)}
            onReserveBottom={(n) => requestAction('reserve_deck_bottom', n)}
            onDrawRandom={(n) => requestAction('draw_deck_random', n)}
            onRevealRandom={(n) => requestAction('reveal_deck_random', n)}
            onDiscardRandom={(n) => requestAction('discard_deck_random', n)}
            onReserveRandom={(n) => requestAction('reserve_deck_random', n)}
          />
        );
      })()}

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
              if (ids.length === 1) {
                multiplayerActions.shuffleCardIntoDeck(ids[0]);
              } else {
                multiplayerActions.moveCardsBatch(ids, 'deck');
                multiplayerActions.shuffleDeck();
              }
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
            onExchange={!isBatch ? () => { setDeckDrop(null); setExchangeState({ cardIds: [deckDrop.cardId], targetZone: 'deck' }); } : undefined}
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

      {/* Priority request — floating in center of board between territories */}
      {incomingSearchRequest && incomingSearchRequest.zone === 'action-priority' && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 300,
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              background: 'rgba(14, 10, 6, 0.95)',
              border: '1px solid rgba(196, 149, 90, 0.35)',
              borderRadius: 10,
              padding: '16px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(196, 149, 90, 0.08)',
            }}
          >
            <div style={{
              fontSize: 12,
              color: '#e8d5a3',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.06em',
              textAlign: 'center',
            }}>
              <strong style={{ color: '#c4955a' }}>
                {gameState.opponentPlayer?.displayName ?? 'Opponent'}
              </strong>{' '}
              requests action priority
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => {
                  approveZoneSearch(BigInt(incomingSearchRequest.id));
                  showGameToast('Action priority granted');
                }}
                style={{
                  padding: '6px 18px',
                  background: '#2d5a27',
                  border: '1px solid #4a8a42',
                  borderRadius: 6,
                  color: '#c4e8bf',
                  fontSize: 11,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#3a7332'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#2d5a27'; }}
              >
                Grant
              </button>
              <button
                onClick={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
                style={{
                  padding: '6px 18px',
                  background: '#5a2727',
                  border: '1px solid #8a4242',
                  borderRadius: 6,
                  color: '#e8bfbf',
                  fontSize: 11,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#733232'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#5a2727'; }}
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search/reveal/action requests — floating top-center banner */}
      {incomingSearchRequest && incomingSearchRequest.zone !== 'action-priority' && (() => {
        const isAction = !!incomingSearchRequest.action;
        const actionDescription = isAction
          ? describeOpponentAction(incomingSearchRequest.action, incomingSearchRequest.actionParams)
          : undefined;
        return (
          <ConsentDialog
            requesterName={gameState.opponentPlayer?.displayName ?? 'Opponent'}
            zoneName={incomingSearchRequest.zone === 'hand-reveal' ? 'hand' : incomingSearchRequest.zone}
            requestType={isAction ? 'action' : incomingSearchRequest.zone === 'hand-reveal' ? 'reveal' : 'search'}
            actionDescription={actionDescription}
            onAllow={() => {
              approveZoneSearch(BigInt(incomingSearchRequest.id));
              if (incomingSearchRequest.zone === 'hand-reveal') {
                gameState.revealHand(true);
                // Auto-hide hand after 30 seconds
                if (revealAutoHideRef.current) clearTimeout(revealAutoHideRef.current);
                revealAutoHideRef.current = setTimeout(() => {
                  gameState.revealHand(false);
                  revealAutoHideRef.current = null;
                }, 30_000);
              }
            }}
            onDeny={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
          />
        );
      })()}

      {/* Countdown bar — shrinks over 30s while opponent hand is revealed */}
      {oppHandRevealed && opponentHandRect && mpLayout && (() => {
        // Bar spans only the play area (excludes sidebar) and stays inside the hand zone
        const barVirtualWidth = mpLayout.playAreaWidth;
        const barTopLeft = virtualToScreen(
          opponentHandRect.x,
          opponentHandRect.y + opponentHandRect.height - 8,
          scale, offsetX, offsetY,
        );
        const barBottomRight = virtualToScreen(
          opponentHandRect.x + barVirtualWidth,
          opponentHandRect.y + opponentHandRect.height - 4,
          scale, offsetX, offsetY,
        );
        const screenWidth = barBottomRight.x - barTopLeft.x;
        return (
          <div
            style={{
              position: 'absolute',
              left: barTopLeft.x,
              top: barTopLeft.y,
              width: revealBarShrinking ? 0 : screenWidth,
              height: barBottomRight.y - barTopLeft.y,
              background: 'linear-gradient(90deg, #c8a84e, #f0d878)',
              transition: revealBarShrinking ? 'width 30s linear' : 'none',
              borderRadius: 2,
              zIndex: 100,
              pointerEvents: 'none',
            }}
          />
        );
      })()}

      {approvedSearchRequest && !approvedSearchRequest.action && approvedSearchRequest.zone !== 'hand-reveal' && approvedSearchRequest.zone !== 'action-priority' && (() => {
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
                shuffleOpponentDeck(reqId);
              }
            }}
            onMoveCardsBatch={(cardIds, action) => {
              const reqId = BigInt(approvedSearchRequest.id);
              for (const cardId of cardIds) {
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
                }
              }
              if (action === 'deck-shuffle') {
                shuffleOpponentDeck(reqId);
              }
            }}
            onClose={(opts) => completeZoneSearch(BigInt(approvedSearchRequest.id), opts?.shuffled ?? false)}
            onStartDrag={opponentModalStartDrag}
            onStartMultiDrag={opponentModalStartMultiDrag}
            didDragRef={opponentModalDidDragRef}
            isDragActive={opponentModalDrag.isDragging}
          />
        );
      })()}

      {/* ================================================================
          Zone browse overlay — card grid for browsing pile contents
          ================================================================ */}
      {browseOpponentZone && (
        <ModalGameProvider value={opponentModalGameValue}>
          <ZoneBrowseModal
            zoneId={browseOpponentZone as ZoneId}
            onClose={() => setBrowseOpponentZone(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        </ModalGameProvider>
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

        {lookState && (
          <DeckPeekModal
            cardIds={lookCardIds}
            title={`Looking at ${lookState.position === 'top' ? 'Top' : lookState.position === 'bottom' ? 'Bottom' : 'Random'} ${lookState.count}`}
            onClose={() => setLookState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            isPrivateLook
          />
        )}

        {exchangeState && exchangeState.targetZone !== 'soul-deck' && (
          <DeckExchangeModal
            exchangeCardIds={exchangeState.cardIds}
            targetZone={exchangeState.targetZone}
            onComplete={() => { setExchangeState(null); clearSelection(); }}
            onCancel={() => setExchangeState(null)}
            onStartDrag={modalStartDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            validDropRef={modalValidDropRef}
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
        {opponentLookState && (
          <DeckPeekModal
            cardIds={opponentLookCardIds}
            title={`Looking at Opponent ${opponentLookState.position === 'top' ? 'Top' : opponentLookState.position === 'bottom' ? 'Bottom' : 'Random'} ${opponentLookState.count}`}
            onClose={() => setOpponentLookState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            isPrivateLook
          />
        )}
      </ModalGameProvider>

      {/* ================================================================
          Paragon-only: shared Soul Deck modals (Search + private Look).
          ================================================================ */}
      <ModalGameProvider value={soulDeckModalGameValue}>
        {browseSoulDeck && (
          <ZoneBrowseModal
            zoneId="soul-deck"
            onClose={() => setBrowseSoulDeck(false)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}
        {soulDeckLookState && (
          <DeckPeekModal
            cardIds={soulDeckLookState.cardIds}
            title={soulDeckLookState.title}
            onClose={() => setSoulDeckLookState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            isPrivateLook
            sourceZone="soul-deck"
          />
        )}
        {exchangeState && exchangeState.targetZone === 'soul-deck' && (
          <DeckExchangeModal
            exchangeCardIds={exchangeState.cardIds}
            targetZone={exchangeState.targetZone}
            onComplete={() => { setExchangeState(null); clearSelection(); }}
            onCancel={() => setExchangeState(null)}
            onStartDrag={modalStartDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            validDropRef={modalValidDropRef}
          />
        )}
      </ModalGameProvider>

      {/* Opponent's server-revealed cards — shown from snapshot so it persists even after revealer closes their reveal */}
      {opponentRevealSnapshot.length > 0 && !opponentRevealDismissed && (
        <ModalGameProvider value={opponentModalGameValue}>
          <DeckPeekModal
            cardIds={opponentRevealSnapshot}
            title={`${gameState.opponentPlayer?.displayName ?? 'Opponent'} Revealed ${opponentRevealSnapshot.length}`}
            onClose={opponentRevealedCardIds.length > 0 ? undefined : () => setOpponentRevealDismissed(true)}
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
              zIndex: 1100,
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
              zIndex: 1100,
              opacity: 0.9,
            }}
          />
        )
      )}

      {/* Floating drag ghost (opponent modal → canvas drag) */}
      {opponentModalDrag.isDragging && opponentModalDrag.imageUrl && (
        opponentModalDrag.additionalCards.length > 0 ? (
          <div
            ref={opponentModalGhostRef as React.RefObject<HTMLDivElement>}
            style={{
              position: 'fixed',
              pointerEvents: 'none',
              zIndex: 1100,
            }}
          >
            {[...opponentModalDrag.additionalCards.slice(0, 2)].reverse().map((extra, i) => (
              <img
                key={i}
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
              src={opponentModalDrag.imageUrl}
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
              {opponentModalDrag.additionalCards.length + 1}
            </div>
          </div>
        ) : (
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
              zIndex: 1100,
              opacity: 0.9,
            }}
          />
        )
      )}

      {/* ================================================================
          Turn 1 reserve protection confirmation dialog
          ================================================================ */}
      {pendingReserveMove && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 950,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
          }}
          onClick={() => setPendingReserveMove(null)}
        >
          <div
            style={{
              background: 'var(--gf-bg, #1a1510)',
              border: '1px solid var(--gf-border, #3a3428)',
              borderRadius: 10,
              padding: '20px 28px',
              maxWidth: 360,
              boxShadow: '0 12px 48px rgba(0,0,0,0.8)',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              fontSize: 14,
              color: 'var(--gf-text, #c8b89a)',
              lineHeight: 1.5,
              marginBottom: 18,
            }}>
              Cards typically cannot leave the reserve on <strong style={{ color: 'var(--gf-text-bright, #e8d5a3)' }}>Turn 1</strong>. Move anyway?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => {
                  pendingReserveMove.execute();
                  setPendingReserveMove(null);
                }}
                style={{
                  padding: '7px 20px',
                  background: '#2d5a27',
                  border: '1px solid #4a8a42',
                  borderRadius: 6,
                  color: '#c4e8bf',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#3a7332'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#2d5a27'; }}
              >
                Move Anyway
              </button>
              <button
                onClick={() => setPendingReserveMove(null)}
                style={{
                  padding: '7px 20px',
                  background: '#5a2727',
                  border: '1px solid #8a4242',
                  borderRadius: 6,
                  color: '#e8bfbf',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#733232'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#5a2727'; }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Disconnect timeout — notification banner */}
      {gameState.disconnectTimeoutFired && !claimBannerDismissed && (
        <div
          style={{
            position: 'absolute',
            top: opponentHandRect.y + opponentHandRect.height + 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 900,
            background: 'rgba(10, 8, 5, 0.95)',
            border: '1px solid rgba(180, 140, 60, 0.6)',
            borderRadius: 8,
            padding: '12px 20px',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 13,
            color: '#e8dcc8',
            textAlign: 'center' as const,
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 10,
            maxWidth: 360,
          }}
        >
          <span style={{ letterSpacing: '0.04em' }}>
            Your opponent has been disconnected for 5 minutes.
          </span>
          <button
            onClick={() => setClaimBannerDismissed(true)}
            style={{
              background: 'rgba(50, 45, 35, 0.8)',
              border: '1px solid rgba(107, 78, 39, 0.4)',
              borderRadius: 5,
              padding: '6px 14px',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 11,
              color: '#a89878',
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            Dismiss
          </button>
        </div>
      )}


      {/* ================================================================
          Card hover preview — floating tooltip near cursor
          ================================================================ */}
      {hoveredCard && hoverReady && !isLoupeVisible && !isDraggingRef.current && !contextMenu && !multiCardContextMenu && !deckMenu && !zoneMenu && !lorMenu && !opponentZoneMenu && !handMenu && !opponentHandMenu && !reserveMenu && !opponentReserveMenu && (() => {
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
            {hoveredCard.notes && (
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  right: 12,
                  bottom: 14,
                  background: 'rgba(0, 0, 0, 0.88)',
                  border: '1px solid #c4955a',
                  borderRadius: 999,
                  padding: '6px 12px',
                  color: '#f0d9a8',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 13,
                  fontWeight: 700,
                  textAlign: 'center',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.8)',
                  wordBreak: 'break-word',
                }}
              >
                {hoveredCard.notes}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
