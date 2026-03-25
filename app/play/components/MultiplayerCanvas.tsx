'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Stage, Layer, Rect, Text, Group, Circle } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { useGameState } from '../hooks/useGameState';
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
import type { GameActions } from '@/app/shared/types/gameActions';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import DiceOverlay from './DiceOverlay';
import { getCardImageUrl as getSharedCardImageUrl } from '@/app/shared/utils/cardImageUrl';

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MultiplayerCanvas({ gameId }: MultiplayerCanvasProps) {
  const { setPreviewCard } = useCardPreview();

  // ---- Container sizing (respects flex layout) ----
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setDimensions({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width, height } = dimensions;

  // ---- Game state ----
  const gameState = useGameState(gameId);
  const {
    myCards,
    opponentCards,
    counters,
    moveCard,
    moveCardsBatch,
    updateCardPosition,
  } = gameState;

  // ---- Layout ----
  const mpLayout = useMemo(
    () => (width > 0 && height > 0 ? calculateMultiplayerLayout(width, height) : null),
    [width, height],
  );

  // Four-tier card dimensions
  const { cardWidth, cardHeight } = mpLayout?.mainCard ?? { cardWidth: 0, cardHeight: 0 };
  const lobCard = mpLayout?.lobCard ?? { cardWidth: 0, cardHeight: 0 };
  const oppHandCard = mpLayout?.opponentHandCard ?? { cardWidth: 0, cardHeight: 0 };
  const pileCardWidth = mpLayout?.pileCard.cardWidth ?? 0;
  const pileCardHeight = mpLayout?.pileCard.cardHeight ?? 0;

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
        ? { cardName: hoveredCard.cardName, cardImgFile: hoveredCard.cardImgFile }
        : null,
    );
  }, [hoveredCard, setPreviewCard]);

  // ---- Hand spread toggle (fan vs flat) ----
  const [isSpreadHand, setIsSpreadHand] = useState(false);

  // ---- Mouse position tracking for hover preview ----
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

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
  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; spawnX: number; spawnY: number } | null>(null);

  // ---- Multiplayer GameActions adapter ----
  const multiplayerActions: GameActions = useMemo(() => ({
    moveCard: (cardId, toZone, posX, posY) =>
      gameState.moveCard(BigInt(cardId), toZone, undefined, posX, posY),
    moveCardsBatch: (cardIds, toZone) =>
      gameState.moveCardsBatch(cardIds.join(','), toZone),
    flipCard: (cardId) => gameState.flipCard(BigInt(cardId)),
    meekCard: (cardId) => gameState.meekCard(BigInt(cardId)),
    unmeekCard: (cardId) => gameState.unmeekCard(BigInt(cardId)),
    addCounter: (cardId, color) => gameState.addCounter(BigInt(cardId), color),
    removeCounter: (cardId, color) => gameState.removeCounter(BigInt(cardId), color),
    shuffleCardIntoDeck: (cardId) => gameState.shuffleCardIntoDeck(BigInt(cardId)),
    shuffleDeck: () => gameState.shuffleDeck(),
    setNote: (cardId, text) => gameState.setNote(BigInt(cardId), text),
    exchangeCards: (cardIds) => gameState.exchangeCards(cardIds.join(',')),
    drawCard: () => gameState.drawCard(),
    drawMultiple: (count) => gameState.drawMultiple(BigInt(count)),
    moveCardToTopOfDeck: (cardId) => gameState.moveCardToTopOfDeck(BigInt(cardId)),
    moveCardToBottomOfDeck: (cardId) => gameState.moveCardToBottomOfDeck(BigInt(cardId)),
    spawnLostSoul: (testament, posX, posY) =>
      gameState.spawnLostSoul(testament, posX ?? '0.5', posY ?? '0.5'),
    removeToken: (cardId) => gameState.removeToken(BigInt(cardId)),
    removeOpponentToken: undefined,
  }), [gameState]);

  // ---- Drag state ----
  const isDraggingRef = useRef(false);
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
    [mpLayout, myZones, opponentZones, myHandRect],
  );

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
    [selectedIds, cardWidth, cardHeight, stopHoverAnimation],
  );

  const handleCardDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;

      // Clamp card position to stage bounds
      const clampedX = Math.max(-cardWidth / 2, Math.min(node.x(), width - cardWidth / 2));
      const clampedY = Math.max(-cardHeight / 2, Math.min(node.y(), height - cardHeight / 2));
      if (clampedX !== node.x() || clampedY !== node.y()) {
        node.x(clampedX);
        node.y(clampedY);
      }

      const x = node.x();
      const y = node.y();
      const centerX = x + cardWidth / 2;
      const centerY = y + cardHeight / 2;
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
    [findZoneAtPosition, cardWidth, cardHeight, width, height],
  );

  const handleCardDragEnd = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => {
      const followerOffsets = dragFollowerOffsets.current;
      const originalPos = dragOriginalPosRef.current;
      const sourceZone = dragSourceZoneRef.current;
      const originalParent = dragOriginalParentRef.current;

      // Reset drag state
      isDraggingRef.current = false;
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
      // Restore follower node visibility
      if (followerOffsets) {
        for (const [id] of followerOffsets) {
          const fNode = cardNodeRefs.current.get(id);
          if (fNode) fNode.visible(true);
        }
      }

      const node = e.target;
      const dropX = node.x();
      const dropY = node.y();
      const centerX = dropX + cardWidth / 2;
      const centerY = dropY + cardHeight / 2;
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
        // No valid drop zone — snap back
        snapBack();
        return;
      }

      const targetZone = hit.zone;
      const isSameZone = targetZone === sourceZone;

      // Resolve the zone rect for the drop target so we can store normalized positions
      // (0–1 ratios). This ensures cards render at the correct proportional position
      // regardless of each player's screen/window size.
      const zoneRect = hit.owner === 'my' ? myZones[targetZone] : opponentZones[targetZone];
      const zoneOffX = zoneRect?.x ?? 0;
      const zoneOffY = zoneRect?.y ?? 0;
      const zoneW = zoneRect?.width || 1;
      const zoneH = zoneRect?.height || 1;

      // Same free-form zone: just update position
      if (isSameZone && isFreeFormZone(targetZone)) {
        if (isGroupDrag) {
          // Build positions for batch move (normalized 0–1)
          const positions: Record<string, { posX: number; posY: number }> = {
            [card.instanceId]: { posX: (dropX - zoneOffX) / zoneW, posY: (dropY - zoneOffY) / zoneH },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              positions[id] = { posX: (dropX + offset.dx - zoneOffX) / zoneW, posY: (dropY + offset.dy - zoneOffY) / zoneH };
            }
          }
          moveCardsBatch(
            cardIds.join(','),
            targetZone,
            JSON.stringify(positions),
          );
          clearSelection();
        } else {
          updateCardPosition(cardId, String((dropX - zoneOffX) / zoneW), String((dropY - zoneOffY) / zoneH));
        }
        return;
      }

      // Same non-free-form zone — snap back (no meaningful action)
      if (isSameZone && !isFreeFormZone(targetZone)) {
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
        if (isFreeFormZone(targetZone)) {
          const positions: Record<string, { posX: number; posY: number }> = {
            [card.instanceId]: { posX: (dropX - zoneOffX) / zoneW, posY: (dropY - zoneOffY) / zoneH },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              positions[id] = { posX: (dropX + offset.dx - zoneOffX) / zoneW, posY: (dropY + offset.dy - zoneOffY) / zoneH };
            }
          }
          moveCardsBatch(
            cardIds.join(','),
            targetZone,
            JSON.stringify(positions),
          );
        } else {
          moveCardsBatch(cardIds.join(','), targetZone);
        }
        clearSelection();
      } else if (isFreeFormZone(targetZone)) {
        moveCard(cardId, targetZone, '', String((dropX - zoneOffX) / zoneW), String((dropY - zoneOffY) / zoneH));
      } else if (isAutoArrangeZone(targetZone)) {
        // Auto-arrange zone: positions are ignored by rendering
        moveCard(cardId, targetZone, '', '0', '0');
      } else if (targetZone === 'deck') {
        // Deck: for now just move to deck (Task 17 adds top/bottom/shuffle popup)
        moveCard(cardId, targetZone, '0');
      } else {
        // Stacked zone
        moveCard(cardId, targetZone, '0');
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

      // Clear hover state
      setHoveredInstanceId(null);
      stopHoverAnimation();

      const menuX = e.evt.clientX - container.left;
      const menuY = e.evt.clientY - container.top;

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
      setHoveredInstanceId(card.instanceId);
      setHoveredCard(card);
      startHoverAnimation();
      // Capture mouse position for the hover preview tooltip
      const pos = { x: e.evt.clientX, y: e.evt.clientY };
      mousePosRef.current = pos;
      setMousePos(pos);
    },
    [startHoverAnimation],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredInstanceId(null);
    setHoveredCard(null);
    stopHoverAnimation();
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

      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
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
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
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
  if (width === 0 || height === 0 || !mpLayout || !myHandRect || !opponentHandRect) {
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

  return (
    <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onContextMenu={(e) => e.evt.preventDefault()}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        <Layer>
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
                  opacity={0.35}
                  onContextMenu={isLob ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                    e.evt.preventDefault();
                    const stage = stageRef.current;
                    if (!stage) return;
                    const container = stage.container().getBoundingClientRect();
                    const menuX = e.evt.clientX - container.left;
                    const menuY = e.evt.clientY - container.top;
                    // Compute spawn position as normalized 0-1 within the LOB zone
                    const pointer = stage.getPointerPosition();
                    const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
                    const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
                    setZoneMenu({ x: menuX, y: menuY, spawnX, spawnY });
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
                  opacity={0.35}
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
            height={myHandRect.height}
            fill="#0d0905"
            opacity={0.5}
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
            return (
              <Group
                key={`my-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? width}
                clipHeight={zone?.height ?? height}
              >
                {cards.map((card) => {
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
              Cards in free-form zones — Opponent territory (NOT draggable)
              ================================================================ */}
          {FREE_FORM_ZONES.map((zoneKey) => {
            const cards = opponentCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = opponentZones[zoneKey];
            return (
              <Group
                key={`opp-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? width}
                clipHeight={zone?.height ?? height}
              >
                {cards.map((card) => {
                  const gameCard = adaptCard(card, 'player2');
                  const oppZone = opponentZones[zoneKey];
                  const zoneX = oppZone?.x ?? 0;
                  const zoneY = oppZone?.y ?? 0;
                  const zoneW = oppZone?.width ?? 0;
                  const zoneH = oppZone?.height ?? 0;
                  // Mirror opponent positions: flip both axes so their top-left maps
                  // to our bottom-right, and rotate the card 180° (upside down).
                  // Konva rotates around (x,y), so offset by card size to keep it in place.
                  const mirroredPosX = card.posX ? 1 - parseFloat(card.posX) : 0;
                  const mirroredPosY = card.posY ? 1 - parseFloat(card.posY) : 0;
                  const x = mirroredPosX * zoneW + zoneX + cardWidth;
                  const y = mirroredPosY * zoneH + zoneY + cardHeight;
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
                      isSelected={false}
                      isDraggable={false}
                      hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                      onDragStart={noopCardDrag}
                      onDragMove={noopDrag}
                      onDragEnd={noopCardDragEnd}
                      onContextMenu={noopOpponentContextMenu}
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
              <Group key={`my-auto-${zoneKey}`}>
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
              <Group key={`opp-auto-${zoneKey}`}>
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
                      onContextMenu={noopOpponentContextMenu}
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
                    width={labelW + 6}
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
                    width={labelW + 6}
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
            // Center card vertically in remaining space after count badge (20px top)
            const cy = zone.y + 20 + Math.max(0, (zone.height - 20 - pileCardHeight) / 2);

            // For discard, show top card face-up; for everything else, card back
            const topCard = cards[cards.length - 1];
            const showFace = zoneKey === 'discard' && topCard && !topCard.isFlipped;

            return (
              <Group
                key={`my-pile-${zoneKey}`}
                onClick={zoneKey !== 'deck' ? () => {
                  // TODO Phase 2: open ZoneBrowseModal for this pile
                  console.log(`[pile-click] ${zoneKey}: ${count} card(s)`);
                } : undefined}
                onDblClick={zoneKey === 'deck' ? () => {
                  multiplayerActions.drawCard();
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

                {/* Pile visual — only if zone has cards */}
                {count > 0 && (
                  <Group x={cx} y={cy}>
                    {/* Shadow card for depth if multiple */}
                    {count > 1 && (
                      <Group x={-2} y={-2}>
                        <CardBackShape width={pileCardWidth} height={pileCardHeight} />
                      </Group>
                    )}
                    {showFace && topCard ? (
                      (() => {
                        const img = getCardImage(topCard);
                        return img ? (
                          <Group>
                            <Rect
                              width={pileCardWidth}
                              height={pileCardHeight}
                              cornerRadius={4}
                            />
                            <GameCardNode
                              card={adaptCard(topCard, 'player1')}
                              x={0}
                              y={0}
                              rotation={0}
                              cardWidth={pileCardWidth}
                              cardHeight={pileCardHeight}
                              image={img}
                              isSelected={false}
                              isDraggable={false}
                              hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                              onDragStart={noopCardDrag}
                              onDragMove={noopDrag}
                              onDragEnd={noopCardDragEnd}
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
              Sidebar pile indicators — Opponent zones (NOT draggable)
              ================================================================ */}
          {SIDEBAR_ZONES.map((zoneKey) => {
            const zone = opponentZones[zoneKey];
            if (!zone) return null;
            const cards = opponentCards[zoneKey] ?? [];
            const count = cards.length;
            const cx = zone.x + zone.width / 2 - pileCardWidth / 2;
            // Center card vertically in remaining space after count badge (20px top)
            const cy = zone.y + 20 + Math.max(0, (zone.height - 20 - pileCardHeight) / 2);

            const topCard = cards[cards.length - 1];
            const showFace = zoneKey === 'discard' && topCard && !topCard.isFlipped;

            return (
              <Group key={`opp-pile-${zoneKey}`}>
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

                {count > 0 && (
                  <Group x={cx} y={cy}>
                    {count > 1 && (
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
                              isDraggable={false}
                              hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                              onDragStart={noopCardDrag}
                              onDragMove={noopDrag}
                              onDragEnd={noopCardDragEnd}
                              onContextMenu={noopOpponentContextMenu}
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
              Opponent hand — row of card backs (NOT draggable)
              ================================================================ */}
          {(() => {
            const opponentHandCards = opponentCards['hand'] ?? [];
            if (opponentHandCards.length === 0) return null;

            const oppHandPositions = calculateHandPositions(
              opponentHandCards.length,
              opponentHandRect!,
              oppHandCard.cardWidth,
              oppHandCard.cardHeight,
            );

            return (
              <Group>
                {oppHandPositions.map((pos, i) => (
                  <Group key={`opp-hand-${i}`} x={pos.x} y={pos.y}>
                    <CardBackShape width={oppHandCard.cardWidth} height={oppHandCard.cardHeight} />
                  </Group>
                ))}
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

        {/* Selection rectangle layer — updated imperatively for performance */}
        <Layer ref={selectionLayerRef as any} listening={false}>
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

            return (
              <div
                key={key}
                style={{
                  position: 'absolute',
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
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
            multiplayerActions.spawnLostSoul(testament, String(posX), String(posY));
          }}
        />
      )}

      {/* ================================================================
          Card hover preview — floating tooltip near cursor
          ================================================================ */}
      {hoveredCard && !isDraggingRef.current && !contextMenu && !multiCardContextMenu && (() => {
        const previewWidth = 240;
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
