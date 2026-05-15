"use client";

import React from "react";

/**
 * MIME type used to encode card payloads for native HTML5 drag-and-drop from
 * the search-results column. The browser dispatches `dragstart`/`drop` events
 * separately from @dnd-kit's PointerSensor, so this bridge lets external drag
 * sources (search tiles) participate in the existing droppable zones without
 * lifting the @dnd-kit DndContext above the deck panel. See spec
 * `2026-05-15-card-search-dnd-progress-and-improvements.md` (P2 §4a).
 */
export const SEARCH_DRAG_MIME = "application/x-redemption-card";

export interface SearchDragPayload {
  name: string;
  set: string;
}

/**
 * Wires native HTML5 drop handlers (dragenter/dragover/dragleave/drop) to a
 * DOM node. Coexists with @dnd-kit because dnd-kit listens to PointerEvents,
 * not DragEvents — they don't fight.
 *
 * Use the returned `setRef` callback alongside dnd-kit's `setNodeRef` (combine
 * via a small helper). `isOver` is true while a payload of our MIME type is
 * hovering — use it to mirror dnd-kit's `isOver` ring/tint.
 */
export function useExternalDropTarget(
  onDrop: ((payload: SearchDragPayload) => void) | undefined,
) {
  const [isOver, setIsOver] = React.useState(false);
  const nodeRef = React.useRef<HTMLElement | null>(null);
  const onDropRef = React.useRef(onDrop);
  React.useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  // Counter approach handles dragenter/dragleave for nested children correctly:
  // dragenter fires once per descendant, dragleave fires when leaving each.
  // We only want isOver to flip false when the pointer truly leaves the node.
  const enterCountRef = React.useRef(0);

  const setRef = React.useCallback((node: HTMLElement | null) => {
    const prev = nodeRef.current;
    if (prev === node) return;
    if (prev) {
      prev.removeEventListener("dragenter", handleEnter);
      prev.removeEventListener("dragover", handleOver);
      prev.removeEventListener("dragleave", handleLeave);
      prev.removeEventListener("drop", handleDrop);
    }
    nodeRef.current = node;
    enterCountRef.current = 0;
    if (node) {
      node.addEventListener("dragenter", handleEnter);
      node.addEventListener("dragover", handleOver);
      node.addEventListener("dragleave", handleLeave);
      node.addEventListener("drop", handleDrop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable handlers — read from refs so they don't need to re-bind.
  const hasOurPayload = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(SEARCH_DRAG_MIME);

  function handleEnter(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    enterCountRef.current += 1;
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setIsOver(true);
  }
  function handleOver(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    e.preventDefault(); // required to allow `drop`
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function handleLeave(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    enterCountRef.current = Math.max(0, enterCountRef.current - 1);
    if (enterCountRef.current === 0) setIsOver(false);
  }
  function handleDrop(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    e.preventDefault();
    enterCountRef.current = 0;
    setIsOver(false);
    const raw = e.dataTransfer?.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as SearchDragPayload;
      if (payload && typeof payload.name === "string" && typeof payload.set === "string") {
        onDropRef.current?.(payload);
      }
    } catch {
      // Malformed payload — silently ignore.
    }
  }

  // Cleanup on unmount.
  React.useEffect(() => {
    return () => {
      const node = nodeRef.current;
      if (node) {
        node.removeEventListener("dragenter", handleEnter);
        node.removeEventListener("dragover", handleOver);
        node.removeEventListener("dragleave", handleLeave);
        node.removeEventListener("drop", handleDrop);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { setRef, isOver };
}

/**
 * Combine @dnd-kit's `setNodeRef` with this hook's `setRef` so a single DOM
 * node participates in both drag systems.
 */
export function combineRefs<T extends HTMLElement>(
  ...refs: Array<((node: T | null) => void) | React.MutableRefObject<T | null> | null | undefined>
): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}
