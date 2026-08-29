'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  defaultCamera, clampCamera, fitRectToViewport, zoomAtPoint,
  MIN_ZOOM, type Camera, type Rect, type FitOptions,
} from '@/app/shared/layout/camera';
import {
  classifyGesture, pinchMetrics, pinchZoomDelta, type PointerSample,
} from '@/app/play/lib/gestureCore';

interface UseBoardCameraArgs {
  fitScale: number;
  virtualWidth: number;
  containerWidth: number;
  containerHeight: number;
  /** Camera is touch-only; on pointer devices it stays null so the transform
   *  is bit-identical to today's. */
  enabled: boolean;
}

export function useBoardCamera({
  fitScale, virtualWidth, containerWidth, containerHeight, enabled,
}: UseBoardCameraArgs) {
  const [camera, setCameraRaw] = useState<Camera>(() => defaultCamera(virtualWidth));

  // Re-centre when the virtual width changes (rotation, resize) but only while
  // at rest, so a resize mid-zoom doesn't yank the player's view.
  useEffect(() => {
    setCameraRaw((c) => (c.zoom === MIN_ZOOM ? defaultCamera(virtualWidth) : c));
  }, [virtualWidth]);

  const setCamera = useCallback((next: Camera) => {
    if (fitScale <= 0) return;
    setCameraRaw(clampCamera(next, fitScale, virtualWidth, containerWidth, containerHeight));
  }, [fitScale, virtualWidth, containerWidth, containerHeight]);

  const jumpTo = useCallback((rect: Rect, opts?: FitOptions) => {
    if (fitScale <= 0) return;
    setCameraRaw(fitRectToViewport(rect, fitScale, virtualWidth, containerWidth, containerHeight, opts));
  }, [fitScale, virtualWidth, containerWidth, containerHeight]);

  const reset = useCallback(() => {
    setCameraRaw(defaultCamera(virtualWidth));
  }, [virtualWidth]);

  // ── Gesture state ────────────────────────────────────────────────────
  const gestureRef = useRef<{
    kind: 'none' | 'pan' | 'pinch';
    startCamera: Camera;
    startDistance: number;
    lastX: number;
    lastY: number;
  }>({ kind: 'none', startCamera: camera, startDistance: 0, lastX: 0, lastY: 0 });

  /** Feed the currently active pointers (container-relative screen coords). */
  const onPointersChange = useCallback((pointers: PointerSample[]) => {
    if (!enabled || fitScale <= 0) return;
    const kind = classifyGesture(pointers);
    const g = gestureRef.current;
    const scale = fitScale * camera.zoom;

    if (kind === 'none') {
      g.kind = 'none';
      return;
    }

    if (kind === 'pan') {
      const p = pointers[0];
      if (g.kind !== 'pan') {
        g.kind = 'pan';
        g.startCamera = camera;
        g.lastX = p.x;
        g.lastY = p.y;
        return;
      }
      const dx = (p.x - g.lastX) / scale;
      const dy = (p.y - g.lastY) / scale;
      g.lastX = p.x;
      g.lastY = p.y;
      setCamera({ ...camera, centerX: camera.centerX - dx, centerY: camera.centerY - dy });
      return;
    }

    // pinch
    const [a, b] = pointers;
    const m = pinchMetrics(a, b);
    if (g.kind !== 'pinch') {
      g.kind = 'pinch';
      g.startCamera = camera;
      g.startDistance = m.distance;
      return;
    }
    const factor = pinchZoomDelta(g.startDistance, m.distance);
    const nextZoom = g.startCamera.zoom * factor;
    // Anchor on the pinch midpoint, converted to virtual space.
    const anchorVX = camera.centerX + (m.midX - containerWidth / 2) / scale;
    const anchorVY = camera.centerY + (m.midY - containerHeight / 2) / scale;
    setCamera(zoomAtPoint(camera, nextZoom, anchorVX, anchorVY));
  }, [enabled, fitScale, camera, containerWidth, containerHeight, setCamera]);

  const isZoomed = useMemo(() => camera.zoom > MIN_ZOOM + 1e-6, [camera.zoom]);

  return {
    camera: enabled ? camera : null,
    setCamera, jumpTo, reset, onPointersChange, isZoomed,
  };
}
