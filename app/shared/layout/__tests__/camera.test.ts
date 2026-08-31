import { describe, it, expect } from 'vitest';
import { calculateScale, VIRTUAL_HEIGHT } from '../virtualCanvas';
import {
  defaultCamera, composeCamera, clampCamera, fitRectToViewport,
  unionRects, zoomAtPoint, applyCameraToScale, MIN_ZOOM, MAX_ZOOM,
} from '../camera';

describe('composeCamera — identity property', () => {
  // The whole no-regression argument rests on this: at zoom 1, centered, the
  // composed transform must equal today's transform exactly.
  const cases: Array<[number, number]> = [
    [1920, 1080], [960, 540], [1440, 900], [2560, 1080],
    [852, 393], [1133, 744], [1024, 768], [3440, 1440],
  ];

  for (const [cw, ch] of cases) {
    it(`is identical to calculateScale at zoom 1 for ${cw}x${ch}`, () => {
      const fit = calculateScale(cw, ch);
      const cam = defaultCamera(fit.virtualWidth);
      const composed = composeCamera(fit, cam, cw, ch);

      expect(composed.scale).toBeCloseTo(fit.scale, 10);
      expect(composed.offsetX).toBeCloseTo(fit.offsetX, 10);
      expect(composed.offsetY).toBeCloseTo(fit.offsetY, 10);
      expect(composed.virtualWidth).toBe(fit.virtualWidth);
    });
  }
});

describe('composeCamera — zooming', () => {
  it('multiplies scale by zoom', () => {
    const fit = calculateScale(1920, 1080);
    const cam = { zoom: 2, centerX: 960, centerY: 540 };
    expect(composeCamera(fit, cam, 1920, 1080).scale).toBeCloseTo(fit.scale * 2, 10);
  });

  it('puts the camera centre at the viewport centre', () => {
    const fit = calculateScale(1920, 1080);
    const cam = { zoom: 2, centerX: 500, centerY: 300 };
    const c = composeCamera(fit, cam, 1920, 1080);
    expect(500 * c.scale + c.offsetX).toBeCloseTo(960, 6);
    expect(300 * c.scale + c.offsetY).toBeCloseTo(540, 6);
  });
});

describe('clampCamera', () => {
  it('clamps zoom into range', () => {
    const a = clampCamera({ zoom: 0.2, centerX: 960, centerY: 540 }, 1, 1920, 1920, 1080);
    expect(a.zoom).toBe(MIN_ZOOM);
    const b = clampCamera({ zoom: 99, centerX: 960, centerY: 540 }, 1, 1920, 1920, 1080);
    expect(b.zoom).toBe(MAX_ZOOM);
  });

  it('forces the centre when the board is fully visible', () => {
    const c = clampCamera({ zoom: 1, centerX: 0, centerY: 0 }, 1, 1920, 1920, 1080);
    expect(c.centerX).toBe(960);
    expect(c.centerY).toBe(540);
  });

  it('keeps the board covering the viewport when zoomed in', () => {
    const c = clampCamera({ zoom: 2, centerX: 0, centerY: 0 }, 1, 1920, 1920, 1080);
    expect(c.centerX).toBe(480);
    expect(c.centerY).toBe(270);

    const d = clampCamera({ zoom: 2, centerX: 9999, centerY: 9999 }, 1, 1920, 1920, 1080);
    expect(d.centerX).toBe(1920 - 480);
    expect(d.centerY).toBe(1080 - 270);
  });
});

describe('unionRects', () => {
  it('returns null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });

  it('spans all rects', () => {
    const u = unionRects([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 100, y: 5, width: 10, height: 10 },
    ]);
    expect(u).toEqual({ x: 10, y: 5, width: 100, height: 55 });
  });
});

