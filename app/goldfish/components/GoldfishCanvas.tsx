'use client';

import { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group, Circle, Line } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { useGame } from '../state/GameContext';
import { calculateZoneLayout, getCardDimensions, calculateCardPositionsInZone, type ZoneRect } from '../layout/zoneLayout';
import { calculateHandPositions } from '../layout/handLayout';
import { GameCard, ZoneId, ZONE_LABELS, COUNTER_COLORS } from '../types';
import { PhaseBar } from './PhaseBar';
import { GameToolbar } from './GameToolbar';
import { CardContextMenu } from './CardContextMenu';
import { CardHoverPreview } from './CardHoverPreview';
import { ZoneBrowseModal } from './ZoneBrowseModal';
import { DeckSearchModal } from './DeckSearchModal';
import { DeckContextMenu } from './DeckContextMenu';
import { DeckPeekModal } from './DeckPeekModal';
import { DeckDropPopup } from './DeckDropPopup';
import { DeckExchangeModal } from './DeckExchangeModal';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useModalCardDrag } from '../hooks/useModalCardDrag';
import { useSelectionState, type CardBound } from '../hooks/useSelectionState';
import { MultiCardContextMenu } from './MultiCardContextMenu';
import { GameToastContainer, showGameToast } from './GameToast';

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

// Card back image — loaded once and shared across all instances
let cardBackImage: HTMLImageElement | null = null;
let cardBackLoaded = false;
const cardBackListeners: (() => void)[] = [];
if (typeof window !== 'undefined') {
  cardBackImage = new window.Image();
  cardBackImage.onload = () => {
    cardBackLoaded = true;
    cardBackListeners.forEach(fn => fn());
    cardBackListeners.length = 0;
  };
  cardBackImage.src = '/gameplay/cardback.webp';
}

function CardBackShape({ width, height }: { width: number; height: number }) {
  if (cardBackImage && cardBackLoaded) {
    return (
      <KonvaImage
        image={cardBackImage}
        width={width}
        height={height}
        cornerRadius={4}
      />
    );
  }
  // Fallback while image loads
  return (
    <Rect
      width={width}
      height={height}
      fill="#2a1f12"
      stroke="#6b4e27"
      strokeWidth={1}
      cornerRadius={4}
    />
  );
}

