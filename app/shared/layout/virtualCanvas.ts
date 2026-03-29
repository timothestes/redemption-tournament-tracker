'use client';

import { useState, useEffect, useMemo, type RefObject } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────
/** Virtual canvas height is always 1080. Width adapts to the container aspect ratio. */
export const VIRTUAL_HEIGHT = 1080;
/** Minimum virtual width (~4:3 aspect ratio). Narrower containers get letterboxed. */
export const MIN_VIRTUAL_WIDTH = 1440;
/** Maximum virtual width (~21:9 aspect ratio). Wider containers get letterboxed. */
export const MAX_VIRTUAL_WIDTH = 2560;
/** Reference width for standard 16:9 displays. */
export const VIRTUAL_WIDTH = 1920;

// ── Scaling ────────────────────────────────────────────────────────────────

export interface ScaleResult {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** The actual virtual canvas width for the current container aspect ratio. */
  virtualWidth: number;
}

/**
 * Compute a uniform scale factor, centering offsets, and adaptive virtual
 * width to fit the game board inside an arbitrary container.
 *
 * The virtual height is always 1080. The virtual width adapts to the
 * container's aspect ratio, clamped between 1440 (4:3) and 2560 (21:9).
 * Within this range there's zero letterboxing — the board fills the screen.
 * Outside the range, letterbox bars appear on the short axis.
 */
export function calculateScale(containerWidth: number, containerHeight: number): ScaleResult {
  if (containerWidth === 0 || containerHeight === 0) {
    return { scale: 0, offsetX: 0, offsetY: 0, virtualWidth: VIRTUAL_WIDTH };
  }

  const containerAR = containerWidth / containerHeight;
  const minAR = MIN_VIRTUAL_WIDTH / VIRTUAL_HEIGHT;
  const maxAR = MAX_VIRTUAL_WIDTH / VIRTUAL_HEIGHT;

  // Clamp the virtual width to the supported aspect ratio range
  const clampedAR = Math.max(minAR, Math.min(maxAR, containerAR));
  const virtualWidth = Math.round(VIRTUAL_HEIGHT * clampedAR);

  const scale = Math.min(containerWidth / virtualWidth, containerHeight / VIRTUAL_HEIGHT);
  const scaledWidth = virtualWidth * scale;
  const scaledHeight = VIRTUAL_HEIGHT * scale;

  return {
    scale,
    offsetX: (containerWidth - scaledWidth) / 2,
    offsetY: (containerHeight - scaledHeight) / 2,
    virtualWidth,
  };
}

// ── Coordinate transforms (for HTML overlays) ─────────────────────────────

/** Convert a point in virtual canvas space to screen (container-relative) pixels. */
export function virtualToScreen(
  vx: number, vy: number,
  scale: number, offsetX: number, offsetY: number,
): { x: number; y: number } {
  return { x: vx * scale + offsetX, y: vy * scale + offsetY };
}

/** Convert a screen (container-relative) pixel position to virtual canvas coords. */
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

/**
 * Observes a container div and returns the current scale/offset needed to
 * fit the virtual canvas inside it.
 */
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
