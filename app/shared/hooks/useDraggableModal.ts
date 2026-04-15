'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface DraggableModalReturn {
  /** Current translate offset for the modal container */
  offset: { x: number; y: number };
  /** Whether the modal is currently being dragged */
  isDraggingModal: boolean;
  /** Props to spread onto the drag handle (header bar) */
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** Style to apply on the modal container (transform) */
  modalStyle: React.CSSProperties;
}

/**
 * Hook that makes a modal draggable by its header/title bar.
 *
 * Usage:
 *   const { dragHandleProps, modalStyle } = useDraggableModal();
 *   <div style={{ ...existingContainerStyle, ...modalStyle }}>
 *     <div {...dragHandleProps} style={{ ...existingHeaderStyle, ...dragHandleProps.style }}>
 *       ...title, close button...
 *     </div>
 *   </div>
 */
export function useDraggableModal(): DraggableModalReturn {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  // Keep a ref to the latest offset so the pointerdown handler doesn't go stale
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag on primary button
    if (e.button !== 0) return;
    // Don't drag if the target is a button or interactive element within the header
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.tagName.toLowerCase() === 'button') return;

    isDragging.current = true;
    setIsDraggingModal(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { x: offsetRef.current.x, y: offsetRef.current.y };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;

      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      setOffset({
        x: offsetStart.current.x + dx,
        y: offsetStart.current.y + dy,
      });
    };

    const onPointerUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setIsDraggingModal(false);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const dragHandleProps = {
    onPointerDown,
    style: {
      cursor: isDraggingModal ? 'grabbing' : 'grab',
    } as React.CSSProperties,
  };

  const modalStyle: React.CSSProperties = {
    transform: `translate(${offset.x}px, ${offset.y}px)`,
  };

  return { offset, isDraggingModal, dragHandleProps, modalStyle };
}
