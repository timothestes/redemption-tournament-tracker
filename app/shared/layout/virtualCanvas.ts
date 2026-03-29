'use client';

import { useState, useEffect, useMemo, type RefObject } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────
export const VIRTUAL_WIDTH = 1920;
export const VIRTUAL_HEIGHT = 1080;
export const VIRTUAL_ASPECT_RATIO = VIRTUAL_WIDTH / VIRTUAL_HEIGHT;

// ── Scaling ────────────────────────────────────────────────────────────────

export interface ScaleResult {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function calculateScale(containerWidth: number, containerHeight: number): ScaleResult {
  const scale = Math.min(containerWidth / VIRTUAL_WIDTH, containerHeight / VIRTUAL_HEIGHT);
  const scaledWidth = VIRTUAL_WIDTH * scale;
  const scaledHeight = VIRTUAL_HEIGHT * scale;
  return {
    scale,
    offsetX: (containerWidth - scaledWidth) / 2,
    offsetY: (containerHeight - scaledHeight) / 2,
  };
}

// ── Coordinate transforms (for HTML overlays) ─────────────────────────────

export function virtualToScreen(
  vx: number, vy: number,
  scale: number, offsetX: number, offsetY: number,
): { x: number; y: number } {
  return { x: vx * scale + offsetX, y: vy * scale + offsetY };
}

export function screenToVirtual(
  sx: number, sy: number,
  scale: number, offsetX: number, offsetY: number,
): { x: number; y: number } {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

// ── React hook ─────────────────────────────────────────────────────────────

export interface VirtualCanvasState extends ScaleResult {
  containerWidth: number;
  containerHeight: number;
}

export function useVirtualCanvas(containerRef: RefObject<HTMLDivElement | null>): VirtualCanvasState {
  const [container, setContainer] = useState({ width: 0, height: 0 });

  // Re-run when the ref's DOM element appears (handles conditional rendering).
  // Poll containerRef.current until it's available, then attach ResizeObserver.
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let raf: number | null = null;

    const tryAttach = () => {
      const el = containerRef.current;
      if (!el) {
        // Element not yet in DOM — check again next frame
        raf = requestAnimationFrame(tryAttach);
        return;
      }
      const update = () => setContainer({ width: el.clientWidth, height: el.clientHeight });
      update();
      ro = new ResizeObserver(update);
      ro.observe(el);
    };

    tryAttach();

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [containerRef]);

  const scaling = useMemo(
    () => calculateScale(container.width, container.height),
    [container.width, container.height],
  );

  return { ...scaling, containerWidth: container.width, containerHeight: container.height };
}
