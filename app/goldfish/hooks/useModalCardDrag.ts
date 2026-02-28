'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type Konva from 'konva';
import { GameCard, ZoneId } from '../types';
import type { ZoneRect } from '../layout/zoneLayout';

export interface ModalDragState {
  isDragging: boolean;
  card: GameCard | null;
  imageUrl: string;
  // Initial cursor position so ghost can be positioned on first render
  initialX: number;
  initialY: number;
}

interface UseModalCardDragOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  zoneLayout: Partial<Record<ZoneId, ZoneRect>>;
  findZoneAtPosition: (x: number, y: number) => ZoneId | null;
  moveCard: (instanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number) => void;
  onDeckDrop?: (cardInstanceId: string, screenX: number, screenY: number) => void;
  cardWidth: number;
  cardHeight: number;
}

export function useModalCardDrag({
  stageRef,
  zoneLayout,
  findZoneAtPosition,
  moveCard,
  onDeckDrop,
  cardWidth,
  cardHeight,
}: UseModalCardDragOptions) {
  const [dragState, setDragState] = useState<ModalDragState>({
    isDragging: false,
    card: null,
    imageUrl: '',
    initialX: 0,
    initialY: 0,
  });
  const [hoveredZone, setHoveredZone] = useState<ZoneId | null>(null);

  const ghostRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef(dragState);
  dragRef.current = dragState;

  const pendingDrag = useRef<{
    card: GameCard;
    imageUrl: string;
    startX: number;
    startY: number;
  } | null>(null);

  const startDrag = useCallback((card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return; // left click only
    e.preventDefault(); // prevent native image drag from hijacking pointer events
    pendingDrag.current = {
      card,
      imageUrl,
      startX: e.clientX,
      startY: e.clientY,
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
          // Commit to drag — store initial position for ghost placement
          setDragState({
            isDragging: true,
            card: pendingDrag.current.card,
            imageUrl: pendingDrag.current.imageUrl,
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
            const card = dragRef.current.card;
            if (targetZone === 'deck' && onDeckDrop) {
              onDeckDrop(card.instanceId, e.clientX, e.clientY);
            } else if (targetZone === 'territory') {
              moveCard(card.instanceId, targetZone, undefined, canvasX - cardWidth / 2, canvasY - cardHeight / 2);
            } else {
              moveCard(card.instanceId, targetZone);
            }
          }
        }
      }

      // Reset
      pendingDrag.current = null;
      setDragState({ isDragging: false, card: null, imageUrl: '', initialX: 0, initialY: 0 });
      setHoveredZone(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [stageRef, findZoneAtPosition, moveCard, onDeckDrop, cardWidth, cardHeight]);

  return { dragState, startDrag, hoveredZone, ghostRef };
}
