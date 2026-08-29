/**
 * Board camera — pan/zoom over the virtual canvas.
 *
 * The camera folds INTO the existing scale/offset triple rather than sitting
 * beside it. Every consumer (the Konva <Layer> transform and every HTML
 * overlay via virtualToScreen) already respects that triple, so the camera
 * propagates with no call-site changes.
 *
 * Critical invariant: at zoom 1 with the camera centred, composeCamera()
 * reduces algebraically to calculateScale()'s output, so desktop behaviour is
 * unchanged by construction. This is asserted in camera.test.ts.
 */

import { VIRTUAL_HEIGHT, type ScaleResult } from './virtualCanvas';

export interface Camera {
  zoom: number;
  /** Camera centre in VIRTUAL coordinates. */
  centerX: number;
  centerY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Never zoom out past fit — fit already letterboxes correctly. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export function defaultCamera(virtualWidth: number): Camera {
  return { zoom: 1, centerX: virtualWidth / 2, centerY: VIRTUAL_HEIGHT / 2 };
}

/**
 * Compose the fit transform with the camera.
 *
 *   scale'   = fitScale x zoom
 *   offsetX' = containerWidth/2  - centerX x scale'
 *   offsetY' = containerHeight/2 - centerY x scale'
 */
export function composeCamera(
  fit: ScaleResult,
  camera: Camera,
  containerWidth: number,
  containerHeight: number,
): ScaleResult {
  const scale = fit.scale * camera.zoom;
  return {
    scale,
    offsetX: containerWidth / 2 - camera.centerX * scale,
    offsetY: containerHeight / 2 - camera.centerY * scale,
    virtualWidth: fit.virtualWidth,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Clamp zoom into range and keep the board covering the viewport. When the
 * board is fully visible on an axis, the centre is pinned to the middle of
 * that axis so it stays letterboxed rather than drifting.
 */
export function clampCamera(
  camera: Camera,
  fitScale: number,
  virtualWidth: number,
  containerWidth: number,
  containerHeight: number,
): Camera {
  const zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = fitScale * zoom;

  const halfViewW = containerWidth / (2 * scale);
  const halfViewH = containerHeight / (2 * scale);

  const centerX = halfViewW >= virtualWidth / 2
    ? virtualWidth / 2
    : clamp(camera.centerX, halfViewW, virtualWidth - halfViewW);

  const centerY = halfViewH >= VIRTUAL_HEIGHT / 2
    ? VIRTUAL_HEIGHT / 2
    : clamp(camera.centerY, halfViewH, VIRTUAL_HEIGHT - halfViewH);

  return { zoom, centerX, centerY };
}

/** Smallest rect containing all inputs. Used to build "my side" / "opponent's
 *  side" jump targets from the individual zone rects. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface FitOptions {
  /**
   * 'both'   — the whole rect must fit on screen (whole-board fit).
   * 'height' — the rect fills the viewport vertically; horizontal overflow is
   *            expected and the player pans along it.
   *
   * 'height' exists because a player's "side" spans the full board width, so
   * contain-fitting one can never zoom in (width is always the binding
   * constraint at fit) and the jump would silently be a no-op. A side jump
   * means "fill the screen with this half of the board", which is a height fit.
   */
  axis?: 'both' | 'height';
  padding?: number;
}

/** Camera that frames `rect` in the viewport. */
export function fitRectToViewport(
  rect: Rect,
  fitScale: number,
  virtualWidth: number,
  containerWidth: number,
  containerHeight: number,
  opts: FitOptions = {},
): Camera {
  const { axis = 'both', padding = 1.06 } = opts;
  const needW = rect.width * padding;
  const needH = rect.height * padding;
  const scaleNeeded = axis === 'height'
    ? containerHeight / needH
    : Math.min(containerWidth / needW, containerHeight / needH);
  const zoom = scaleNeeded / fitScale;
  return clampCamera(
    { zoom, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 },
    fitScale, virtualWidth, containerWidth, containerHeight,
  );
}

/**
 * Change zoom while holding a virtual point stationary on screen — the
 * pinch-midpoint / double-tap anchor. Caller clamps afterwards.
 *
 * Screen position of the anchor is `(v - c) x s + viewportCentre`. Holding it
 * fixed across a zoom change gives: c' = v - (v - c) x z/z'.
 */
export function zoomAtPoint(
  camera: Camera,
  nextZoom: number,
  anchorVX: number,
  anchorVY: number,
): Camera {
  const ratio = camera.zoom / nextZoom;
  return {
    zoom: nextZoom,
    centerX: anchorVX - (anchorVX - camera.centerX) * ratio,
    centerY: anchorVY - (anchorVY - camera.centerY) * ratio,
  };
}

/**
 * Fold an optional camera into a fit transform.
 *
 * A null camera returns the fit transform untouched — the path every
 * non-multiplayer consumer takes (goldfish, waiting room, spectator) and the
 * path pointer devices take, so their behaviour is bit-identical.
 *
 * Lives here rather than in virtualCanvas.ts to avoid a circular import:
 * camera.ts already depends on virtualCanvas.ts for ScaleResult/VIRTUAL_HEIGHT.
 */
export function applyCameraToScale(
  fit: ScaleResult,
  camera: Camera | null | undefined,
  containerWidth: number,
  containerHeight: number,
): ScaleResult {
  if (!camera) return fit;
  return composeCamera(fit, camera, containerWidth, containerHeight);
}
