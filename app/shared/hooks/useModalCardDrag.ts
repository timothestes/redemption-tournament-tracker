'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type Konva from 'konva';
import { GameCard, ZoneId } from '@/app/shared/types/gameCard';
import type { ZoneRect } from '@/app/goldfish/layout/zoneLayout';

export interface ModalDragState {
  isDragging: boolean;
  card: GameCard | null;
  imageUrl: string;
  // Additional cards being dragged (multi-card). Empty for single-card drag.
  additionalCards: { card: GameCard; imageUrl: string }[];
  // Initial cursor position so ghost can be positioned on first render
  initialX: number;
  initialY: number;
}

interface UseModalCardDragOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  zoneLayout: Partial<Record<ZoneId, ZoneRect>>;
  findZoneAtPosition: (x: number, y: number) => ZoneId | null;
  moveCard: (instanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number) => void;
  moveCardsBatch: (cardInstanceIds: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => void;
  onDeckDrop?: (cardInstanceId: string, screenX: number, screenY: number) => void;
  onBatchDeckDrop?: (cardInstanceIds: string[]) => void;
  cardWidth: number;
  cardHeight: number;
}

const INITIAL_STATE: ModalDragState = {
  isDragging: false,
  card: null,
  imageUrl: '',
  additionalCards: [],
  initialX: 0,
  initialY: 0,
};

export function useModalCardDrag({
  stageRef,
  zoneLayout,
  findZoneAtPosition,
  moveCard,
  moveCardsBatch,
  onDeckDrop,
  onBatchDeckDrop,
  cardWidth,
  cardHeight,
}: UseModalCardDragOptions) {
  const [dragState, setDragState] = useState<ModalDragState>(INITIAL_STATE);
  const [hoveredZone, setHoveredZone] = useState<ZoneId | null>(null);

  const ghostRef = useRef<HTMLElement>(null);
  const dragRef = useRef(dragState);
  dragRef.current = dragState;

  // Tracks whether a drag was committed (threshold met) so callers can distinguish click vs drag
  const didDragRef = useRef(false);

  const pendingDrag = useRef<{
    card: GameCard;
    imageUrl: string;
    startX: number;
    startY: number;
    additionalCards: { card: GameCard; imageUrl: string }[];
  } | null>(null);

  const startDrag = useCallback((card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pendingDrag.current = {
      card,
      imageUrl,
      startX: e.clientX,
      startY: e.clientY,
      additionalCards: [],
    };
  }, []);

  const startMultiDrag = useCallback((cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => {
    if (e.button !== 0 || cards.length === 0) return;
    e.preventDefault();
    const [primary, ...rest] = cards;
    pendingDrag.current = {
      card: primary.card,
      imageUrl: primary.imageUrl,
      startX: e.clientX,
      startY: e.clientY,
      additionalCards: rest,
    };
  }, []);

  // Position ghost on mount via callback ref effect
  useEffect(() => {
    if (dragState.isDragging && ghostRef.current) {
      ghostRef.current.style.left = `${dragState.initialX - 40}px`;
      ghostRef.current.style.top = `${dragState.initialY - 56}px`;
    }
  }, [dragState.isDragging, dragState.initialX, dragState.initialY]);

  // Attach global listeners
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Check pending drag threshold
      if (pendingDrag.current && !dragRef.current.isDragging) {
        const dx = e.clientX - pendingDrag.current.startX;
        const dy = e.clientY - pendingDrag.current.startY;
        if (Math.abs(dx) + Math.abs(dy) > 5) {
          didDragRef.current = true;
          // Commit to drag — store initial position for ghost placement
          setDragState({
            isDragging: true,
            card: pendingDrag.current.card,
            imageUrl: pendingDrag.current.imageUrl,
            additionalCards: pendingDrag.current.additionalCards,
            initialX: e.clientX,
            initialY: e.clientY,
          });
        }
        return;
      }

      // Active drag — update ghost position via DOM ref (no re-render)
      if (dragRef.current.isDragging) {
        if (ghostRef.current) {
          ghostRef.current.style.left = `${e.clientX - 40}px`;
          ghostRef.current.style.top = `${e.clientY - 56}px`;
        }

        // Update hovered zone
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          const canvasX = e.clientX - rect.left;
          const canvasY = e.clientY - rect.top;
          const zone = findZoneAtPosition(canvasX, canvasY);
          setHoveredZone(zone);
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      // If pending but threshold not met, just clear (click will handle it)
      if (pendingDrag.current && !dragRef.current.isDragging) {
        pendingDrag.current = null;
        return;
      }

      // Active drag — check drop target
      if (dragRef.current.isDragging && dragRef.current.card) {
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          const canvasX = e.clientX - rect.left;
          const canvasY = e.clientY - rect.top;
          const targetZone = findZoneAtPosition(canvasX, canvasY);

          if (targetZone) {
            const primary = dragRef.current.card;
            const additional = dragRef.current.additionalCards;
            const isMulti = additional.length > 0;
            const allIds = isMulti
              ? [primary.instanceId, ...additional.map(c => c.card.instanceId)]
              : [primary.instanceId];

            if (targetZone === 'deck') {
              if (isMulti && onBatchDeckDrop) {
                onBatchDeckDrop(allIds);
              }
              if (onDeckDrop) {
                onDeckDrop(primary.instanceId, e.clientX, e.clientY);
              }
            } else if (targetZone === 'territory' || targetZone === 'land-of-bondage') {
              if (isMulti) {
                const baseX = canvasX - cardWidth / 2;
                const baseY = canvasY - cardHeight / 2;
                const FAN_OFFSET = 20;
                const positions: Record<string, { posX: number; posY: number }> = {};
                allIds.forEach((id, i) => {
                  positions[id] = { posX: baseX + i * FAN_OFFSET, posY: baseY };
                });
                moveCardsBatch(allIds, targetZone, positions);
              } else {
                moveCard(primary.instanceId, targetZone, undefined, canvasX - cardWidth / 2, canvasY - cardHeight / 2);
              }
            } else {
              if (isMulti) {
                moveCardsBatch(allIds, targetZone);
              } else {
                moveCard(primary.instanceId, targetZone);
              }
            }
          }
        }
      }

      // Reset
      pendingDrag.current = null;
      setDragState(INITIAL_STATE);
      setHoveredZone(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [stageRef, findZoneAtPosition, moveCard, moveCardsBatch, onDeckDrop, onBatchDeckDrop, cardWidth, cardHeight]);

  return { dragState, startDrag, startMultiDrag, hoveredZone, ghostRef, didDragRef };
}
