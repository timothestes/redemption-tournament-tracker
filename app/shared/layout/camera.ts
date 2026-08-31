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

  // Before the container has been measured, scale is 0 and the half-view
  // divisions are 0/0 = NaN. NaN fails every comparison, so it would slip past
  // the visibility checks below and clamp() would hand back NaN centres.
  if (!Number.isFinite(scale) || scale <= 0) {
    return { zoom, centerX: virtualWidth / 2, centerY: VIRTUAL_HEIGHT / 2 };
  }

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
  /** Screen px at the top of the viewport covered by overlay chrome (the
   *  touch turn bar). The rect is fitted and centered within the area BELOW
   *  it, so a side jump doesn't hide its top row under the bar. */
  insetTop?: number;
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
  const { axis = 'both', padding = 1.06, insetTop = 0 } = opts;
  const needW = rect.width * padding;
  const needH = rect.height * padding;
  const availH = Math.max(1, containerHeight - insetTop);
  const scaleNeeded = axis === 'height'
    ? availH / needH
    : Math.min(containerWidth / needW, availH / needH);
  const zoom = scaleNeeded / fitScale;

  // A height-axis fit can leave the viewport narrower than the rect (a
  // "side" spans the full board width). Centering then frames the MIDDLE of
  // the rect and flings its left-anchored content (e.g. auto-arranged LoB
  // souls, which pack from the left) off-screen. When the zoomed viewport
  // can't show the whole rect, align the viewport's left edge to the rect's
  // left edge instead of centering, so the leftmost content is what lands
  // on screen. Uses the CLAMPED zoom — clampCamera below caps at MAX_ZOOM,
  // and the visible half-width must be computed at the zoom actually used.
  let centerX = rect.x + rect.width / 2;
  const effectiveScale = fitScale * clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  if (Number.isFinite(effectiveScale) && effectiveScale > 0) {
    const halfViewW = containerWidth / (2 * effectiveScale);
    if (rect.width > 2 * halfViewW) {
      centerX = rect.x + halfViewW;
    }
  }

  // Center the rect within the area below the top chrome: pushing content
  // down by insetTop/2 screen px means moving the camera centre UP by the
  // same distance in virtual units.
  let centerY = rect.y + rect.height / 2;
  if (insetTop > 0 && Number.isFinite(effectiveScale) && effectiveScale > 0) {
    centerY -= insetTop / (2 * effectiveScale);
  }

  return clampCamera(
    { zoom, centerX, centerY },
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
 * One frame of a two-finger gesture: translate by how far the pinch midpoint
 * travelled, then re-anchor the zoom on the virtual point under the midpoint.
 *
 * The translation is the whole point. Anchoring alone holds a point fixed on
 * screen, so two fingers moving together at constant separation changed
 * nothing — the board could only be panned with ONE finger, and a one-finger
 * press only reaches the camera when it lands on bare board. Once a territory
 * fills up there is no bare board left, and the half of the board that a side
 * jump leaves off-screen becomes unreachable.
 */
export function pinchCamera(
  prev: Camera,
  nextZoom: number,
  mid: { x: number; y: number; dx: number; dy: number },
  fitScale: number,
  virtualWidth: number,
  containerWidth: number,
  containerHeight: number,
): Camera {
  const prevScale = fitScale * prev.zoom;
  if (!Number.isFinite(prevScale) || prevScale <= 0) return prev;
  const panned: Camera = {
    ...prev,
    centerX: prev.centerX - mid.dx / prevScale,
    centerY: prev.centerY - mid.dy / prevScale,
  };
  const anchorVX = panned.centerX + (mid.x - containerWidth / 2) / prevScale;
  const anchorVY = panned.centerY + (mid.y - containerHeight / 2) / prevScale;
  return clampCamera(
    zoomAtPoint(panned, nextZoom, anchorVX, anchorVY),
    fitScale, virtualWidth, containerWidth, containerHeight,
  );
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
