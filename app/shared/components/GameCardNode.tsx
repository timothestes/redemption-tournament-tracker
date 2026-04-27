'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Group, Rect, Image as KonvaImage, Circle, Text, Arc } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
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
  /** When true, plays a one-shot amber pulse glow: a brief fade-in + bloom,
   *  followed by a longer fade-out. Total duration ~1.8s. */
  lobArrivalGlow?: boolean;
  /** When true, suppress the per-card reveal countdown ring. Used when
   *  rendering the local viewer's own hand — the ring is meant for the
   *  receiving party (opponent), not the holder. */
  suppressRevealRing?: boolean;
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
  lobArrivalGlow,
  suppressRevealRing,
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
  const isActivelyRevealed =
    typeof card.revealUntil === 'number' && card.revealUntil > Date.now();
  // A per-card reveal temporarily shows the face even when the card would
  // otherwise render face-down (opponent hand view).
  const showFace = (!card.isFlipped || isActivelyRevealed) && image;
  const [isDragging, setIsDragging] = useState(false);

  // Ref for the LOB arrival glow rect — used to run an imperative Konva Tween
  const arrivalGlowRef = useRef<Konva.Rect | null>(null);

  useEffect(() => {
    const node = arrivalGlowRef.current;
    if (!node) return;

    if (lobArrivalGlow) {
      // Phase 1: bloom in — quick fade-up with stroke expansion.
      // Phase 2: settle + fade out — longer, stroke softens back.
      // Stroke width range matches the hover highlight (1.5 → 3).
      node.opacity(0);
      node.strokeWidth(1.5);
      node.visible(true);

      let fade: Konva.Tween | null = null;
      const bloom = new KonvaLib.Tween({
        node,
        duration: 0.22,
        opacity: 1,
        strokeWidth: 3,
        easing: KonvaLib.Easings.EaseOut,
        onFinish: () => {
          fade = new KonvaLib.Tween({
            node,
            duration: 1.55,
            opacity: 0,
            strokeWidth: 1.5,
            easing: KonvaLib.Easings.EaseOut,
            onFinish: () => {
              node.visible(false);
            },
          });
          fade.play();
        },
      });
      bloom.play();

      return () => {
        bloom.destroy();
        fade?.destroy();
      };
    } else {
      node.visible(false);
      node.opacity(0);
    }
  }, [lobArrivalGlow]);

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
      onMouseDown={(e) => {
        // macOS Ctrl+click fires mousedown with button=0 + ctrlKey=true, which
        // Konva's draggable shapes consume as a left-press and call
        // preventDefault on — suppressing the subsequent `contextmenu` event
        // that macOS would otherwise emit. Route the click through onContextMenu
        // manually and cancel the pending drag so no ghost drag state lingers.
        if (e.evt.ctrlKey && e.evt.button === 0) {
          const node: any = e.target;
          if (node && typeof node.stopDrag === 'function') node.stopDrag();
          onContextMenu(card, e as unknown as Konva.KonvaEventObject<PointerEvent>);
          e.cancelBubble = true;
        }
      }}
      onDragStart={() => { setIsDragging(true); onDragStart(card); }}
      onDragMove={onDragMove}
      onDragEnd={(e) => { setIsDragging(false); onDragEnd(card, e); }}
      onContextMenu={(e) => onContextMenu(card, e)}
      onClick={onClick ? (e) => onClick(card, e) : undefined}
      onTap={onClick ? (e) => onClick(card, e as unknown as Konva.KonvaEventObject<MouseEvent>) : undefined}
      onDblClick={() => onDblClick(card)}
      onDblTap={() => onDblClick(card)}
      onMouseEnter={(e) => onMouseEnter(card, e)}
      onMouseLeave={onMouseLeave}
      onTouchStart={(e) => onMouseEnter(card, e as unknown as Konva.KonvaEventObject<MouseEvent>)}
    >
      {/* LOB arrival glow — amber stroke pulse on arrival.
          opacity + strokeWidth are animated imperatively in the effect above.
          Shadow blur was removed for perf — canvas shadowBlur forces per-pixel
          Gaussian blur every frame and was the dominant cost during arrivals. */}
      <Rect
        ref={arrivalGlowRef as any}
        x={-1}
        y={-1}
        width={cardWidth + 2}
        height={cardHeight + 2}
        fill="transparent"
        stroke="#e8b86a"
        strokeWidth={1.5}
        cornerRadius={6}
        visible={false}
        opacity={0}
        listening={false}
      />

      {/* Card outline marker — Three Woes "Choose Good"/"Choose Evil".
          Visible to all players; gated to Territory at render time as a
          defense-in-depth (the reducers also clear it on territory exit). */}
      {card.outlineColor && card.zone === 'territory' && (
        <Rect
          x={-2}
          y={-2}
          width={cardWidth + 4}
          height={cardHeight + 4}
          fill="transparent"
          stroke={card.outlineColor === 'good' ? '#22c55e' : '#dc2626'}
          strokeWidth={3}
          cornerRadius={6}
          shadowColor={card.outlineColor === 'good' ? '#22c55e' : '#dc2626'}
          shadowBlur={10}
          shadowOpacity={0.55}
          listening={false}
        />
      )}

      {/* Selection highlight — golden glow border */}
      {isSelected && (
        <Rect
          x={-1}
          y={-1}
          width={cardWidth + 2}
          height={cardHeight + 2}
          fill="transparent"
          stroke="#c4955a"
          strokeWidth={2}
          cornerRadius={5}
          shadowColor="#c4955a"
          shadowBlur={8}
          shadowOpacity={0.6}
          listening={false}
        />
      )}

      {/* Hover highlight — warm golden glow that intensifies over time */}
      {hoverProgress != null && hoverProgress > 0 && !isSelected && (
        <Rect
          x={-1}
          y={-1}
          width={cardWidth + 2}
          height={cardHeight + 2}
          fill="transparent"
          stroke={`rgba(224, 180, 100, ${0.3 + hoverProgress * 0.5})`}
          strokeWidth={1.5 + hoverProgress * 1.5}
          cornerRadius={6}
          shadowColor={`rgba(255, 215, 140, ${0.3 + hoverProgress * 0.5})`}
          shadowBlur={6 + hoverProgress * 14}
          shadowOpacity={0.4 + hoverProgress * 0.5}
          listening={false}
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

        {/* Banish-zone dim — subtle grey wash to signal out-of-play state.
            Rendered under counters/notes so those stay fully legible. */}
        {card.zone === 'banish' && showFace && (
          <Rect
            width={cardWidth}
            height={cardHeight}
            fill="rgba(30,30,35,0.4)"
            cornerRadius={4}
            listening={false}
          />
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

        {/* Per-card reveal progress ring — quiet circular countdown in the
            top-right corner. Sweeps from full circle down to empty over the
            reveal window. Auto-reveals (short, ≤15s) render smaller and more
            muted, and are suppressed entirely on the holder's own view. The
            manual 30s reveal stays visible everywhere — the holder triggered
            it deliberately and benefits from seeing it count down. */}
        {isActivelyRevealed && (() => {
          const DEFAULT_DURATION_MS = 30_000;
          const durationMs = card.revealDurationMs ?? DEFAULT_DURATION_MS;
          const isShortReveal = durationMs <= 15_000;
          if (isShortReveal && suppressRevealRing) return null;
          const remainingMs = Math.max(0, card.revealUntil! - Date.now());
          const remainingFrac = Math.min(1, remainingMs / Math.max(durationMs, 1));
          const outerRadius = isShortReveal ? 7 : 10;
          const innerRadius = isShortReveal ? 4 : 6;
          const cx = cardWidth - outerRadius - 4;
          const cy = outerRadius + 4;
          const arcColor = isShortReveal ? 'rgba(242,201,76,0.7)' : '#f2c94c';
          const backdropAlpha = isShortReveal ? 0.65 : 0.85;
          return (
            <Group x={cx} y={cy} listening={false}>
              {/* Solid dark backdrop — ensures the ring reads against any
                  card art, not just dark areas. */}
              <Circle radius={outerRadius + 1} fill={`rgba(0,0,0,${backdropAlpha})`} />
              {/* Empty-track ring — shows remaining shape after the arc sweeps past */}
              <Arc
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                angle={360}
                rotation={-90}
                fill="rgba(40,40,40,0.95)"
              />
              {/* Remaining time arc — amber, sweeps clockwise */}
              <Arc
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                angle={360 * remainingFrac}
                rotation={-90}
                fill={arcColor}
              />
            </Group>
          );
        })()}

        {/* Note text pill — bottom of card, hidden during drag */}
        {card.notes && !isDragging && (() => {
          const pillHeight = Math.max(14, cardHeight * 0.1);
          const pillX = cardWidth * 0.06;
          const pillY = cardHeight - pillHeight - cardHeight * 0.04;
          const pillWidth = cardWidth - pillX * 2;
          const fontSize = Math.max(9, Math.round(cardHeight * 0.065));
          return (
            <Group listening={false}>
              <Rect
                x={pillX}
                y={pillY}
                width={pillWidth}
                height={pillHeight}
                cornerRadius={pillHeight / 2}
                fill="rgba(0, 0, 0, 0.78)"
                stroke="#c4955a"
                strokeWidth={1}
              />
              <Text
                x={pillX}
                y={pillY}
                width={pillWidth}
                height={pillHeight}
                text={card.notes}
                fontSize={fontSize}
                fill="#f0d9a8"
                fontStyle="bold"
                align="center"
                verticalAlign="middle"
                padding={4}
                ellipsis
                wrap="none"
              />
            </Group>
          );
        })()}
      </Group>
    </Group>
  );
});
