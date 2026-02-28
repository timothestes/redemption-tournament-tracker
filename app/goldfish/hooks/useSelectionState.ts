import { useState, useCallback, useRef } from 'react';

export interface CardBound {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface SelectionRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// For small rotations, compute the AABB of a rotated rectangle
function getRotatedAABB(x: number, y: number, w: number, h: number, rotation: number) {
  if (rotation === 0) return { x, y, w, h };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const cx = x + w / 2;
  const cy = y + h / 2;
  const newW = w * cos + h * sin;
  const newH = w * sin + h * cos;
  return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function computeHitIds(
  rect: SelectionRect,
  allCardBounds: CardBound[],
  baseSelection: Set<string>,
  shiftKey: boolean,
): Set<string> {
  const sx = Math.min(rect.startX, rect.currentX);
  const sy = Math.min(rect.startY, rect.currentY);
  const sw = Math.abs(rect.currentX - rect.startX);
  const sh = Math.abs(rect.currentY - rect.startY);

  if (sw < 5 && sh < 5) {
    return shiftKey ? new Set(baseSelection) : new Set();
  }

  const result = shiftKey ? new Set(baseSelection) : new Set<string>();
  for (const bound of allCardBounds) {
    const aabb = getRotatedAABB(bound.x, bound.y, bound.width, bound.height, bound.rotation);
    if (rectsOverlap(sx, sy, sw, sh, aabb.x, aabb.y, aabb.w, aabb.h)) {
      result.add(bound.instanceId);
    }
  }
  return result;
}

export function useSelectionState() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectingRef = useRef(false);
  const baseSelectionRef = useRef<Set<string>>(new Set());
  // Throttle: track pending RAF and latest mouse position
  const rafRef = useRef<number | null>(null);
  const pendingUpdate = useRef<{ x: number; y: number; bounds: CardBound[]; shiftKey: boolean } | null>(null);
  const lastHitIdsRef = useRef<Set<string>>(new Set());
  // Keep a mutable ref of the current rect
  const rectRef = useRef<SelectionRect | null>(null);
  // Callback for imperatively updating the visual rect (set by the canvas)
  const onRectChangeRef = useRef<((rect: SelectionRect | null) => void) | null>(null);

  const isSelected = useCallback(
    (instanceId: string) => selectedIds.has(instanceId),
    [selectedIds]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastHitIdsRef.current = new Set();
  }, []);

  const toggleSelect = useCallback((instanceId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }, []);

  const selectCards = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const startSelectionDrag = useCallback((x: number, y: number, shiftKey?: boolean) => {
    isSelectingRef.current = true;
    baseSelectionRef.current = shiftKey ? new Set(selectedIds) : new Set();
    lastHitIdsRef.current = shiftKey ? new Set(selectedIds) : new Set();
    const rect = { startX: x, startY: y, currentX: x, currentY: y };
    rectRef.current = rect;
    onRectChangeRef.current?.(rect);
  }, [selectedIds]);

  const flushSelectionUpdate = useCallback(() => {
    rafRef.current = null;
    const update = pendingUpdate.current;
    if (!update) return;
    pendingUpdate.current = null;

    const rect = rectRef.current;
    if (!rect) return;

    // Update rect position
    const updated = { ...rect, currentX: update.x, currentY: update.y };
    rectRef.current = updated;
    // Imperatively update the visual rect — no React re-render
    onRectChangeRef.current?.(updated);

    // Compute new hit set — only update the ref during drag (no React re-render)
    const newHits = computeHitIds(updated, update.bounds, baseSelectionRef.current, update.shiftKey);
    if (!setsEqual(newHits, lastHitIdsRef.current)) {
      lastHitIdsRef.current = newHits;
    }
  }, []);

  const updateSelectionDrag = useCallback((x: number, y: number, allCardBounds?: CardBound[], shiftKey?: boolean) => {
    if (!isSelectingRef.current) return;
    if (!allCardBounds) return;

    // Store the latest position; RAF will pick up the most recent one
    pendingUpdate.current = { x, y, bounds: allCardBounds, shiftKey: !!shiftKey };

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushSelectionUpdate);
    }
  }, [flushSelectionUpdate]);

  const endSelectionDrag = useCallback((shiftKey?: boolean): { wasClick: boolean; selectedCount: number } => {
    isSelectingRef.current = false;

    // Cancel any pending RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Flush any pending update synchronously (compute final hit set)
    const update = pendingUpdate.current;
    if (update && rectRef.current) {
      const updated = { ...rectRef.current, currentX: update.x, currentY: update.y };
      rectRef.current = updated;
      const newHits = computeHitIds(updated, update.bounds, baseSelectionRef.current, !!shiftKey);
      lastHitIdsRef.current = newHits;
    }
    pendingUpdate.current = null;

    let wasClick = false;
    const rect = rectRef.current;
    if (rect) {
      const sw = Math.abs(rect.currentX - rect.startX);
      const sh = Math.abs(rect.currentY - rect.startY);
      if (sw < 5 && sh < 5) {
        wasClick = true;
        if (!shiftKey) {
          lastHitIdsRef.current = new Set();
        }
      }
    }

    // Apply the final selection to React state in one batch
    setSelectedIds(new Set(lastHitIdsRef.current));

    const selectedCount = wasClick ? 0 : lastHitIdsRef.current.size;

    rectRef.current = null;
    // Hide the visual rect
    onRectChangeRef.current?.(null);

    return { wasClick, selectedCount };
  }, []);

  return {
    selectedIds,
    isSelected,
    isSelectingRef,
    onRectChangeRef,
    startSelectionDrag,
    updateSelectionDrag,
    endSelectionDrag,
    toggleSelect,
    clearSelection,
    selectCards,
  };
}
