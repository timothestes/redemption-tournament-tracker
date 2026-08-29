import { describe, it, expect } from 'vitest';
import { calculateScale, VIRTUAL_HEIGHT } from '../virtualCanvas';
import {
  defaultCamera, composeCamera, clampCamera, fitRectToViewport,
  unionRects, zoomAtPoint, MIN_ZOOM, MAX_ZOOM,
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