describe('fitRectToViewport', () => {
  it('never zooms out below MIN_ZOOM', () => {
    const rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const cam = fitRectToViewport(rect, 1, 1920, 1920, 1080);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('zooms in on a small rect, capped at MAX_ZOOM', () => {
    const rect = { x: 900, y: 500, width: 120, height: 80 };
    const cam = fitRectToViewport(rect, 1, 1920, 1920, 1080);
    expect(cam.zoom).toBe(MAX_ZOOM);
  });

  // Regression: a side rect spans the full board width, so contain-fitting one
  // can never zoom in and the jump was a silent no-op on every viewport.
  it('contain-fitting a full-width side rect does NOT zoom', () => {
    const side = { x: 0, y: 540, width: 1920, height: 540 };
    expect(fitRectToViewport(side, 1, 1920, 1920, 1080).zoom).toBe(MIN_ZOOM);
  });

  it('height-fitting a full-width side rect zooms in and centres on it', () => {
    const side = { x: 0, y: 540, width: 1920, height: 540 };
    const cam = fitRectToViewport(side, 1, 1920, 1920, 1080, { axis: 'height' });
    expect(cam.zoom).toBeGreaterThan(MIN_ZOOM);
    expect(cam.centerY).toBeGreaterThan(540);
  });

  it('height-fits a side on a real phone-landscape viewport', () => {
    // iPhone 14 Pro landscape, minus the turn bar.
    const cw = 852, ch = 393;
    const fit = calculateScale(cw, ch);
    const side = { x: 0, y: 540, width: fit.virtualWidth, height: 540 };

    expect(fitRectToViewport(side, fit.scale, fit.virtualWidth, cw, ch).zoom).toBe(MIN_ZOOM);

    const cam = fitRectToViewport(side, fit.scale, fit.virtualWidth, cw, ch, { axis: 'height' });
    expect(cam.zoom).toBeGreaterThan(1.5);
  });

  // Regression: a height-axis fit used to CENTER on a full-width side rect,
  // which flung its left-anchored content (auto-arranged LoB souls pack from
  // the left) hundreds of px off-screen left. When the zoomed viewport is
  // narrower than the rect, the viewport's left edge must align to rect.x.
  it('height-fit aligns the viewport left edge to the rect when it cannot show it all', () => {
    const cw = 852, ch = 393;
    const fit = calculateScale(cw, ch);
    const side = { x: 0, y: 0, width: fit.virtualWidth, height: 540 };
    const cam = fitRectToViewport(side, fit.scale, fit.virtualWidth, cw, ch, { axis: 'height' });

    const composed = composeCamera(fit, cam, cw, ch);
    const leftEdgeScreenX = side.x * composed.scale + composed.offsetX;
    // Rect's left edge lands on-screen at (or just inside) the viewport edge…
    expect(leftEdgeScreenX).toBeGreaterThanOrEqual(-1e-6);
    expect(leftEdgeScreenX).toBeLessThanOrEqual(1);
    // …so left-anchored content (a soul at virtual x ~6-250) is visible.
    const soulScreenX = 6 * composed.scale + composed.offsetX;
    expect(soulScreenX).toBeGreaterThanOrEqual(0);
    expect(soulScreenX).toBeLessThan(cw);
  });

  it('height-fit still centres a rect the viewport can fully show', () => {
    const cw = 852, ch = 393;
    const fit = calculateScale(cw, ch);
    // Narrow rect (fits horizontally even at the height-fit zoom).
    const rect = { x: 900, y: 400, width: 300, height: 300 };
    const cam = fitRectToViewport(rect, fit.scale, fit.virtualWidth, cw, ch, { axis: 'height' });
    const composed = composeCamera(fit, cam, cw, ch);
    const centerScreenX = (rect.x + rect.width / 2) * composed.scale + composed.offsetX;
    expect(centerScreenX).toBeCloseTo(cw / 2, 4);
  });
});

describe('zoomAtPoint', () => {
  it('keeps the anchor point stationary', () => {
    const fit = calculateScale(1920, 1080);
    const before = { zoom: 1, centerX: 960, centerY: 540 };
    const anchorVX = 400, anchorVY = 200;

    const after = zoomAtPoint(before, 2, anchorVX, anchorVY);

    const c1 = composeCamera(fit, before, 1920, 1080);
    const c2 = composeCamera(fit, after, 1920, 1080);
    expect(anchorVX * c1.scale + c1.offsetX).toBeCloseTo(anchorVX * c2.scale + c2.offsetX, 6);
    expect(anchorVY * c1.scale + c1.offsetY).toBeCloseTo(anchorVY * c2.scale + c2.offsetY, 6);
  });
});

describe('VIRTUAL_HEIGHT sanity', () => {
  it('is 1080', () => expect(VIRTUAL_HEIGHT).toBe(1080));
});

describe('applyCameraToScale', () => {
  it('is a no-op for a null camera', () => {
    const fit = calculateScale(1920, 1080);
    expect(applyCameraToScale(fit, null, 1920, 1080)).toEqual(fit);
  });

  it('is a no-op for undefined', () => {
    const fit = calculateScale(852, 393);
    expect(applyCameraToScale(fit, undefined, 852, 393)).toEqual(fit);
  });

  it('is a no-op for the default camera on a phone viewport', () => {
    const fit = calculateScale(852, 393);
    const out = applyCameraToScale(fit, defaultCamera(fit.virtualWidth), 852, 393);
    expect(out.scale).toBeCloseTo(fit.scale, 10);
    expect(out.offsetX).toBeCloseTo(fit.offsetX, 10);
    expect(out.offsetY).toBeCloseTo(fit.offsetY, 10);
  });

  it('applies a non-default camera', () => {
    const fit = calculateScale(1920, 1080);
    const out = applyCameraToScale(fit, { zoom: 2, centerX: 960, centerY: 540 }, 1920, 1080);
    expect(out.scale).toBeCloseTo(fit.scale * 2, 10);
  });
});

describe('clampCamera - adversarial review regressions', () => {
  it('does not produce NaN centres at zero container size', () => {
    const c = clampCamera({ zoom: 1, centerX: 100, centerY: 100 }, 0, 1920, 0, 0);
    expect(Number.isFinite(c.centerX)).toBe(true);
    expect(Number.isFinite(c.centerY)).toBe(true);
  });

  it('re-clamping after a viewport shrink keeps the board covering the view', () => {
    // Pan hard right at 2.5x on a wide viewport, then narrow the container.
    const wide = clampCamera({ zoom: 2.5, centerX: 9999, centerY: 540 }, 1, 1920, 1133, 744);
    const narrowed = clampCamera(wide, 1, 1920, 744, 1133);
    const scale = 2.5;
    const halfViewW = 744 / (2 * scale);
    expect(narrowed.centerX).toBeLessThanOrEqual(1920 - halfViewW + 1e-6);
    expect(narrowed.centerX).toBeGreaterThanOrEqual(halfViewW - 1e-6);
  });
});

describe('zoomAtPoint - clamp before anchoring', () => {
  it('anchors exactly when the requested zoom is already in range', () => {
    const before = { zoom: 1, centerX: 960, centerY: 540 };
    const after = zoomAtPoint(before, MAX_ZOOM, 700, 250);
    const fit = calculateScale(852, 393);
    const c1 = composeCamera(fit, before, 852, 393);
    const c2 = composeCamera(fit, after, 852, 393);
    expect(700 * c1.scale + c1.offsetX).toBeCloseTo(700 * c2.scale + c2.offsetX, 6);
  });

  it('a caller that clamps first gets a centre consistent with the applied zoom', () => {
    // The bug: solving the centre for zoom 5, then clamping zoom to 3, keeps a
    // centre computed for a zoom never applied - the camera walks to a corner.
    const before = { zoom: 1, centerX: 960, centerY: 540 };
    const clampedFirst = zoomAtPoint(before, Math.min(MAX_ZOOM, 5), 700, 250);
    expect(clampedFirst.zoom).toBe(MAX_ZOOM);
    const fit = calculateScale(852, 393);
    const c1 = composeCamera(fit, before, 852, 393);
    const c2 = composeCamera(fit, clampedFirst, 852, 393);
    expect(700 * c1.scale + c1.offsetX).toBeCloseTo(700 * c2.scale + c2.offsetX, 6);
  });
});
