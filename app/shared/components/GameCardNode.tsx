'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Group, Rect, Image as KonvaImage, Circle, Text, Arc, Path } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { GameCard, COUNTER_COLORS } from '../../goldfish/types';
import { findCard } from '@/lib/cards/lookup';
import {
  LONG_PRESS_MS, LONG_PRESS_MOVE_TOLERANCE, LONG_PRESS_DISMISS_TRAVEL, TOUCH_DRAG_DISTANCE,
} from '@/app/play/lib/longPressCore';
import { simplifyLostSoulName } from '@/lib/cards/cardAbilities';
import { useCardPreview } from '../../goldfish/state/CardPreviewContext';

const IMITATE_LABEL_HEIGHT = 18;

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
        perfectDrawEnabled={false}
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
      perfectDrawEnabled={false}
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
  /** When true, render the card at reduced opacity (used during targeting). */
  isDimmed?: boolean;
  /** When set, the card is part of a targeting selection. `isEligible` controls
   *  whether the card is selectable; `onSelect` is called on click/tap. */
  targetingMode?: {
    isEligible: boolean;
    onSelect: () => void;
  };
  /** Touch equivalent of right-click. When supplied, a 500ms stationary press
   *  opens the context menu; the pending Konva drag is cancelled first so no
   *  ghost drag state lingers. Movement past the tolerance means "drag", and
   *  the long-press is abandoned. */
  onLongPress?: (card: GameCard, p: { x: number; y: number }) => void;
  /** Called when the player keeps moving after a long-press menu opened -
   *  they meant to drag, not to open a menu. Lets the caller dismiss it. */
  onLongPressCancel?: () => void;
  /** Touch tap-to-move: true while THIS card is the armed card. Renders a
   *  steady amber ring so the player can see which card the destination rail
   *  is about to move. */
  isArmed?: boolean;
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
  isDimmed,
  targetingMode,
  onLongPress,
  onLongPressCancel,
  isArmed,
}: GameCardNodeProps) {
  const isToken = card.isToken;
  const isActivelyRevealed =
    typeof card.revealUntil === 'number' && card.revealUntil > Date.now();
  // A per-card reveal temporarily shows the face even when the card would
  // otherwise render face-down (opponent hand view).
  const showFace = (!card.isFlipped || isActivelyRevealed) && image;
  const [isDragging, setIsDragging] = useState(false);

  // ---- Long-press -> context menu (touch equivalent of right-click) ----
  const pressRef = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Once the menu opens it covers the board as a bottom sheet, so the finger
  // that opened it is usually OVER THE SHEET, not over this node - the node's
  // own touchmove stops arriving exactly when the "they meant to drag"
  // dismissal needs it. A document listener sees the whole press either way.
  const docMoveRef = useRef<((ev: TouchEvent) => void) | null>(null);

  const clearPress = useCallback(() => {
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (docMoveRef.current) {
      document.removeEventListener('touchmove', docMoveRef.current);
      docMoveRef.current = null;
    }
    pressRef.current = null;
  }, []);

  useEffect(() => clearPress, [clearPress]);

  // The touchend that ends a long-press still emits a Konva tap on this node
  // (taps have no duration ceiling), and by then clearPress() has wiped the
  // press state — so the tap re-fired onClick and, on touch, ARMED the card
  // right under the freshly opened menu. One-shot swallow.
  const longPressTapSwallowRef = useRef(false);

  const beginLongPress = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    if (!onLongPress) return;
    const t = e.evt.touches?.[0];
    if (!t) return;
    // A second finger means the user is pinching, not pressing.
    if (e.evt.touches.length > 1) { clearPress(); return; }
    clearPress();
    longPressTapSwallowRef.current = false;
    const origin = { x: t.clientX, y: t.clientY, fired: false };
    pressRef.current = origin;
    const onDocMove = (ev: TouchEvent) => {
      const st = pressRef.current;
      if (!st) return;
      if ((ev.touches?.length ?? 0) > 1) { clearPress(); return; }
      const touch = ev.touches?.[0];
      if (!touch) return;
      const travelled = Math.hypot(touch.clientX - st.x, touch.clientY - st.y);
      if (st.fired) {
        if (travelled > LONG_PRESS_DISMISS_TRAVEL) { clearPress(); onLongPressCancel?.(); }
        return;
      }
      if (travelled > LONG_PRESS_MOVE_TOLERANCE) clearPress();
    };
    docMoveRef.current = onDocMove;
    document.addEventListener('touchmove', onDocMove, { passive: true });
    pressTimerRef.current = setTimeout(() => {
      const s = pressRef.current;
      if (!s || s.fired) return;
      // A live Konva drag means the finger already committed to moving the
      // card; opening a menu on top of it cancels the drag mid-flight and
      // strands it. `dragDistance` on the Group below is set above
      // LONG_PRESS_MOVE_TOLERANCE so this should now be unreachable, but
      // Konva's default is 3px and a stale global would re-open the hole.
      const dragNode: any = e.target;
      if (dragNode && typeof dragNode.isDragging === 'function' && dragNode.isDragging()) {
        clearPress();
        return;
      }
      // Movement re-check at fire time. moveLongPress alone is not enough:
      // Konva suppresses stage pointer events while one of its drags is
      // live (Stage.js eventsEnabled), so once a drag starts inside the
      // 3-10px band this node's onTouchMove stops firing and a fast 50px
      // drag would still "long-press" at 500ms — cancelling the drag
      // mid-flight, opening the menu, and stranding the card. The stage
      // still calls setPointersPositions() on every touchmove even during
      // drags, so the live pointer is readable here.
      const pressStage = (e.target as Konva.Node).getStage?.();
      const livePos = pressStage?.getPointerPosition?.();
      if (pressStage && livePos) {
        const box = pressStage.container().getBoundingClientRect();
        const moved = Math.hypot(box.left + livePos.x - s.x, box.top + livePos.y - s.y);
        if (moved > LONG_PRESS_MOVE_TOLERANCE) {
          clearPress();
          return;
        }
      }
      s.fired = true;
      longPressTapSwallowRef.current = true;
      onLongPress(card, { x: s.x, y: s.y });
      // Deliberately NOT stopDrag(). With dragDistance above the movement
      // tolerance no drag can be running here (the guard above bails if one
      // somehow is), and Konva's armed drag element is what lets the gesture
      // still become a drag: a player who held to aim, got a menu they did
      // not want, and kept moving gets the card under their finger and the
      // menu dismissed (see the document listener above) instead of a dead
      // gesture they have to start over.
    }, LONG_PRESS_MS);
  }, [onLongPress, onLongPressCancel, card, clearPress]);

  const moveLongPress = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const s = pressRef.current;
    if (!s) return;
    // A second finger means a pinch, not a press. The stage cancels the card
    // drag when that happens but has no way to reach this node's timer, so a
    // stationary first finger would still open a menu 500ms into the pinch.
    if ((e.evt.touches?.length ?? 0) > 1) { clearPress(); return; }
    const t = e.evt.touches?.[0];
    if (!t) return;
    const moved = Math.hypot(t.clientX - s.x, t.clientY - s.y);
    if (s.fired) {
      // The menu is already up and the finger is still travelling: the player
      // was aiming a drag, not asking for a menu. Take it away rather than
      // leaving them to dismiss a menu they never wanted.
      if (moved > LONG_PRESS_DISMISS_TRAVEL) {
        clearPress();
        onLongPressCancel?.();
      }
      return;
    }
    // Radial tolerance, so a diagonal drag isn't accidentally tolerated.
    if (moved > LONG_PRESS_MOVE_TOLERANCE) {
      clearPress();
    }
  }, [clearPress, onLongPressCancel]);

  // Flip-preview eye: meek cards render upside-down on the table; hovering the
  // eye un-rotates them in the preview surfaces so the opponent can read them.
  const { setPreviewFlipped } = useCardPreview();
  const showFlipEye = card.isMeek && hoverProgress != null && hoverProgress > 0 && !isDragging;
  const [eyeHovered, setEyeHovered] = useState(false);

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

  // Rectangular hitFunc on the outer Group short-circuits Konva's per-pointermove
  // pixel-readback hit-test (getImageData) — the dominant cost during hover/drag.
  const cardHitFunc = useCallback((ctx: any, shape: Konva.Shape) => {
    ctx.beginPath();
    ctx.rect(0, 0, cardWidth, cardHeight);
    ctx.closePath();
    ctx.fillStrokeShape(shape);
  }, [cardWidth, cardHeight]);

  return (
    <Group
      ref={groupRefCb as any}
      x={x}
      y={y}
      rotation={rotation}
      draggable={isDraggable}
      // Touch only (onLongPress is passed on touch devices only). Konva's 3px
      // default lets a drag begin INSIDE the long-press movement tolerance,
      // and Konva suppresses shape-level touchmove once a drag is live
      // (Stage._pointermove returns early when Konva.isDragging()), so the
      // press stopped being cancellable exactly when it needed to be.
      // Requiring more travel than the tolerance makes the two mutually
      // exclusive by construction.
      dragDistance={onLongPress ? TOUCH_DRAG_DISTANCE : undefined}
      opacity={isDimmed ? 0.3 : 1}
      hitFunc={cardHitFunc as any}
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
      onDragStart={() => { clearPress(); setIsDragging(true); onDragStart(card); }}
      onDragMove={onDragMove}
      onDragEnd={(e) => { setIsDragging(false); onDragEnd(card, e); }}
      onContextMenu={(e) => onContextMenu(card, e)}
      onClick={(e) => {
        if (targetingMode) {
          e.cancelBubble = true;
          if (targetingMode.isEligible) targetingMode.onSelect();
          return;
        }
        if (onClick) onClick(card, e);
      }}
      onTap={(e) => {
        // The tail of a long-press is not a tap (see longPressTapSwallowRef).
        if (longPressTapSwallowRef.current) {
          longPressTapSwallowRef.current = false;
          e.cancelBubble = true;
          return;
        }
        if (targetingMode) {
          e.cancelBubble = true;
          if (targetingMode.isEligible) targetingMode.onSelect();
          return;
        }
        if (onClick) onClick(card, e as unknown as Konva.KonvaEventObject<MouseEvent>);
      }}
      onDblClick={() => onDblClick(card)}
      onDblTap={() => onDblClick(card)}
      onMouseEnter={(e) => onMouseEnter(card, e)}
      onMouseLeave={onMouseLeave}
      onTouchStart={(e) => {
        onMouseEnter(card, e as unknown as Konva.KonvaEventObject<MouseEvent>);
        beginLongPress(e);
      }}
      onTouchMove={moveLongPress}
      // onTouchStart raises the hover/preview state; without these the touch
      // path had no way to lower it again and the loupe stuck open.
      onTouchEnd={(e) => { clearPress(); onMouseLeave(); }}
      onTouchCancel={(e) => { clearPress(); onMouseLeave(); }}
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
        perfectDrawEnabled={false}
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
          perfectDrawEnabled={false}
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
          perfectDrawEnabled={false}
        />
      )}

      {/* Tap-to-move armed ring — steady amber marker for the card the
          destination rail is about to move (touch only; the canvas passes
          isArmed solely on touch). Thicker than the selection ring so it
          reads at phone card sizes. */}
      {isArmed && (
        <Rect
          x={-2}
          y={-2}
          width={cardWidth + 4}
          height={cardHeight + 4}
          fill="transparent"
          stroke="#c4955a"
          strokeWidth={3}
          cornerRadius={5}
          shadowColor="#c4955a"
          shadowBlur={8}
          shadowOpacity={0.7}
          listening={false}
          perfectDrawEnabled={false}
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
          perfectDrawEnabled={false}
        />
      )}

      {/* Inner group handles meek (180°) and sideways (90°, Two/Three Liner
          first-rescue marker) rotation around card center without affecting
          drag. Meek wins if both are somehow set. */}
      <Group
        rotation={card.isMeek ? 180 : card.isRotated ? 90 : 0}
        offsetX={card.isMeek || card.isRotated ? cardWidth / 2 : 0}
        offsetY={card.isMeek || card.isRotated ? cardHeight / 2 : 0}
        x={card.isMeek || card.isRotated ? cardWidth / 2 : 0}
        y={card.isMeek || card.isRotated ? cardHeight / 2 : 0}
      >
        {/* Token or regular card rendering */}
        {showFace ? (
          <KonvaImage
            image={image}
            width={cardWidth}
            height={cardHeight}
            cornerRadius={4}
            perfectDrawEnabled={false}
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
            perfectDrawEnabled={false}
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
              perfectDrawEnabled={false}
            />
            {/* "TOKEN" badge at bottom */}
            <Rect
              x={cardWidth * 0.1}
              y={cardHeight - Math.max(14, cardHeight * 0.1)}
              width={cardWidth * 0.8}
              height={Math.max(12, cardHeight * 0.08)}
              fill="rgba(26,21,16,0.85)"
              cornerRadius={2}
              perfectDrawEnabled={false}
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
              perfectDrawEnabled={false}
            />
          </>
        )}

        {/* Counter badges — top-right corner, stacked vertically */}
        {card.counters.map((counter, idx) => {
          const colorDef = COUNTER_COLORS.find(c => c.id === counter.color);
          const r = 12;
          return (
            <Group key={counter.color} x={cardWidth - 14} y={14 + idx * 28}>
              <Circle radius={r} fill="rgba(0,0,0,0.6)" perfectDrawEnabled={false} />
              <Circle radius={r - 2} fill={colorDef?.hex ?? '#8b1a1a'} stroke="rgba(0,0,0,0.8)" strokeWidth={2} perfectDrawEnabled={false} />
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
                perfectDrawEnabled={false}
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
              <Circle radius={outerRadius + 1} fill={`rgba(0,0,0,${backdropAlpha})`} perfectDrawEnabled={false} />
              {/* Empty-track ring — shows remaining shape after the arc sweeps past */}
              <Arc
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                angle={360}
                rotation={-90}
                fill="rgba(40,40,40,0.95)"
                perfectDrawEnabled={false}
              />
              {/* Remaining time arc — amber, sweeps clockwise */}
              <Arc
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                angle={360 * remainingFrac}
                rotation={-90}
                fill={arcColor}
                perfectDrawEnabled={false}
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
                perfectDrawEnabled={false}
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
                perfectDrawEnabled={false}
              />
            </Group>
          );
        })()}
      </Group>

      {/* Flip-preview eye — only visible while hovering a meek card. Hovering
          the eye sets the preview-flipped flag in CardPreviewContext, which the
          floating tooltip and loupe panel read to un-rotate the meek 180°.
          Rendered in the outer group so it sits visually top-right of the card
          regardless of the meek rotation applied to the inner group. */}
      {showFlipEye && (
        <Group
          x={cardWidth - 14}
          y={14}
          onMouseEnter={(e) => {
            const stage = e.target?.getStage?.();
            if (stage) stage.container().style.cursor = 'pointer';
            setEyeHovered(true);
            setPreviewFlipped(true);
          }}
          onMouseLeave={(e) => {
            const stage = e.target?.getStage?.();
            if (stage) stage.container().style.cursor = 'default';
            setEyeHovered(false);
            setPreviewFlipped(false);
          }}
          onMouseDown={(e) => {
            // Stop the click from initiating a card drag. Walk up to find the
            // draggable ancestor and cancel its pending drag.
            e.cancelBubble = true;
            let p: any = e.target?.getParent?.();
            while (p) {
              if (typeof p.draggable === 'function' && p.draggable()) {
                p.stopDrag?.();
                break;
              }
              p = p.getParent?.();
            }
          }}
          onClick={(e) => { e.cancelBubble = true; }}
          onContextMenu={(e) => { e.cancelBubble = true; e.evt?.preventDefault?.(); }}
        >
          {/* Larger transparent hit target so hover registers easily */}
          <Circle
            radius={16}
            fill="rgba(0,0,0,0.001)"
            perfectDrawEnabled={false}
          />
          <Circle
            radius={12}
            fill={eyeHovered ? 'rgba(40,28,12,0.95)' : 'rgba(0,0,0,0.78)'}
            stroke={eyeHovered ? '#e8d5a3' : 'rgba(232,213,163,0.5)'}
            strokeWidth={eyeHovered ? 1.5 : 1}
            perfectDrawEnabled={false}
            listening={false}
          />
          {/* ArrowDownUp (lucide) — two parallel arrows, one pointing down and
              one pointing up. Reads as "flip top-to-bottom" / vertical swap.
              Bbox is (3,4)→(21,20); centered on (12,12) via offset. */}
          <Path
            data="M3 16 L7 20 L11 16 M7 20 V4 M21 8 L17 4 L13 8 M17 4 V20"
            stroke="#e8d5a3"
            strokeWidth={2}
            strokeScaleEnabled={false}
            lineCap="round"
            lineJoin="round"
            fillEnabled={false}
            offsetX={12}
            offsetY={12}
            scaleX={15 / 24}
            scaleY={15 / 24}
            perfectDrawEnabled={false}
            listening={false}
          />
        </Group>
      )}

      {/* Imitate-name label overlay — only when the card has imitatingName AND
          no art swap occurred (cardImgFile still matches the canonical imgFile).
          Rendered in the top-level group so it never rotates with meek. */}
      {(() => {
        const showImitateLabel =
          !!card.imitatingName &&
          card.cardImgFile === findCard(card.cardName)?.imgFile;
        if (!showImitateLabel) return null;
        return (
          <>
            <Rect
              x={0}
              y={cardHeight - IMITATE_LABEL_HEIGHT}
              width={cardWidth}
              height={IMITATE_LABEL_HEIGHT}
              fill="rgba(0, 0, 0, 0.7)"
              listening={false}
              perfectDrawEnabled={false}
            />
            <Text
              x={0}
              y={cardHeight - IMITATE_LABEL_HEIGHT}
              width={cardWidth}
              height={IMITATE_LABEL_HEIGHT}
              text={simplifyLostSoulName(card.imitatingName!)}
              fill="#ffffff"
              fontSize={11}
              fontStyle="500"
              align="center"
              verticalAlign="middle"
              wrap="none"
              ellipsis
              listening={false}
              perfectDrawEnabled={false}
            />
          </>
        );
      })()}
    </Group>
  );
});
