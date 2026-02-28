'use client';

import { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group, Circle, Line } from 'react-konva';
import type Konva from 'konva';
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
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useModalCardDrag } from '../hooks/useModalCardDrag';
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

const CardBackShape = memo(function CardBackShape({ width, height }: { width: number; height: number }) {
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
});

// Individual card component — memoized to avoid re-rendering cards that haven't changed
const GameCardNode = memo(function GameCardNode({
  card,
  x,
  y,
  rotation,
  cardWidth,
  cardHeight,
  image,
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
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => void;
  onContextMenu: (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => void;
  onClick?: (card: GameCard) => void;
  onDblClick: (card: GameCard) => void;
  onMouseEnter: (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: () => void;
}) {
  const showFace = !card.isFlipped && image;

  return (
    <Group
      x={x}
      y={y}
      rotation={rotation}
      draggable
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={(e) => onDragEnd(card, e)}
      onContextMenu={(e) => onContextMenu(card, e)}
      onClick={onClick ? () => onClick(card) : undefined}
      onTap={onClick ? () => onClick(card) : undefined}
      onDblClick={() => onDblClick(card)}
      onDblTap={() => onDblClick(card)}
      onMouseEnter={(e) => onMouseEnter(card, e)}
      onMouseLeave={onMouseLeave}
    >
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
  const { state, dispatch, drawCard, drawMultiple, moveCard, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, meekCard, unmeekCard } = useGame();
  const stageRef = useRef<Konva.Stage>(null);

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
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
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
  const [peekCount, setPeekCount] = useState<number | null>(null);
  const [revealCard, setRevealCard] = useState<{ name: string; imgFile: string } | null>(null);
  const [deckDropPopup, setDeckDropPopup] = useState<{ cardInstanceId: string; x: number; y: number } | null>(null);
  const [canvasDragZone, setCanvasDragZone] = useState<ZoneId | null>(null);
  const isCanvasDragging = useRef(false);

  useKeyboardShortcuts();

  const isParagon = state.format === 'Paragon';
  const zoneLayout = useMemo(() => calculateZoneLayout(width, height, isParagon), [width, height, isParagon]);
  const { cardWidth, cardHeight } = useMemo(() => getCardDimensions(width), [width]);

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

  // Modal card drag (drag from search/peek/browse modals to canvas zones)
  const { dragState: modalDrag, startDrag: modalStartDrag, hoveredZone: modalHoveredZone, ghostRef: modalGhostRef } = useModalCardDrag({
    stageRef,
    zoneLayout,
    findZoneAtPosition,
    moveCard,
    onDeckDrop: handleDeckDrop,
    cardWidth,
    cardHeight,
  });

  // Clear hover state and mark dragging on drag start
  const handleCardDragStart = useCallback(() => {
    isDraggingRef.current = true;
    isCanvasDragging.current = true;
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverCard(null);
  }, []);

  const handleCardDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const centerX = node.x() + cardWidth / 2;
      const centerY = node.y() + cardHeight / 2;
      const zone = findZoneAtPosition(centerX, centerY);
      setCanvasDragZone(zone);
    },
    [findZoneAtPosition, cardWidth, cardHeight]
  );

  const handleCardDragEnd = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => {
      isDraggingRef.current = false;
      isCanvasDragging.current = false;
      setCanvasDragZone(null);
      const node = e.target;
      const dropX = node.x();
      const dropY = node.y();
      // Use card center for hit-testing so drops near zone edges work intuitively
      const centerX = dropX + cardWidth / 2;
      const centerY = dropY + cardHeight / 2;
      const targetZone = findZoneAtPosition(centerX, centerY);
      if (targetZone === 'deck' && card.zone !== 'deck') {
        // Show deck drop popup instead of moving directly
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          handleDeckDrop(card.instanceId, rect.left + centerX, rect.top + centerY);
        }
      } else if (targetZone && targetZone !== card.zone) {
        moveCard(card.instanceId, targetZone, undefined, dropX, dropY);
      } else if (targetZone === 'territory' && card.zone === 'territory') {
        // Dragging within territory — update position
        moveCard(card.instanceId, 'territory', undefined, dropX, dropY);
      }
    },
    [findZoneAtPosition, moveCard, handleDeckDrop, cardWidth, cardHeight]
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
      setContextMenu({
        card,
        x: e.evt.clientX - container.left,
        y: e.evt.clientY - container.top,
      });
    },
    []
  );

  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;

  const handleCardMouseEnter = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (card.isFlipped || isDraggingRef.current || contextMenuRef.current) return;
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        if (isDraggingRef.current || contextMenuRef.current) return;
        setHoverCard({
          card,
          x: e.evt.clientX,
          y: e.evt.clientY,
        });
      }, 700);
    },
    []
  );

  const handleCardMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverCard(null);
  }, []);

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
    (card: GameCard) => {
      const zone = card.zone;
      if (zone && BROWSE_ONLY_ZONES.includes(zone)) {
        setBrowseZone(zone);
      }
    },
    []
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

  // Access image cache via ref (imageVersion ensures we read current values after loads complete)
  const getImage = useCallback((imgFile: string): HTMLImageElement | undefined => {
    if (!imgFile) return undefined;
    const url = getCardImageUrl(imgFile);
    const img = imageCacheRef.current.get(url);
    return img || undefined;
  }, [imageVersion]); // imageVersion dependency ensures fresh reads after batch load

  const SIDEBAR_ZONES_WITH_BADGE: ZoneId[] = ['deck', 'reserve', 'discard', 'banish', 'land-of-redemption'];

  return (
    <>
      <Stage ref={stageRef} width={width} height={height} onContextMenu={(e) => e.evt.preventDefault()}>
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
                onDblClick={() => {
                  if (zoneId === 'deck') drawCard();
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
                  text={rect.label.toUpperCase()}
                  fontSize={14}
                  fontStyle="bold"
                  fontFamily="var(--font-cinzel), Georgia, serif"
                  fill="#e8d5a3"
                  letterSpacing={2}
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
            fontStyle="bold"
            fontFamily="var(--font-cinzel), Georgia, serif"
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
              fontFamily="var(--font-cinzel), Georgia, serif"
              fill="#6b4e27"
              opacity={0.5}
              align="center"
            />
          )}
        </Layer>

        {/* Card layer — non-hand zones */}
        <Layer>
          {nonHandZones.map(zoneId => {
            const cards = state.zones[zoneId];
            if (!cards || cards.length === 0) return null;

            // Deck: show top card face-down, right-click opens deck search
            if (zoneId === 'deck') {
              const zone = zoneLayout[zoneId];
              const x = zone.x + zone.width / 2 - cardWidth / 2;
              const y = zone.y + 24;
              return (
                <Group key={zoneId}>
                  {cards.length > 1 && (
                    <Group x={x - 2} y={y - 2}>
                      <CardBackShape width={cardWidth} height={cardHeight} />
                    </Group>
                  )}
                  <Group
                    x={x}
                    y={y}
                    onContextMenu={handleDeckContextMenu}
                    onDblClick={() => drawCard()}
                    onDblTap={() => drawCard()}
                  >
                    <CardBackShape width={cardWidth} height={cardHeight} />
                  </Group>
                </Group>
              );
            }

            // Reserve: show top card face-down
            // Reserve: overlap cards horizontally within zone bounds
            if (zoneId === 'reserve') {
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

            // Discard: stack vertically with slight offset
            if (zoneId === 'discard') {
              const zone = zoneLayout[zoneId];
              const baseX = zone.x + zone.width / 2 - cardWidth / 2;
              const baseY = zone.y + 24;
              const maxOffset = Math.min(cards.length - 1, 4);
              return (
                <Group key={zoneId}>
                  {cards.map((card, i) => {
                    return (
                      <GameCardNode
                        key={card.instanceId}
                        card={{ ...card, isFlipped: false }}
                        x={baseX + Math.min(i, maxOffset) * 1}
                        y={baseY + Math.min(i, maxOffset) * 3}
                        rotation={0}
                        cardWidth={cardWidth}
                        cardHeight={cardHeight}
                        image={getImage(card.cardImgFile)}
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
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
  
                      onContextMenu={handleCardContextMenu}
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
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
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
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={isBrowseOnly ? handleBrowseZoneCardContextMenu : handleCardContextMenu}
                      onClick={isBrowseOnly ? handleBrowseZoneCardClick : undefined}
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
        <Layer>
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
                onDragStart={handleCardDragStart}
                onDragMove={handleCardDragMove}
                onDragEnd={handleCardDragEnd}
                onContextMenu={handleCardContextMenu}
                onDblClick={handleCardDblClick}
                onMouseEnter={handleCardMouseEnter}
                onMouseLeave={handleCardMouseLeave}
              />
            );
          })}
        </Layer>
      </Stage>

      {/* DOM overlays */}
      <PhaseBar />
      <GameToolbar />

      {contextMenu && (
        <CardContextMenu
          card={contextMenu.card}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
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
          onRevealTop={(count) => { setDeckMenu(null); setPeekCount(count); }}
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
            if (count === 1) {
              const bottom = deck[deck.length - 1];
              setRevealCard({ name: bottom.cardName, imgFile: bottom.cardImgFile });
            } else {
              // For N bottom reveals, show the bottom N cards' names via toast
              const bottomN = deck.slice(-Math.min(count, deck.length));
              const names = bottomN.map(c => c.cardName).join(', ');
              showGameToast(`Bottom ${bottomN.length}: ${names}`);
            }
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
            const picked = shuffled.slice(0, Math.min(count, deck.length));
            if (count === 1) {
              setRevealCard({ name: picked[0].cardName, imgFile: picked[0].cardImgFile });
            } else {
              const names = picked.map(c => c.cardName).join(', ');
              showGameToast(`Random ${picked.length}: ${names}`);
            }
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
          isDragActive={modalDrag.isDragging}
        />
      )}

      {showDeckSearch && (
        <DeckSearchModal
          onClose={() => setShowDeckSearch(false)}
          onStartDrag={modalStartDrag}
          isDragActive={modalDrag.isDragging}
        />
      )}

      {peekCount !== null && (
        <DeckPeekModal
          count={peekCount}
          onClose={() => setPeekCount(null)}
          onStartDrag={modalStartDrag}
          isDragActive={modalDrag.isDragging}
        />
      )}

      {revealCard && (
        <div
          onClick={() => setRevealCard(null)}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              color: '#8b6532',
              fontSize: 11,
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              Bottom of Deck
            </div>
            {revealCard.imgFile ? (
              <img
                src={getCardImageUrl(revealCard.imgFile)}
                alt={revealCard.name}
                style={{ width: 220, borderRadius: 6, border: '1px solid #6b4e27' }}
              />
            ) : (
              <div style={{
                width: 220,
                height: 308,
                background: '#2a1f12',
                border: '1px solid #6b4e27',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#c9b99a',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 13,
              }}>
                {revealCard.name}
              </div>
            )}
            <div style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              color: '#c9b99a',
              fontSize: 12,
              marginTop: 8,
            }}>
              {revealCard.name}
            </div>
            <div style={{
              color: '#6b4e27',
              fontSize: 10,
              marginTop: 6,
            }}>
              Click anywhere to close
            </div>
          </div>
        </div>
      )}

      {/* Zone drop target highlights — visible during any drag */}
      {(modalDrag.isDragging || canvasDragZone !== null) && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 450 }}>
          {(Object.entries(zoneLayout) as [ZoneId, ZoneRect][]).map(([zoneId, rect]) => {
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
                  border: isHovered ? '2px solid #c4955a' : '1px solid rgba(196,149,90,0.4)',
                  background: isHovered ? 'rgba(196,149,90,0.25)' : 'rgba(196,149,90,0.08)',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.1s ease',
                }}
              >
                <span style={{
                  color: isHovered ? '#e8d5a3' : 'rgba(232,213,163,0.5)',
                  fontSize: 14,
                  fontWeight: 'bold',
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
        <img
          ref={modalGhostRef}
          src={modalDrag.imageUrl}
          alt="Dragging card"
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
      )}

      {deckDropPopup && (
        <DeckDropPopup
          x={deckDropPopup.x}
          y={deckDropPopup.y}
          onShuffleIn={() => {
            moveCard(deckDropPopup.cardInstanceId, 'deck');
            shuffleDeck();
            setDeckDropPopup(null);
          }}
          onTopDeck={() => {
            moveCardToTopOfDeck(deckDropPopup.cardInstanceId);
            setDeckDropPopup(null);
          }}
          onBottomDeck={() => {
            moveCardToBottomOfDeck(deckDropPopup.cardInstanceId);
            setDeckDropPopup(null);
          }}
          onCancel={() => setDeckDropPopup(null)}
        />
      )}

      <GameToastContainer />
    </>
  );
}
