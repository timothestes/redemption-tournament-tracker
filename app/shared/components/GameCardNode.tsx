'use client';

import { memo, useCallback } from 'react';
import { Group, Rect, Image as KonvaImage, Circle, Text } from 'react-konva';
import type Konva from 'konva';
import { GameCard, COUNTER_COLORS } from '../../goldfish/types';

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

export { cardBackListeners, cardBackLoaded };

export function CardBackShape({ width, height }: { width: number; height: number }) {
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

export interface GameCardNodeProps {
  card: GameCard;
  x: number;
  y: number;
  rotation: number;
  cardWidth: number;
  cardHeight: number;
  image: HTMLImageElement | undefined;
  isSelected?: boolean;
  isDraggable?: boolean;
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
}

// Individual card component — memoized to avoid re-rendering cards that haven't changed
export const GameCardNode = memo(function GameCardNode({
  card,
  x,
  y,
  rotation,
  cardWidth,
  cardHeight,
  image,
  isSelected,
  isDraggable = true,
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
}: GameCardNodeProps) {
  const isToken = card.isToken;
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
      draggable={isDraggable}
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
      onTouchStart={(e) => onMouseEnter(card, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
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
        {/* Token or regular card rendering */}
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

        {/* Token overlay — dashed border + badge to distinguish from player's cards */}
        {isToken && (
          <>
            <Rect
              width={cardWidth}
              height={cardHeight}
              fill="transparent"
              stroke="#c4955a"
              strokeWidth={1.5}
              cornerRadius={4}
              dash={[5, 3]}
            />
            {/* "TOKEN" badge at bottom */}
            <Rect
              x={cardWidth * 0.1}
              y={cardHeight - Math.max(14, cardHeight * 0.1)}
              width={cardWidth * 0.8}
              height={Math.max(12, cardHeight * 0.08)}
              fill="rgba(26,21,16,0.85)"
              cornerRadius={2}
            />
            <Text
              x={cardWidth * 0.1}
              y={cardHeight - Math.max(14, cardHeight * 0.1)}
              width={cardWidth * 0.8}
              height={Math.max(12, cardHeight * 0.08)}
              text="TOKEN"
              fontSize={Math.max(6, Math.min(9, cardWidth * 0.1))}
              fontFamily="Cinzel, Georgia, serif"
              fill="#c4955a"
              align="center"
              verticalAlign="middle"
              letterSpacing={2}
            />
          </>
        )}

        {/* Counter badges — top-right corner, stacked vertically */}
        {card.counters.map((counter, idx) => {
          const colorDef = COUNTER_COLORS.find(c => c.id === counter.color);
          const r = 12;
          return (
            <Group key={counter.color} x={cardWidth - 14} y={14 + idx * 28}>
              <Circle radius={r} fill="rgba(0,0,0,0.6)" />
              <Circle radius={r - 2} fill={colorDef?.hex ?? '#8b1a1a'} stroke="rgba(0,0,0,0.8)" strokeWidth={2} />
              <Text
                text={String(counter.count)}
                fontSize={13}
                fill="white"
                fontStyle="bold"
                width={r * 2}
                height={r * 2}
                align="center"
                verticalAlign="middle"
                offsetX={r}
                offsetY={r}
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