// Individual card component — memoized to avoid re-rendering cards that haven't changed
const GameCardNode = memo(function GameCardNode({
  card,
  x,
  y,
  rotation,
  cardWidth,
  cardHeight,
  image,
  isSelected,
  hoverProgress,
  nodeRef,
  onDragStart,
  onDragMove,
  onDragEnd,
  onContextMenu,
  onClick,
  onDblClick,
  onMouseEnter,
  onMouseLeave,
}: {
  card: GameCard;
  x: number;
  y: number;
  rotation: number;
  cardWidth: number;
  cardHeight: number;
  image: HTMLImageElement | undefined;
  isSelected?: boolean;
  hoverProgress?: number;
  nodeRef?: (instanceId: string, node: Konva.Group | null) => void;
  onDragStart: (card: GameCard) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => void;
  onContextMenu: (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => void;
  onClick?: (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDblClick: (card: GameCard) => void;
  onMouseEnter: (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: () => void;
}) {
  const showFace = !card.isFlipped && image;

  const groupRefCb = useCallback((node: Konva.Group | null) => {
    nodeRef?.(card.instanceId, node);
  }, [card.instanceId, nodeRef]);

  return (
    <Group
      ref={groupRefCb as any}
      x={x}
      y={y}
      rotation={rotation}
      draggable
      onDragStart={() => onDragStart(card)}
      onDragMove={onDragMove}
      onDragEnd={(e) => onDragEnd(card, e)}
      onContextMenu={(e) => onContextMenu(card, e)}
      onClick={onClick ? (e) => onClick(card, e) : undefined}
      onTap={onClick ? (e) => onClick(card, e as unknown as Konva.KonvaEventObject<MouseEvent>) : undefined}
      onDblClick={() => onDblClick(card)}
      onDblTap={() => onDblClick(card)}
      onMouseEnter={(e) => onMouseEnter(card, e)}
      onMouseLeave={onMouseLeave}
    >
      {/* Selection highlight — golden glow border */}
      {isSelected && (
        <Rect
          x={-3}
          y={-3}
          width={cardWidth + 6}
          height={cardHeight + 6}
          fill="transparent"
          stroke="#c4955a"
          strokeWidth={2}
          cornerRadius={6}
          shadowColor="#c4955a"
          shadowBlur={8}
          shadowOpacity={0.6}
        />
      )}

      {/* Hover highlight — warm golden glow that intensifies over time */}
      {hoverProgress != null && hoverProgress > 0 && !isSelected && (
        <Rect
          x={-3}
          y={-3}
          width={cardWidth + 6}
          height={cardHeight + 6}
          fill="transparent"
          stroke={`rgba(224, 180, 100, ${0.3 + hoverProgress * 0.5})`}
          strokeWidth={1.5 + hoverProgress * 1.5}
          cornerRadius={6}
          shadowColor={`rgba(255, 215, 140, ${0.3 + hoverProgress * 0.5})`}
          shadowBlur={6 + hoverProgress * 14}
          shadowOpacity={0.4 + hoverProgress * 0.5}
        />
      )}

      {/* Inner group handles meek rotation around card center without affecting drag */}
      <Group
        rotation={card.isMeek ? 180 : 0}
        offsetX={card.isMeek ? cardWidth / 2 : 0}
        offsetY={card.isMeek ? cardHeight / 2 : 0}
        x={card.isMeek ? cardWidth / 2 : 0}
        y={card.isMeek ? cardHeight / 2 : 0}
      >
        {showFace ? (
          <KonvaImage
            image={image}
            width={cardWidth}
            height={cardHeight}
            cornerRadius={4}
          />
        ) : (
          <CardBackShape width={cardWidth} height={cardHeight} />
        )}

        {/* Counter badges — top-right, stacked down the side */}
        {card.counters.map((counter, idx) => {
          const colorDef = COUNTER_COLORS.find(c => c.id === counter.color);
          return (
            <Group key={counter.color} x={cardWidth - 12} y={8 + idx * 22}>
              <Circle radius={10} fill={colorDef?.hex ?? '#8b1a1a'} stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
              <Text
                text={String(counter.count)}
                fontSize={11}
                fill="white"
                fontStyle="bold"
                width={20}
                height={20}
                align="center"
                verticalAlign="middle"
                offsetX={10}
                offsetY={10}
              />
            </Group>
          );
        })}

        {/* Notes indicator */}
        {card.notes && (
          <Circle
            x={cardWidth - 14}
            y={cardHeight - 8}
            radius={5}
            fill="#c4955a"
          />
        )}
      </Group>
    </Group>
  );
});

interface GoldfishCanvasProps {
  width: number;
  height: number;
}

export default function GoldfishCanvas({ width, height }: GoldfishCanvasProps) {
  const { state, dispatch, drawCard, drawMultiple, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, meekCard, unmeekCard } = useGame();
  const stageRef = useRef<Konva.Stage>(null);

  // Prevent browser-native drag on the canvas container.
  // Without this, the browser can hijack card drags (especially multi-select)
  // and show a ghosted overlay of the page instead of the Konva drag behavior.
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

  // Use ref for image cache to avoid re-renders on every image load.
  // A version counter triggers a single re-render when images finish loading.
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const pendingLoads = useRef(0);
  const [imageVersion, setImageVersion] = useState(0);

  // Re-render once cardback image finishes loading
  useEffect(() => {
    if (cardBackLoaded) return;
    const onLoad = () => setImageVersion(v => v + 1);
    cardBackListeners.push(onLoad);
    return () => {
      const idx = cardBackListeners.indexOf(onLoad);
      if (idx >= 0) cardBackListeners.splice(idx, 1);
    };
  }, []);

  const [contextMenu, setContextMenu] = useState<{
    card: GameCard;
    x: number;
    y: number;
  } | null>(null);
  const [hoverCard, setHoverCard] = useState<{
    card: GameCard;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const [hoverProgress, setHoverProgress] = useState(0);
  const hoverAnimFrameRef = useRef<number | null>(null);
  const hoverStartTimeRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const dragSourceZoneRef = useRef<ZoneId | null>(null);
  const [browseZone, setBrowseZone] = useState<ZoneId | null>(null);

  // Keep hover preview in sync with game state (e.g. when meekifying a hovered card)
  useEffect(() => {
    if (!hoverCard) return;
    const allCards = Object.values(state.zones).flat();
    const updated = allCards.find((c) => c.instanceId === hoverCard.card.instanceId);
    if (updated && updated !== hoverCard.card) {
      setHoverCard((prev) => prev ? { ...prev, card: updated } : null);
    } else if (!updated) {
      setHoverCard(null);
    }
  }, [state.zones, hoverCard?.card.instanceId]);
  const [showDeckSearch, setShowDeckSearch] = useState(false);
  const [deckMenu, setDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [peekState, setPeekState] = useState<{ cardIds: string[]; title: string } | null>(null);
  const [deckDropPopup, setDeckDropPopup] = useState<{ cardInstanceId: string; x: number; y: number } | null>(null);
  const [canvasDragZone, setCanvasDragZone] = useState<ZoneId | null>(null);
  const isCanvasDragging = useRef(false);
  const [multiCardContextMenu, setMultiCardContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [batchDeckDropIds, setBatchDeckDropIds] = useState<string[] | null>(null);
  const [exchangeCardIds, setExchangeCardIds] = useState<string[] | null>(null);
  const [cardRenderKey, setCardRenderKey] = useState(0);

  // Card node ref map for imperative multi-card drag
  const cardNodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const registerCardNode = useCallback((instanceId: string, node: Konva.Group | null) => {
    if (node) {
      cardNodeRefs.current.set(instanceId, node);
    } else {
      cardNodeRefs.current.delete(instanceId);
    }
  }, []);
  // Offsets of follower cards relative to the dragged card during group drag
  const dragFollowerOffsets = useRef<Map<string, { dx: number; dy: number }> | null>(null);
  // Ghost image for multi-card drag — a single rasterized snapshot of all followers
  const dragGhostRef = useRef<Konva.Image | null>(null);
  const dragGhostLayerRef = useRef<Konva.Layer | null>(null);

  // Selection state
  const {
    selectedIds, isSelectingRef, onRectChangeRef,
    startSelectionDrag, updateSelectionDrag, endSelectionDrag,
    toggleSelect, clearSelection,
  } = useSelectionState();
  const selectionRectRef = useRef<Konva.Rect | null>(null);
  const selectionLayerRef = useRef<Konva.Layer | null>(null);
  // Wire up imperative rect updates
  onRectChangeRef.current = useCallback((rect: { startX: number; startY: number; currentX: number; currentY: number } | null) => {
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
    // Don't show the selection rectangle until it's large enough to be intentional
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
  }, []);

  useKeyboardShortcuts();

  const isParagon = false; // TODO: re-enable paragon zone later
  const zoneLayout = useMemo(() => calculateZoneLayout(width, height, isParagon), [width, height, isParagon]);
  const { cardWidth, cardHeight } = useMemo(() => getCardDimensions(width, height), [width, height]);
  // Rotate deck/discard/banish sideways when the aspect ratio is wide enough
  // that cards would overflow their sidebar zones vertically
  const rotateSidebarPiles = width / height > 1.9;

  // Escape key clears selection
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedIds.size, clearSelection]);

  // Load images into ref — batch the version bump
  useEffect(() => {
    const cache = imageCacheRef.current;
    const allCards = Object.values(state.zones).flat();
    const urlsToLoad: string[] = [];

    for (const card of allCards) {
      if (card.cardImgFile && !card.isFlipped) {
        const url = getCardImageUrl(card.cardImgFile);
        if (!cache.has(url)) {
          urlsToLoad.push(url);
        }
      }
    }

    if (urlsToLoad.length === 0) return;

    // Deduplicate
    const uniqueUrls = [...new Set(urlsToLoad)];
    pendingLoads.current += uniqueUrls.length;

    for (const url of uniqueUrls) {
      // Mark as loading (set to a placeholder so we don't re-request)
      cache.set(url, null as any);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        cache.set(url, img);
        pendingLoads.current--;
        // Batch: only bump version when all pending loads finish
        if (pendingLoads.current <= 0) {
          pendingLoads.current = 0;
          setImageVersion(v => v + 1);
        }
      };
      img.onerror = () => {
        cache.delete(url);
        pendingLoads.current--;
        if (pendingLoads.current <= 0) {
          pendingLoads.current = 0;
          setImageVersion(v => v + 1);
        }
      };
      img.src = url;
    }
  }, [state.zones]); // No imageCache dependency — prevents cascade

  // Zone hit-test for drag and drop — check smaller sidebar zones first
  // so they aren't swallowed by larger overlapping zones like territory.
  const ZONE_HIT_ORDER: ZoneId[] = useMemo(() => [
    // Sidebar zones first (small, precise targets)
    'land-of-redemption', 'banish', 'reserve', 'deck', 'discard',
    ...(isParagon ? ['paragon' as ZoneId] : []),
    // Then main area zones
    'land-of-bondage', 'territory', 'hand',
  ], [isParagon]);

  const findZoneAtPosition = useCallback(
    (x: number, y: number): ZoneId | null => {
      for (const zoneId of ZONE_HIT_ORDER) {
        const rect = zoneLayout[zoneId];
        if (!rect) continue;
        if (
          x >= rect.x &&
          x <= rect.x + rect.width &&
          y >= rect.y &&
          y <= rect.y + rect.height
        ) {
          return zoneId;
        }
      }
      return null;
    },
    [zoneLayout, ZONE_HIT_ORDER]
  );

  // Shared handler: when a card is dropped on the deck zone, show popup
  const handleDeckDrop = useCallback((cardInstanceId: string, screenX: number, screenY: number) => {
    setDeckDropPopup({ cardInstanceId, x: screenX, y: screenY });
  }, []);

  // Batch deck drop handler for multi-card modal drags
  const handleBatchDeckDrop = useCallback((cardInstanceIds: string[]) => {
    setBatchDeckDropIds(cardInstanceIds);
  }, []);

  // Modal card drag (drag from search/peek/browse modals to canvas zones)
  const {
    dragState: modalDrag,
    startDrag: modalStartDrag,
    startMultiDrag: modalStartMultiDrag,
    hoveredZone: modalHoveredZone,
    ghostRef: modalGhostRef,
    didDragRef: modalDidDragRef,
  } = useModalCardDrag({
    stageRef,
    zoneLayout,
    findZoneAtPosition,
    moveCard,
    moveCardsBatch,
    onDeckDrop: handleDeckDrop,
    onBatchDeckDrop: handleBatchDeckDrop,
    cardWidth,
    cardHeight,
  });

  // Clear hover state and mark dragging on drag start
  const handleCardDragStart = useCallback((card: GameCard) => {
    isDraggingRef.current = true;
    isCanvasDragging.current = true;
    dragSourceZoneRef.current = card.zone;
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverCard(null);
    setHoveredInstanceId(null);
    stopHoverAnimation();

    // Multi-card drag: build a single rasterized ghost of all follower cards
    if (selectedIds.has(card.instanceId) && selectedIds.size > 1) {
      const dragNode = cardNodeRefs.current.get(card.instanceId);
      if (dragNode) {
        const offsets = new Map<string, { dx: number; dy: number }>();
        const baseX = dragNode.x();
        const baseY = dragNode.y();

        // Collect follower nodes and compute offsets
        const followers: { id: string; node: Konva.Group; dx: number; dy: number }[] = [];
        for (const id of selectedIds) {
          if (id === card.instanceId) continue;
          const node = cardNodeRefs.current.get(id);
          if (node) {
            const dx = node.x() - baseX;
            const dy = node.y() - baseY;
            offsets.set(id, { dx, dy });
            followers.push({ id, node, dx, dy });
          }
        }
        dragFollowerOffsets.current = offsets;

        // Rasterize followers into a single ghost image
        if (followers.length > 0) {
          // Compute bounding box of all followers relative to the drag card
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const f of followers) {
            minX = Math.min(minX, f.dx);
            minY = Math.min(minY, f.dy);
            maxX = Math.max(maxX, f.dx + cardWidth);
            maxY = Math.max(maxY, f.dy + cardHeight);
          }
          const ghostW = maxX - minX;
          const ghostH = maxY - minY;

          // Draw all followers onto an offscreen canvas
          const offscreen = document.createElement('canvas');
          offscreen.width = ghostW * 2;  // 2x for sharpness
          offscreen.height = ghostH * 2;
          const ctx = offscreen.getContext('2d');
          if (ctx) {
            ctx.scale(2, 2);
            ctx.globalAlpha = 0.5;
            for (const f of followers) {
              // Rasterize this individual card node
              const cardCanvas = f.node.toCanvas({ pixelRatio: 1 });
              ctx.drawImage(cardCanvas, f.dx - minX, f.dy - minY, cardWidth, cardHeight);
            }

            // Create a Konva.Image from the offscreen canvas
            const ghostImage = new KonvaLib.Image({
              image: offscreen,
              x: baseX + minX,
              y: baseY + minY,
              width: ghostW,
              height: ghostH,
              listening: false,
              opacity: 1,
            }) as Konva.Image;

            // Add to a dedicated ghost layer
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

            // Hide the real follower nodes
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
  }, [selectedIds, cardWidth, cardHeight]);

  const canvasDragZoneRef = useRef<ZoneId | null>(null);
  // Track the ghost's offset from the drag card origin for repositioning
  const dragGhostOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
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
      const zone = findZoneAtPosition(centerX, centerY);
      // Only trigger a re-render when the hovered zone actually changes
      if (zone !== canvasDragZoneRef.current) {
        canvasDragZoneRef.current = zone;
        setCanvasDragZone(zone);
      }

      // Multi-card drag: move the single ghost image (one node, not N)
      const ghost = dragGhostRef.current;
      if (ghost) {
        // On first move, compute the ghost's offset relative to the drag card
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
    [findZoneAtPosition, cardWidth, cardHeight, width, height]
  );

  const handleCardDragEnd = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => {
      // Capture follower offsets before clearing
      const followerOffsets = dragFollowerOffsets.current;
      isDraggingRef.current = false;
      isCanvasDragging.current = false;
      canvasDragZoneRef.current = null;
      dragSourceZoneRef.current = null;
      dragFollowerOffsets.current = null;
      dragGhostOffsetRef.current = null;
      setCanvasDragZone(null);

      // Clean up ghost image
      if (dragGhostRef.current) {
        dragGhostRef.current.destroy();
        dragGhostRef.current = null;
        dragGhostLayerRef.current?.batchDraw();
      }
      // Restore follower node visibility
      if (followerOffsets) {
        for (const [id] of followerOffsets) {
          const node = cardNodeRefs.current.get(id);
          if (node) node.visible(true);
        }
      }
      const node = e.target;
      const dropX = node.x();
      const dropY = node.y();
      // Use card center for hit-testing so drops near zone edges work intuitively
      const centerX = dropX + cardWidth / 2;
      const centerY = dropY + cardHeight / 2;
      const targetZone = findZoneAtPosition(centerX, centerY);

      // Group drag: if this card is selected and there are multiple selections
      const isGroupDrag = selectedIds.has(card.instanceId) && selectedIds.size > 1;
      const cardIds = isGroupDrag ? Array.from(selectedIds) : [card.instanceId];

      if (targetZone === 'deck' && card.zone !== 'deck') {
        // Hide the card so it doesn't awkwardly sit at the deck position while the popup is open
        let cardGroup: Konva.Node | null = node;
        while (cardGroup && !cardGroup.draggable()) {
          cardGroup = cardGroup.parent;
        }
        if (cardGroup) {
          cardGroup.visible(false);
          cardGroup.getLayer()?.batchDraw();
        }
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          if (isGroupDrag) {
            setBatchDeckDropIds(cardIds);
          }
          handleDeckDrop(card.instanceId, rect.left + centerX, rect.top + centerY);
        }
      } else if (targetZone && (targetZone !== card.zone || targetZone === 'territory' || targetZone === 'land-of-bondage')) {
        // Hide the dragged card group immediately so it doesn't linger at the drop position
        // while React processes the state update and re-renders the card in its new zone.
        // Walk up from e.target to find the draggable Group (the card-level container).
        // Skip hiding for free-form zones where repositioning within the same zone is allowed.
        const freeFormZones: ZoneId[] = ['territory', 'land-of-bondage'];
        if (!freeFormZones.includes(targetZone)) {
          let cardGroup: Konva.Node | null = node;
          while (cardGroup && !cardGroup.draggable()) {
            cardGroup = cardGroup.parent;
          }
          if (cardGroup) {
            cardGroup.visible(false);
            cardGroup.getLayer()?.batchDraw();
          }
        }
        if (isGroupDrag) {
          // For free-form zones, preserve each card's drop position
          let positions: Record<string, { posX: number; posY: number }> | undefined;
          if (freeFormZones.includes(targetZone)) {
            positions = { [card.instanceId]: { posX: dropX, posY: dropY } };
            if (followerOffsets) {
              for (const [id, offset] of followerOffsets) {
                positions[id] = { posX: dropX + offset.dx, posY: dropY + offset.dy };
              }
            }
          }
          moveCardsBatch(cardIds, targetZone, positions);
          clearSelection();
        } else if (freeFormZones.includes(targetZone)) {
          moveCard(card.instanceId, targetZone, undefined, dropX, dropY);
        } else {
          moveCard(card.instanceId, targetZone, undefined, dropX, dropY);
        }
      }

      // Re-trigger hover preview only if the card stayed in place (no zone change).
      // If the card moved zones, it's no longer under the cursor and mouseLeave
      // won't fire, so the preview would get stuck.
      const movedZones = targetZone && targetZone !== card.zone;
      if (!card.isFlipped && !movedZones) {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
          if (isDraggingRef.current || contextMenuRef.current) return;
          setHoverCard({
            card,
            x: e.evt.clientX,
            y: e.evt.clientY,
          });
        }, 700);
      }
    },
    [findZoneAtPosition, moveCard, moveCardsBatch, handleDeckDrop, cardWidth, cardHeight, selectedIds, clearSelection, state.turn]
  );

  const handleCardContextMenu = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoverCard(null);

      // If right-clicking a selected card with multi-selection, show multi-card menu
      if (selectedIds.has(card.instanceId) && selectedIds.size > 1) {
        setMultiCardContextMenu({
          x: e.evt.clientX - container.left,
          y: e.evt.clientY - container.top,
        });
      } else {
        // Clear selection if right-clicking an unselected card
        if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
          clearSelection();
        }
        setContextMenu({
          card,
          x: e.evt.clientX - container.left,
          y: e.evt.clientY - container.top,
        });
      }
    },
    [selectedIds, clearSelection]
  );

  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;

  const startHoverAnimation = useCallback(() => {
    if (hoverAnimFrameRef.current) cancelAnimationFrame(hoverAnimFrameRef.current);
    hoverStartTimeRef.current = performance.now();
    const animate = () => {
      const elapsed = performance.now() - hoverStartTimeRef.current!;
      const progress = Math.min(elapsed / 700, 1);
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

  const handleCardMouseEnter = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (card.isFlipped || isDraggingRef.current || contextMenuRef.current) return;
      setHoveredInstanceId(card.instanceId);
      startHoverAnimation();
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        if (isDraggingRef.current || contextMenuRef.current) return;
        // Stop the rAF loop but keep progress at 1 so glow stays while preview is showing
        if (hoverAnimFrameRef.current) {
          cancelAnimationFrame(hoverAnimFrameRef.current);
          hoverAnimFrameRef.current = null;
        }
        setHoverProgress(1);
        setHoverCard({
          card,
          x: e.evt.clientX,
          y: e.evt.clientY,
        });
      }, 700);
    },
    [startHoverAnimation, stopHoverAnimation]
  );

  const handleCardMouseLeave = useCallback(() => {
    setHoveredInstanceId(null);
    stopHoverAnimation();
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverCard(null);
  }, [stopHoverAnimation]);

  const handleCardDblClick = useCallback(
    (card: GameCard) => {
      if (card.isMeek) {
        unmeekCard(card.instanceId);
      } else {
        meekCard(card.instanceId);
      }
    },
    [meekCard, unmeekCard]
  );

  const handleDeckContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();
      setDeckMenu({
        x: e.evt.clientX - container.left,
        y: e.evt.clientY - container.top,
      });
    },
    []
  );

  const handleZoneClick = useCallback(
    (zoneId: ZoneId) => {
      const browsable: ZoneId[] = ['discard', 'reserve', 'banish', 'land-of-redemption'];
      if (browsable.includes(zoneId) && state.zones[zoneId].length > 0) {
        setBrowseZone(zoneId);
      }
    },
    [state.zones]
  );

  // Zones where cards should open browse modal instead of card context menu
  const BROWSE_ONLY_ZONES: ZoneId[] = ['discard', 'reserve', 'banish'];

  const handleBrowseZoneCardContextMenu = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      // Open the browse modal for the card's zone instead of the card context menu
      const zone = card.zone;
      if (zone && BROWSE_ONLY_ZONES.includes(zone)) {
        setBrowseZone(zone);
      }
    },
    []
  );

  const handleBrowseZoneCardClick = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.shiftKey) {
        toggleSelect(card.instanceId);
        return;
      }
      if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
        clearSelection();
      }
      const zone = card.zone;
      if (zone && BROWSE_ONLY_ZONES.includes(zone)) {
        setBrowseZone(zone);
      }
    },
    [selectedIds, clearSelection, toggleSelect]
  );

  // Universal card click handler for selection support
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
    [selectedIds, clearSelection, toggleSelect]
  );

  // Calculate card positions for each zone
  const handPositions = useMemo(
    () => calculateHandPositions(state.zones.hand.length, width, height, state.isSpreadHand),
    [state.zones.hand.length, width, height, state.isSpreadHand]
  );

  // Render all zones except hand
  const nonHandZones: ZoneId[] = useMemo(() => [
    'territory', 'land-of-bondage',
    'land-of-redemption', 'deck', 'discard', 'reserve', 'banish',
    ...(isParagon ? ['paragon' as ZoneId] : []),
  ], [isParagon]);

  // Compute card bounds for all visible cards (used for selection rectangle intersection)
  const allCardBounds = useMemo((): CardBound[] => {
    const bounds: CardBound[] = [];

    // Hand cards
    const handPos = calculateHandPositions(state.zones.hand.length, width, height, state.isSpreadHand);
    state.zones.hand.forEach((card, i) => {
      const pos = handPos[i];
      if (pos) bounds.push({ instanceId: card.instanceId, x: pos.x, y: pos.y, width: cardWidth, height: cardHeight, rotation: pos.rotation });
    });

    // Territory cards (free-form)
    const tZone = zoneLayout['territory'];
    if (tZone) {
      state.zones.territory.forEach((card, i) => {
        const x = card.posX ?? (tZone.x + 8 + (i % 8) * (cardWidth + 4));
        const y = card.posY ?? (tZone.y + 20 + Math.floor(i / 8) * (cardHeight * 0.35));
        bounds.push({ instanceId: card.instanceId, x, y, width: cardWidth, height: cardHeight, rotation: 0 });
      });
    }

    // Land of bondage (free-form)
    const lobZone = zoneLayout['land-of-bondage'];
    if (lobZone) {
      state.zones['land-of-bondage'].forEach((card, i) => {
        const x = card.posX ?? (lobZone.x + 8 + (i % 8) * (cardWidth + 4));
        const y = card.posY ?? (lobZone.y + 20 + Math.floor(i / 8) * (cardHeight * 0.35));
        bounds.push({ instanceId: card.instanceId, x, y, width: cardWidth, height: cardHeight, rotation: 0 });
      });
    }

    // Reserve (horizontal overlap)
    const resZone = zoneLayout['reserve'];
    if (resZone && state.zones.reserve.length > 0) {
      const pad = 8;
      const availW = resZone.width - pad * 2;
      const cards = state.zones.reserve;
      const overlap = cards.length <= 1 ? 0 : Math.min(cardWidth * 0.3, (availW - cardWidth) / (cards.length - 1));
      cards.forEach((card, i) => {
        bounds.push({ instanceId: card.instanceId, x: resZone.x + pad + i * overlap, y: resZone.y + 24, width: cardWidth, height: cardHeight, rotation: 0 });
      });
    }

    // Discard and Banish are browse-only piles — not drag-selectable

    // Land of Redemption (horizontal overlap)
    const lorZone = zoneLayout['land-of-redemption'];
    if (lorZone && state.zones['land-of-redemption'].length > 0) {
      const pad = 8;
      const availW = lorZone.width - pad * 2;
      const cards = state.zones['land-of-redemption'];
      const overlap = cards.length <= 1 ? 0 : Math.min(cardWidth * 0.3, (availW - cardWidth) / (cards.length - 1));
      cards.forEach((card, i) => {
        bounds.push({ instanceId: card.instanceId, x: lorZone.x + pad + i * overlap, y: lorZone.y + 24, width: cardWidth, height: cardHeight, rotation: 0 });
      });
    }

    return bounds;
  }, [state.zones, width, height, state.isSpreadHand, zoneLayout, cardWidth, cardHeight]);

  // Stage event handlers for rectangular selection drag
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Only left-click
      if (e.evt.button !== 0) return;
      // Only start selection drag on empty canvas space (not cards).
      // Walk up the node tree to detect any draggable ancestor (card Group),
      // since the click target may be a nested child (e.g. KonvaImage inside
      // a non-draggable meek-rotation Group inside the draggable card Group).
      const target = e.target;
      let ancestor: Konva.Node | null = target.parent;
      let isCard = false;
      while (ancestor && ancestor !== stageRef.current) {
        if (ancestor.draggable?.()) { isCard = true; break; }
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
    [selectedIds.size, clearSelection, startSelectionDrag]
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isSelectingRef.current) return;
      // If a card drag started (handleCardDragStart fired), cancel the selection
      // so the dotted rect doesn't flash alongside the card drag.
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
    [updateSelectionDrag, allCardBounds]
  );

  const handleStageMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isSelectingRef.current) return;
      endSelectionDrag(e.evt.shiftKey);
    },
    [endSelectionDrag]
  );

  // Access image cache via ref (imageVersion ensures we read current values after loads complete)
  const getImage = useCallback((imgFile: string): HTMLImageElement | undefined => {
    if (!imgFile) return undefined;
    const url = getCardImageUrl(imgFile);
    const img = imageCacheRef.current.get(url);
    return img || undefined;
  }, [imageVersion]); // imageVersion dependency ensures fresh reads after batch load

  const SIDEBAR_ZONES_WITH_BADGE: ZoneId[] = ['deck', 'reserve', 'discard', 'banish', 'land-of-redemption', 'territory', 'land-of-bondage'];

  // Abbreviated labels for narrow sidebar zones
  const SHORT_ZONE_LABELS: Partial<Record<ZoneId, string>> = {
    'land-of-redemption': 'L.O.R.',
    'land-of-bondage': 'L.O.B.',
    'banish': 'Banish',
  };
  const sidebarWidth = zoneLayout['deck']?.width ?? 0;
  const useShortenedLabels = sidebarWidth < 160;

  return (
    <>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onContextMenu={(e) => e.evt.preventDefault()}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        {/* Zone backgrounds layer */}
        <Layer listening={true}>
          {nonHandZones.map(zoneId => {
            const rect = zoneLayout[zoneId];
            if (!rect) return null;
            const cardCount = state.zones[zoneId]?.length || 0;

            return (
              <Group
                key={zoneId}
                onClick={() => {
                  if (zoneId !== 'deck') handleZoneClick(zoneId);
                }}
                onDblClick={(e) => {
                  if (zoneId === 'deck' && e.evt.button === 0) drawCard();
                }}
                onDblTap={() => {
                  if (zoneId === 'deck') drawCard();
                }}
                onContextMenu={(e) => {
                  if (zoneId === 'deck') handleDeckContextMenu(e);
                }}
              >
                <Rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  fill="#1e1610"
                  stroke="#6b4e27"
                  strokeWidth={1}
                  cornerRadius={3}
                  opacity={0.35}
                />
                <Text
                  x={rect.x + 8}
                  y={rect.y + 6}
                  text={(useShortenedLabels && SHORT_ZONE_LABELS[zoneId] ? SHORT_ZONE_LABELS[zoneId] : rect.label).toUpperCase()}
                  fontSize={SIDEBAR_ZONES_WITH_BADGE.includes(zoneId) && useShortenedLabels ? 11 : 14}
                  fontFamily="Cinzel, Georgia, serif"
                  fill="#e8d5a3"
                  letterSpacing={SIDEBAR_ZONES_WITH_BADGE.includes(zoneId) && useShortenedLabels ? 1 : 2}
                  width={rect.width - 8 - 38}
                  ellipsis={true}
                />
                {/* Count badge for sidebar zones */}
                {SIDEBAR_ZONES_WITH_BADGE.includes(zoneId) && (
                  <Group x={rect.x + rect.width - 34} y={rect.y + 4}>
                    <Rect width={28} height={20} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
                    <Text
                      text={String(cardCount)}
                      fontSize={14}
                      fontStyle="bold"
                      fill="#e8d5a3"
                      width={28}
                      height={20}
                      align="center"
                      verticalAlign="middle"
                    />
                  </Group>
                )}
              </Group>
            );
          })}

          {/* Hand zone background */}
          <Rect
            x={zoneLayout.hand.x}
            y={zoneLayout.hand.y}
            width={zoneLayout.hand.width}
            height={zoneLayout.hand.height}
            fill="#0d0905"
            opacity={0.5}
          />
          {/* Hand label + count */}
          <Text
            x={zoneLayout.hand.x + 8}
            y={zoneLayout.hand.y + 4}
            text="HAND"
            fontSize={14}
            fontFamily="Cinzel, Georgia, serif"
            fill="#e8d5a3"
            letterSpacing={2}
          />
          <Group x={zoneLayout.hand.x + 70} y={zoneLayout.hand.y + 2}>
            <Rect width={28} height={20} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
            <Text
              text={String(state.zones.hand.length)}
              fontSize={14}
              fontStyle="bold"
              fill="#e8d5a3"
              width={28}
              height={20}
              align="center"
              verticalAlign="middle"
            />
          </Group>
          {state.zones.hand.length === 0 && (
            <Text
              x={zoneLayout.hand.x}
              y={zoneLayout.hand.y + zoneLayout.hand.height / 2 - 8}
              width={zoneLayout.hand.width}
              text="Hand is empty"
              fontSize={14}
              fontFamily="Cinzel, Georgia, serif"
              fill="#6b4e27"
              opacity={0.5}
              align="center"
            />
          )}
        </Layer>

        {/* Card layer — non-hand zones */}
        <Layer key={`cards-${cardRenderKey}`}>
          {nonHandZones.map(zoneId => {
            const cards = state.zones[zoneId];
            if (!cards || cards.length === 0) return null;

            // Deck: show top card face-down, right-click opens deck search
            if (zoneId === 'deck') {
              const zone = zoneLayout[zoneId];
              const cx = zone.x + zone.width / 2;
              const cy = zone.y + zone.height / 2;
              const rot = rotateSidebarPiles ? -90 : 0;
              const oX = rotateSidebarPiles ? cardWidth / 2 : 0;
              const oY = rotateSidebarPiles ? cardHeight / 2 : 0;
              // When not rotated, position top-left so card sits below the label
              const px = rotateSidebarPiles ? cx : zone.x + zone.width / 2 - cardWidth / 2;
              const py = rotateSidebarPiles ? cy : zone.y + 24;
              return (
                <Group key={zoneId}>
                  {cards.length > 1 && (
                    <Group x={px - 2} y={py - 2} rotation={rot} offsetX={oX} offsetY={oY}>
                      <CardBackShape width={cardWidth} height={cardHeight} />
                    </Group>
                  )}
                  <Group
                    x={px}
                    y={py}
                    rotation={rot}
                    offsetX={oX}
                    offsetY={oY}
                    onContextMenu={handleDeckContextMenu}
                    onDblClick={(e) => { if (e.evt.button === 0) drawCard(); }}
                    onDblTap={() => drawCard()}
                  >
                    <CardBackShape width={cardWidth} height={cardHeight} />
                  </Group>
                </Group>
              );
            }

            // Reserve: overlap cards horizontally, sorted by type then name
            if (zoneId === 'reserve') {
              const zone = zoneLayout[zoneId];
              const pad = 8;
              const availW = zone.width - pad * 2;
              const sorted = [...cards].sort((a, b) =>
                a.type.localeCompare(b.type) || a.cardName.localeCompare(b.cardName)
              );
              const overlap = sorted.length <= 1
                ? 0
                : Math.min(cardWidth * 0.3, (availW - cardWidth) / (sorted.length - 1));
              return (
                <Group key={zoneId}>
                  {sorted.map((card, i) => (
                    <GameCardNode
                      key={card.instanceId}
                      card={card}
                      x={zone.x + pad + i * overlap}
                      y={zone.y + 24}
                      rotation={0}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getImage(card.cardImgFile)}
                      isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleBrowseZoneCardContextMenu}
                      onClick={handleBrowseZoneCardClick}
                      onDblClick={handleCardDblClick}
                      onMouseEnter={handleCardMouseEnter}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  ))}
                </Group>
              );
            }

            // Banish: face-down stacked pile, click opens browse modal
            if (zoneId === 'banish') {
              const zone = zoneLayout[zoneId];
              const cx = zone.x + zone.width / 2;
              const cy = zone.y + zone.height / 2;
              const rot = rotateSidebarPiles ? -90 : 0;
              const oX = rotateSidebarPiles ? cardWidth / 2 : 0;
              const oY = rotateSidebarPiles ? cardHeight / 2 : 0;
              const px = rotateSidebarPiles ? cx : zone.x + zone.width / 2 - cardWidth / 2;
              const py = rotateSidebarPiles ? cy : zone.y + 24;
              return (
                <Group key={zoneId}>
                  {cards.length > 1 && (
                    <Group x={px - 2} y={py - 2} rotation={rot} offsetX={oX} offsetY={oY}>
                      <CardBackShape width={cardWidth} height={cardHeight} />
                    </Group>
                  )}
                  <Group
                    x={px}
                    y={py}
                    rotation={rot}
                    offsetX={oX}
                    offsetY={oY}
                    onClick={() => setBrowseZone('banish')}
                    onTap={() => setBrowseZone('banish')}
                    onContextMenu={(e) => { e.evt.preventDefault(); setBrowseZone('banish'); }}
                  >
                    <CardBackShape width={cardWidth} height={cardHeight} />
                  </Group>
                </Group>
              );
            }

            // Discard: stack with natural jitter
            if (zoneId === 'discard') {
              const zone = zoneLayout[zoneId];
              const cx = zone.x + zone.width / 2;
              const cy = zone.y + zone.height / 2;
              // When rotated, GameCardNode rotates around top-left, so pre-offset
              // so the visual center lands at (cx, cy).
              const baseX = rotateSidebarPiles ? cx - cardHeight / 2 : cx - cardWidth / 2;
              const baseY = rotateSidebarPiles ? cy + cardWidth / 2 : zone.y + 24;
              const baseRot = rotateSidebarPiles ? -90 : 0;
              return (
                <Group key={zoneId}>
                  {cards.map((card, i) => {
                    // Stable per-card jitter from instanceId hash
                    let h = 0;
                    for (let c = 0; c < card.instanceId.length; c++) {
                      h = ((h << 5) - h + card.instanceId.charCodeAt(c)) | 0;
                    }
                    const jitterX = ((h & 0xff) / 255 - 0.5) * 6;
                    const jitterY = (((h >> 8) & 0xff) / 255 - 0.5) * 6;
                    const jitterRot = (((h >> 16) & 0xff) / 255 - 0.5) * 8;
                    return (
                      <GameCardNode
                        key={card.instanceId}
                        card={{ ...card, isFlipped: false }}
                        x={baseX + jitterX}
                        y={baseY + jitterY}
                        rotation={baseRot + jitterRot}
                        cardWidth={cardWidth}
                        cardHeight={cardHeight}
                        image={getImage(card.cardImgFile)}
                        isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleBrowseZoneCardContextMenu}
                        onClick={handleBrowseZoneCardClick}
                        onDblClick={handleCardDblClick}
                        onMouseEnter={handleCardMouseEnter}
                        onMouseLeave={handleCardMouseLeave}
                      />
                    );
                  })}
                </Group>
              );
            }

            // Land of Redemption: overlap cards within zone bounds
            if (zoneId === 'land-of-redemption') {
              const zone = zoneLayout[zoneId];
              const pad = 8;
              const availW = zone.width - pad * 2;
              const overlap = cards.length <= 1
                ? 0
                : Math.min(cardWidth * 0.3, (availW - cardWidth) / (cards.length - 1));
              return (
                <Group key={zoneId}>
                  {cards.map((card, i) => (
                    <GameCardNode
                      key={card.instanceId}
                      card={card}
                      x={zone.x + pad + i * overlap}
                      y={zone.y + 24}
                      rotation={0}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getImage(card.cardImgFile)}
                      isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onClick={handleCardClick}
                      onDblClick={handleCardDblClick}
                      onMouseEnter={handleCardMouseEnter}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  ))}
                </Group>
              );
            }

            // Territory: free-form placement using stored positions
            if (zoneId === 'territory') {
              const zone = zoneLayout[zoneId];
              return (
                <Group key={zoneId}>
                  {cards.map((card, i) => {
                    const x = card.posX ?? (zone.x + 8 + (i % 8) * (cardWidth + 4));
                    const y = card.posY ?? (zone.y + 20 + Math.floor(i / 8) * (cardHeight * 0.35));
                    return (
                      <GameCardNode
                        key={card.instanceId}
                        card={card}
                        x={x}
                        y={y}
                        rotation={0}
                        cardWidth={cardWidth}
                        cardHeight={cardHeight}
                        image={getImage(card.cardImgFile)}
                        isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onClick={handleCardClick}
                        onDblClick={handleCardDblClick}
                        onMouseEnter={handleCardMouseEnter}
                        onMouseLeave={handleCardMouseLeave}
                      />
                    );
                  })}
                </Group>
              );
            }

            // Land of Bondage: free-form placement using stored positions
            if (zoneId === 'land-of-bondage') {
              const zone = zoneLayout[zoneId];
              return (
                <Group key={zoneId}>
                  {cards.map((card, i) => {
                    const x = card.posX ?? (zone.x + 8 + (i % 8) * (cardWidth + 4));
                    const y = card.posY ?? (zone.y + 20 + Math.floor(i / 8) * (cardHeight * 0.35));
                    return (
                      <GameCardNode
                        key={card.instanceId}
                        card={card}
                        x={x}
                        y={y}
                        rotation={0}
                        cardWidth={cardWidth}
                        cardHeight={cardHeight}
                        image={getImage(card.cardImgFile)}
                        isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onClick={handleCardClick}
                        onDblClick={handleCardDblClick}
                        onMouseEnter={handleCardMouseEnter}
                        onMouseLeave={handleCardMouseLeave}
                      />
                    );
                  })}
                </Group>
              );
            }

            // For other zones, lay cards out in a grid
            const positions = calculateCardPositionsInZone(
              zoneLayout[zoneId],
              cards.length,
              cardWidth,
              cardHeight
            );
            const isBrowseOnly = BROWSE_ONLY_ZONES.includes(zoneId);

            return (
              <Group key={zoneId}>
                {cards.map((card, i) => {
                  const pos = positions[i];
                  if (!pos) return null;
                  return (
                    <GameCardNode
                      key={card.instanceId}
                      card={card}
                      x={pos.x}
                      y={pos.y}
                      rotation={0}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getImage(card.cardImgFile)}
                      isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={isBrowseOnly ? handleBrowseZoneCardContextMenu : handleCardContextMenu}
                      onClick={isBrowseOnly ? handleBrowseZoneCardClick : handleCardClick}
                      onDblClick={handleCardDblClick}
                      onMouseEnter={handleCardMouseEnter}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })}
        </Layer>

        {/* Hand layer — separate for z-ordering */}
        <Layer key={`hand-${cardRenderKey}`}>
          {state.zones.hand.map((card, i) => {
            const pos = handPositions[i];
            if (!pos) return null;
            return (
              <GameCardNode
                key={card.instanceId}
                card={card}
                x={pos.x}
                y={pos.y}
                rotation={pos.rotation}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                image={getImage(card.cardImgFile)}
                isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                nodeRef={registerCardNode}
                onDragStart={handleCardDragStart}
                onDragMove={handleCardDragMove}
                onDragEnd={handleCardDragEnd}
                onContextMenu={handleCardContextMenu}
                onClick={handleCardClick}
                onDblClick={handleCardDblClick}
                onMouseEnter={handleCardMouseEnter}
                onMouseLeave={handleCardMouseLeave}
              />
            );
          })}
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

      {/* DOM overlays */}

      {/* Reserve lock indicator on turn 1 */}
      {state.turn === 1 && zoneLayout.reserve && (
        <div
          className="reserve-lock-wrapper"
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            left: zoneLayout.reserve.x + zoneLayout.reserve.width - 52,
            top: zoneLayout.reserve.y + 5,
            pointerEvents: 'auto',
            cursor: 'help',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            zIndex: 50,
          }}
        >
          <svg width="12" height="14" viewBox="0 0 12 14" fill="none" style={{ opacity: 0.7 }}>
            <rect x="1" y="6" width="10" height="7" rx="1.5" fill="#6b4e27" stroke="#8b6532" strokeWidth="0.8" />
            <path d="M3.5 6V4.5C3.5 3.1 4.6 2 6 2s2.5 1.1 2.5 2.5V6" stroke="#8b6532" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <circle cx="6" cy="9.5" r="1" fill="#c9b99a" />
          </svg>
          <span
            className="reserve-lock-tip"
            style={{
              position: 'absolute',
              right: 0,
              bottom: '100%',
              marginBottom: 4,
              padding: '4px 8px',
              background: '#2a1f12',
              border: '1px solid #6b4e27',
              borderRadius: 4,
              color: '#e8d5a3',
              fontSize: 10,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              opacity: 0,
              transition: 'opacity 0.05s',
            }}
          >
            Cannot remove cards from reserve on turn 1
          </span>
          <style>{`
            .reserve-lock-wrapper:hover .reserve-lock-tip {
              opacity: 1 !important;
            }
          `}</style>
        </div>
      )}

      <PhaseBar />
      <GameToolbar />

      {contextMenu && (
        <CardContextMenu
          card={contextMenu.card}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onExchange={(ids) => setExchangeCardIds(ids)}
        />
      )}

      {multiCardContextMenu && (
        <MultiCardContextMenu
          selectedIds={Array.from(selectedIds)}
          x={multiCardContextMenu.x}
          y={multiCardContextMenu.y}
          onClose={() => setMultiCardContextMenu(null)}
          onClearSelection={() => { clearSelection(); setMultiCardContextMenu(null); }}
          onExchange={(ids) => setExchangeCardIds(ids)}
        />
      )}

      {deckMenu && (
        <DeckContextMenu
          x={deckMenu.x}
          y={deckMenu.y}
          deckSize={state.zones.deck.length}
          onClose={() => setDeckMenu(null)}
          onSearchDeck={() => { setDeckMenu(null); setShowDeckSearch(true); }}
          onShuffleDeck={() => { setDeckMenu(null); shuffleDeck(); }}
          // Top card actions
          onDrawTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const handSpace = 16 - state.zones.hand.length;
            if (handSpace <= 0) { showGameToast('Hand is full (max 16 cards)'); return; }
            if (count === 1) drawCard(); else drawMultiple(count);
            if (count > handSpace) {
              showGameToast(`Hand is full — drew ${Math.min(handSpace, deck.length)}`);
            }
          }}
          onRevealTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const n = Math.min(count, deck.length);
            const ids = deck.slice(0, n).map(c => c.instanceId);
            setPeekState({ cardIds: ids, title: `Top ${n} of Deck` });
          }}
          onDiscardTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'discard'));
          }}
          onReserveTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'reserve'));
          }}
          // Bottom card actions
          onDrawBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const handSpace = 16 - state.zones.hand.length;
            if (handSpace <= 0) { showGameToast('Hand is full (max 16 cards)'); return; }
            const n = Math.min(count, deck.length);
            const cards = deck.slice(-n);
            let drawn = 0;
            cards.forEach(c => {
              const isLS = c.type === 'LS' || c.type === 'Lost Soul' || c.type.toLowerCase().includes('lost soul');
              if (isLS) {
                moveCard(c.instanceId, 'land-of-bondage');
              } else if (drawn < handSpace) {
                moveCard(c.instanceId, 'hand');
                drawn++;
              }
            });
            if (count > handSpace) {
              showGameToast(`Hand is full — drew ${drawn}`);
            }
          }}
          onRevealBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const n = Math.min(count, deck.length);
            const ids = deck.slice(-n).map(c => c.instanceId);
            setPeekState({ cardIds: ids, title: `Bottom ${n} of Deck` });
          }}
          onDiscardBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(-Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'discard'));
          }}
          onReserveBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(-Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'reserve'));
          }}
          // Random card actions
          onDrawRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const handSpace = 16 - state.zones.hand.length;
            if (handSpace <= 0) { showGameToast('Hand is full (max 16 cards)'); return; }
            const shuffled = [...deck].sort(() => Math.random() - 0.5);
            const cards = shuffled.slice(0, Math.min(count, deck.length));
            let drawn = 0;
            cards.forEach(c => {
              const isLS = c.type === 'LS' || c.type === 'Lost Soul' || c.type.toLowerCase().includes('lost soul');
              if (isLS) {
                moveCard(c.instanceId, 'land-of-bondage');
              } else if (drawn < handSpace) {
                moveCard(c.instanceId, 'hand');
                drawn++;
              }
            });
            if (count > handSpace) {
              showGameToast(`Hand is full — drew ${drawn}`);
            }
          }}
          onRevealRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const shuffled = [...deck].sort(() => Math.random() - 0.5);
            const n = Math.min(count, deck.length);
            const ids = shuffled.slice(0, n).map(c => c.instanceId);
            setPeekState({ cardIds: ids, title: `Random ${n} from Deck` });
          }}
          onDiscardRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const shuffled = [...deck].sort(() => Math.random() - 0.5);
            const ids = shuffled.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'discard'));
          }}
          onReserveRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const shuffled = [...deck].sort(() => Math.random() - 0.5);
            const ids = shuffled.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'reserve'));
          }}
        />
      )}

      {hoverCard && (
        <CardHoverPreview
          card={hoverCard.card}
          anchorX={hoverCard.x}
          anchorY={hoverCard.y}
        />
      )}

      {browseZone && (
        <ZoneBrowseModal
          zoneId={browseZone}
          onClose={() => setBrowseZone(null)}
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

      {peekState !== null && (
        <DeckPeekModal
          cardIds={peekState.cardIds}
          title={peekState.title}
          onClose={() => setPeekState(null)}
          onStartDrag={modalStartDrag}
          onStartMultiDrag={modalStartMultiDrag}
          didDragRef={modalDidDragRef}
          isDragActive={modalDrag.isDragging}
        />
      )}

      {/* Zone drop target highlights — visible during any drag */}
      {(modalDrag.isDragging || canvasDragZone !== null) && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 450 }}>
          {(Object.entries(zoneLayout) as [ZoneId, ZoneRect][]).map(([zoneId, rect]) => {
            // Don't show highlight for the zone the card is being dragged from
            if (!modalDrag.isDragging && dragSourceZoneRef.current === zoneId) return null;
            const activeHoveredZone = modalDrag.isDragging ? modalHoveredZone : canvasDragZone;
            const isHovered = activeHoveredZone === zoneId;
            return (
              <div
                key={zoneId}
                style={{
                  position: 'absolute',
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  border: isHovered ? '1px solid rgba(196,149,90,0.6)' : '1px solid rgba(196,149,90,0.15)',
                  background: isHovered ? 'rgba(196,149,90,0.12)' : 'transparent',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{
                  color: isHovered ? 'rgba(232,213,163,0.7)' : 'rgba(232,213,163,0.3)',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                }}>
                  {rect.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating drag ghost */}
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
            {/* Stacked offset cards behind (max 2 for performance) */}
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
                  border: '1px solid #8b6532',
                  opacity: 0.4 - i * 0.15,
                  top: -(6 + i * 4),
                  left: 4 + i * 2,
                  zIndex: -1 - i,
                }}
              />
            ))}
            {/* Primary card on top */}
            <img
              src={modalDrag.imageUrl}
              alt="Dragging cards"
              draggable={false}
              style={{
                width: 80,
                borderRadius: 4,
                border: '2px solid #c4955a',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                opacity: 0.9,
              }}
            />
            {/* Count badge */}
            <div
              style={{
                position: 'absolute',
                top: -8,
                right: -8,
                background: '#c4955a',
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
              border: '2px solid #c4955a',
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              zIndex: 700,
              opacity: 0.9,
            }}
          />
        )
      )}

      {deckDropPopup && (
        <DeckDropPopup
          x={deckDropPopup.x}
          y={deckDropPopup.y}
          onShuffleIn={() => {
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            if (ids.length === 1) {
              moveCard(ids[0], 'deck');
            } else {
              moveCardsBatch(ids, 'deck');
            }
            shuffleDeck();
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
            if (batchDeckDropIds) clearSelection();
          }}
          onTopDeck={() => {
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            for (const id of ids) {
              moveCardToTopOfDeck(id);
            }
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
            if (batchDeckDropIds) clearSelection();
          }}
          onBottomDeck={() => {
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            for (const id of ids) {
              moveCardToBottomOfDeck(id);
            }
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
            if (batchDeckDropIds) clearSelection();
          }}
          onExchange={() => {
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            setExchangeCardIds(ids);
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
          }}
          onCancel={() => { setDeckDropPopup(null); setBatchDeckDropIds(null); setCardRenderKey(k => k + 1); }}
        />
      )}

      {exchangeCardIds && (
        <DeckExchangeModal
          exchangeCardIds={exchangeCardIds}
          onComplete={() => {
            setExchangeCardIds(null);
            clearSelection();
          }}
          onCancel={() => {
            setExchangeCardIds(null);
            setCardRenderKey(k => k + 1);
          }}
          onStartDrag={modalStartDrag}
          didDragRef={modalDidDragRef}
          isDragActive={modalDrag.isDragging}
        />
      )}

      <GameToastContainer />
    </>
  );
}
