'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Stage, Layer, Rect, Text, Group, Circle } from 'react-konva';
import type Konva from 'konva';
import { useGameState } from '../hooks/useGameState';
import { useMultiplayerImagePreloader } from '../hooks/useMultiplayerImagePreloader';
import {
  calculateMirrorLayout,
  getCardDimensions,
  type ZoneRect,
} from '../layout/mirrorLayout';
import {
  GameCardNode,
  CardBackShape,
  cardBackListeners,
  cardBackLoaded,
} from '../../shared/components/GameCardNode';
import type { GameCard, Counter } from '../../goldfish/types';
import { COUNTER_COLORS } from '../../goldfish/types';
import type {
  CardInstance,
  CardCounter,
} from '@/lib/spacetimedb/module_bindings/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

/** Sidebar zones that display as a pile with a count badge (not individual cards). */
const SIDEBAR_PILE_ZONES = ['deck', 'discard', 'reserve', 'banish', 'land-of-redemption'] as const;

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

/**
 * Calculate fan positions for cards in the player's hand.
 * Adapted from goldfish handLayout for the multiplayer mirror layout hand rect.
 */
function calculateMultiplayerHandPositions(
  cardCount: number,
  handRect: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): { x: number; y: number; rotation: number }[] {
  if (cardCount === 0) return [];

  const centerX = handRect.x + handRect.width / 2;
  const handAreaWidth = handRect.width * 0.75;
  const handY = handRect.y + Math.max(0, (handRect.height - cardHeight) / 2);

  // Fan arc layout
  const maxArcAngle = 20;
  const minVisibleFraction = 0.3;

  const maxCardSpacing = cardWidth + 4;
  const minCardSpacing = cardWidth * minVisibleFraction;
  const idealSpacing = Math.min(maxCardSpacing, handAreaWidth / Math.max(cardCount, 1));
  const spacing = Math.max(minCardSpacing, idealSpacing);

  const totalWidth = (cardCount - 1) * spacing;
  const startX = centerX - totalWidth / 2;

  const arcAngle = cardCount > 1 ? maxArcAngle / (cardCount - 1) : 0;
  const startAngle = -maxArcAngle / 2;

  return Array.from({ length: cardCount }, (_, i) => {
    const x = startX + i * spacing;
    const rotation = cardCount > 1 ? startAngle + i * arcAngle : 0;
    const normalizedPos = cardCount > 1 ? (i / (cardCount - 1)) * 2 - 1 : 0;
    const yOffset = normalizedPos * normalizedPos * 8; // parabolic arc (smaller for compact hand)
    return { x, y: handY + yOffset, rotation };
  });
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
  // ---- Viewport sizing ----
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const { width, height } = dimensions;

  // ---- Game state ----
  const gameState = useGameState(gameId);
  const { myCards, opponentCards, counters } = gameState;

  // ---- Layout ----
  const layout = useMemo(
    () => (width > 0 && height > 0 ? calculateMirrorLayout(width, height) : null),
    [width, height],
  );
  const { cardWidth, cardHeight } = useMemo(
    () => (width > 0 ? getCardDimensions(width) : { cardWidth: 0, cardHeight: 0 }),
    [width],
  );

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

  // Noop handlers for GameCardNode required props (interaction is Task 15+)
  const noop = useCallback(() => {}, []);
  const noopDrag = useCallback((_e: Konva.KonvaEventObject<DragEvent>) => {}, []);
  const noopCardDrag = useCallback((_card: GameCard) => {}, []);
  const noopCardDragEnd = useCallback((_card: GameCard, _e: Konva.KonvaEventObject<DragEvent>) => {}, []);
  const noopContextMenu = useCallback((_card: GameCard, _e: Konva.KonvaEventObject<PointerEvent>) => {}, []);
  const noopDblClick = useCallback((_card: GameCard) => {}, []);

  const handleMouseEnter = useCallback(
    (card: GameCard, _e: Konva.KonvaEventObject<MouseEvent>) => {
      setHoveredInstanceId(card.instanceId);
      startHoverAnimation();
    },
    [startHoverAnimation],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredInstanceId(null);
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

  // ---- Don't render until we have dimensions and layout ----
  if (width === 0 || height === 0 || !layout) {
    return null;
  }

  // Shorthand
  const { myZones, opponentZones, myHandRect, opponentHandRect, phaseBarRect } = layout;

  // ---- Helper: get image for a CardInstance ----
  const getCardImage = (card: CardInstance): HTMLImageElement | undefined => {
    if (!card.cardImgFile || card.isFlipped) return undefined;
    const url = getCardImageUrl(card.cardImgFile);
    return getImage(url) ?? undefined;
  };

  // Free-form zones — render individual cards at posX/posY
  const FREE_FORM_ZONES = ['territory', 'land-of-bondage'] as const;

  // All sidebar pile zone keys
  const SIDEBAR_ZONES = SIDEBAR_PILE_ZONES;

  return (
    <Stage width={width} height={height}>
      <Layer>
        {/* ================================================================
            Zone backgrounds — My zones
            ================================================================ */}
        {Object.entries(myZones).map(([key, zone]) => (
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
            />
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
          </Group>
        ))}

        {/* ================================================================
            Zone backgrounds — Opponent zones
            ================================================================ */}
        {Object.entries(opponentZones).map(([key, zone]) => (
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
          </Group>
        ))}

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
            Phase bar background
            ================================================================ */}
        <Rect
          x={phaseBarRect.x}
          y={phaseBarRect.y}
          width={phaseBarRect.width}
          height={phaseBarRect.height}
          fill="#0d0905"
          opacity={0.6}
        />

        {/* ================================================================
            Cards in free-form zones — My territory & LOB
            ================================================================ */}
        {FREE_FORM_ZONES.map((zoneKey) => {
          const cards = myCards[zoneKey];
          if (!cards || cards.length === 0) return null;
          return (
            <Group key={`my-cards-${zoneKey}`}>
              {cards.map((card) => {
                const gameCard = adaptCard(card, 'player1');
                const x = card.posX ? parseFloat(card.posX) : (myZones[zoneKey]?.x ?? 0) + 20;
                const y = card.posY ? parseFloat(card.posY) : (myZones[zoneKey]?.y ?? 0) + 24;
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
                    isSelected={false}
                    hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                    onDragStart={noopCardDrag}
                    onDragMove={noopDrag}
                    onDragEnd={noopCardDragEnd}
                    onContextMenu={noopContextMenu}
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
            Cards in free-form zones — Opponent territory & LOB
            ================================================================ */}
        {FREE_FORM_ZONES.map((zoneKey) => {
          const cards = opponentCards[zoneKey];
          if (!cards || cards.length === 0) return null;
          return (
            <Group key={`opp-cards-${zoneKey}`}>
              {cards.map((card) => {
                const gameCard = adaptCard(card, 'player2');
                const x = card.posX ? parseFloat(card.posX) : (opponentZones[zoneKey]?.x ?? 0) + 20;
                const y = card.posY ? parseFloat(card.posY) : (opponentZones[zoneKey]?.y ?? 0) + 24;
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
                    isSelected={false}
                    hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                    onDragStart={noopCardDrag}
                    onDragMove={noopDrag}
                    onDragEnd={noopCardDragEnd}
                    onContextMenu={noopContextMenu}
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
            Sidebar pile indicators — My zones
            ================================================================ */}
        {SIDEBAR_ZONES.map((zoneKey) => {
          const zone = myZones[zoneKey];
          if (!zone) return null;
          const cards = myCards[zoneKey] ?? [];
          const count = cards.length;
          const cx = zone.x + zone.width / 2 - cardWidth / 2;
          const cy = zone.y + 22;

          // For discard, show top card face-up; for everything else, card back
          const topCard = cards[cards.length - 1];
          const showFace = zoneKey === 'discard' && topCard && !topCard.isFlipped;

          return (
            <Group key={`my-pile-${zoneKey}`}>
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
                      <CardBackShape width={cardWidth} height={cardHeight} />
                    </Group>
                  )}
                  {showFace && topCard ? (
                    (() => {
                      const img = getCardImage(topCard);
                      return img ? (
                        <Group>
                          <Rect
                            width={cardWidth}
                            height={cardHeight}
                            cornerRadius={4}
                          />
                          {/* Use KonvaImage via react-konva is not directly available here;
                              render the top card using GameCardNode for consistency */}
                          <GameCardNode
                            card={adaptCard(topCard, 'player1')}
                            x={0}
                            y={0}
                            rotation={0}
                            cardWidth={cardWidth}
                            cardHeight={cardHeight}
                            image={img}
                            isSelected={false}
                            hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                            onDragStart={noopCardDrag}
                            onDragMove={noopDrag}
                            onDragEnd={noopCardDragEnd}
                            onContextMenu={noopContextMenu}
                            onDblClick={noopDblClick}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                          />
                        </Group>
                      ) : (
                        <CardBackShape width={cardWidth} height={cardHeight} />
                      );
                    })()
                  ) : (
                    <CardBackShape width={cardWidth} height={cardHeight} />
                  )}
                </Group>
              )}
            </Group>
          );
        })}

        {/* ================================================================
            Sidebar pile indicators — Opponent zones
            ================================================================ */}
        {SIDEBAR_ZONES.map((zoneKey) => {
          const zone = opponentZones[zoneKey];
          if (!zone) return null;
          const cards = opponentCards[zoneKey] ?? [];
          const count = cards.length;
          const cx = zone.x + zone.width / 2 - cardWidth / 2;
          const cy = zone.y + 22;

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
                      <CardBackShape width={cardWidth} height={cardHeight} />
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
                            cardWidth={cardWidth}
                            cardHeight={cardHeight}
                            image={img}
                            isSelected={false}
                            hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                            onDragStart={noopCardDrag}
                            onDragMove={noopDrag}
                            onDragEnd={noopCardDragEnd}
                            onContextMenu={noopContextMenu}
                            onDblClick={noopDblClick}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                          />
                        </Group>
                      ) : (
                        <CardBackShape width={cardWidth} height={cardHeight} />
                      );
                    })()
                  ) : (
                    <CardBackShape width={cardWidth} height={cardHeight} />
                  )}
                </Group>
              )}
            </Group>
          );
        })}

        {/* ================================================================
            Opponent hand — row of card backs
            ================================================================ */}
        {(() => {
          const oppHandCount = opponentCards['hand']?.length ?? 0;
          if (oppHandCount === 0) return null;

          const spacing = Math.min(
            cardWidth + 4,
            (opponentHandRect.width * 0.7) / Math.max(oppHandCount, 1),
          );
          const totalWidth = (oppHandCount - 1) * spacing;
          const startX = opponentHandRect.x + opponentHandRect.width / 2 - totalWidth / 2;
          const cy = opponentHandRect.y + Math.max(0, (opponentHandRect.height - cardHeight) / 2);

          return (
            <Group>
              {Array.from({ length: oppHandCount }, (_, i) => (
                <Group key={`opp-hand-${i}`} x={startX + i * spacing} y={cy}>
                  <CardBackShape width={cardWidth} height={cardHeight} />
                </Group>
              ))}
            </Group>
          );
        })()}

        {/* ================================================================
            My hand — fan layout at bottom
            ================================================================ */}
        {(() => {
          const handCards = myCards['hand'] ?? [];
          if (handCards.length === 0) return null;

          const positions = calculateMultiplayerHandPositions(
            handCards.length,
            myHandRect,
            cardWidth,
            cardHeight,
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
                    isSelected={false}
                    hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                    onDragStart={noopCardDrag}
                    onDragMove={noopDrag}
                    onDragEnd={noopCardDragEnd}
                    onContextMenu={noopContextMenu}
                    onDblClick={noopDblClick}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  />
                );
              })}
            </Group>
          );
        })()}
      </Layer>
    </Stage>
  );
}
