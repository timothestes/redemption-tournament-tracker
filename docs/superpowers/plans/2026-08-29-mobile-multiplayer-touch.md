# Mobile Multiplayer Touch Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/play` online multiplayer playable on tablets and phones in landscape, via a touch interaction layer, a board camera, and a touch layout profile.

**Architecture:** Three additive layers over the existing virtual-canvas board. (1) A camera folded into the existing `scale/offsetX/offsetY` triple, which every Konva layer and HTML overlay already respects — so it propagates with no call-site changes and reduces to today's transform at `zoom=1`. (2) A touch input layer (long-press → bottom sheets, tap-to-move, a camera-independent destination rail) that reuses the existing centralized `findZoneAtPosition` hit-tester. (3) A `TOUCH_PROFILE` added beside the existing `NARROW`/`STANDARD` layout profiles.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Konva 10 / react-konva 19, Tailwind, Framer Motion, Vitest (pure-logic only), Playwright + CDP.

**Spec:** [`docs/superpowers/specs/2026-08-29-mobile-multiplayer-touch-design.md`](../specs/2026-08-29-mobile-multiplayer-touch-design.md)

**Worktree:** All work happens in `/Users/timestes/projects/rtt-mobile-touch` on branch `feat/mobile-multiplayer-touch`. Use absolute paths. Another agent may own the main checkout — never touch it.

## Global Constraints

- **Vitest runs pure logic only.** `vitest.config.ts` sets `include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"]` — `.tsx` is NOT matched, and no jsdom environment is configured. Therefore: **no React rendering tests, no DOM tests.** Follow the repo idiom of a pure core module (`*Core.ts` / `*Math.ts` / `*Decision.ts`) with tests, plus a thin untested React hook wrapper. Existing examples: `app/play/hooks/undoStackCore.ts`, `app/play/lib/battleMath.ts`, `app/play/lib/gameEntryDecision.ts`.
- **Test command:** `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run <path>`
- **Never run `next build` while a dev server is running** — they share `.next`. Use `npx tsc --noEmit` as the type gate. (See memory: `reference_next_build_shared_distdir`.)
- **Never `git add -A` / `.` / `-a`.** Stage only the specific files each task touches.
- **`tsconfig` has `strict: false`.** `if (r.ok) / else` union narrowing does NOT work; use explicit `=== false` comparisons. Only a real type-check catches this.
- **Card-size formula** (spec §1.3): `physical card width = containerWidth × (1 − sidebarWidthRatio) × mainCardWidthRatio`. `VIRTUAL_HEIGHT` cancels out — never try to change card size by changing virtual height.
- **Touch targets:** controls ≥44×44 CSS px. Hard floor 24×24 with 24px spacing. Card tap hit-regions padded to ≥44px even when the card renders smaller.
- **Zone vocabulary** (`app/shared/types/gameCard.ts`): `'deck' | 'hand' | 'reserve' | 'discard' | 'paragon' | 'land-of-bondage' | 'soul-deck' | 'territory' | 'land-of-redemption' | 'banish' | 'battle'`.
- **Existing constants** (`app/shared/layout/virtualCanvas.ts`): `VIRTUAL_HEIGHT = 1080`, `MIN_VIRTUAL_WIDTH = 1440`, `MAX_VIRTUAL_WIDTH = 2560`, `VIRTUAL_WIDTH = 1920`.
- **Commit after every task.** Message prefix `feat(play):`, `fix(play):`, `test(play):` or `docs(play):`.

---

# Phase 0 — Foundation

No user-visible change. Everything here is a no-op by default, so it can land safely.

---

### Task 1: Input mode detection

**Files:**
- Create: `app/shared/layout/inputMode.ts`
- Create: `app/shared/layout/__tests__/inputMode.test.ts`
- Create: `app/shared/hooks/useInputMode.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type InputMode = 'pointer' | 'touch'`
  - `resolveInputMode(coarsePointer: boolean, override: string | null): InputMode`
  - `parseInputOverride(search: string): string | null`
  - `useInputMode(): InputMode`

- [ ] **Step 1: Write the failing test**

Create `app/shared/layout/__tests__/inputMode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveInputMode, parseInputOverride } from '../inputMode';

describe('resolveInputMode', () => {
  it('returns touch when the pointer is coarse', () => {
    expect(resolveInputMode(true, null)).toBe('touch');
  });

  it('returns pointer when the pointer is fine', () => {
    expect(resolveInputMode(false, null)).toBe('pointer');
  });

  it('lets an explicit override win over coarse detection', () => {
    expect(resolveInputMode(true, 'pointer')).toBe('pointer');
    expect(resolveInputMode(false, 'touch')).toBe('touch');
  });

  it('ignores an unrecognised override', () => {
    expect(resolveInputMode(true, 'banana')).toBe('touch');
    expect(resolveInputMode(false, 'banana')).toBe('pointer');
  });
});

describe('parseInputOverride', () => {
  it('reads the input param', () => {
    expect(parseInputOverride('?input=touch')).toBe('touch');
    expect(parseInputOverride('?foo=1&input=pointer')).toBe('pointer');
  });

  it('returns null when absent', () => {
    expect(parseInputOverride('')).toBeNull();
    expect(parseInputOverride('?foo=1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/shared/layout/__tests__/inputMode.test.ts`
Expected: FAIL — "Failed to resolve import ../inputMode"

- [ ] **Step 3: Write minimal implementation**

Create `app/shared/layout/inputMode.ts`:

```ts
/**
 * Input mode detection, split from the React hook so the decision logic is
 * unit-testable (vitest runs pure .ts only — no jsdom in this repo).
 */

export type InputMode = 'pointer' | 'touch';

/** Query-param override, e.g. `?input=touch`. Lets the e2e harness force
 *  touch mode inside a desktop Chromium. */
export function parseInputOverride(search: string): string | null {
  if (!search) return null;
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of q.split('&')) {
    const [k, v] = pair.split('=');
    if (k === 'input' && v) return decodeURIComponent(v);
  }
  return null;
}

/** An explicit, recognised override always wins; otherwise fall back to the
 *  `(pointer: coarse)` media query. */
export function resolveInputMode(coarsePointer: boolean, override: string | null): InputMode {
  if (override === 'touch' || override === 'pointer') return override;
  return coarsePointer ? 'touch' : 'pointer';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/shared/layout/__tests__/inputMode.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Write the React hook**

Create `app/shared/hooks/useInputMode.ts`:

```ts
'use client';

import { useState, useEffect } from 'react';
import { resolveInputMode, parseInputOverride, type InputMode } from '@/app/shared/layout/inputMode';

export type { InputMode };

const COARSE_QUERY = '(pointer: coarse)';

/**
 * Reactive pointer/touch detection.
 *
 * Uses `(pointer: coarse)` rather than UA sniffing so hybrid devices (iPad
 * with a trackpad, Surface) resolve correctly and can change mid-session.
 * SSR-safe: returns 'pointer' until mounted.
 */
export function useInputMode(): InputMode {
  const [mode, setMode] = useState<InputMode>('pointer');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const override = parseInputOverride(window.location.search);
    const mq = window.matchMedia(COARSE_QUERY);
    const update = () => setMode(resolveInputMode(mq.matches, override));
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return mode;
}
```

- [ ] **Step 6: Type-check**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/shared/layout/inputMode.ts app/shared/layout/__tests__/inputMode.test.ts app/shared/hooks/useInputMode.ts
git commit -m "feat(play): pointer/touch input mode detection with URL override"
```

---

### Task 2: Camera core

The heart of the change. Pure math, fully tested, no React.

**Files:**
- Create: `app/shared/layout/camera.ts`
- Create: `app/shared/layout/__tests__/camera.test.ts`

**Interfaces:**
- Consumes: `calculateScale`, `ScaleResult`, `VIRTUAL_HEIGHT` from `app/shared/layout/virtualCanvas.ts`.
- Produces:
  - `interface Camera { zoom: number; centerX: number; centerY: number }`
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `MIN_ZOOM = 1`, `MAX_ZOOM = 3`
  - `defaultCamera(virtualWidth: number): Camera`
  - `composeCamera(fit: ScaleResult, camera: Camera, containerWidth: number, containerHeight: number): ScaleResult`
  - `clampCamera(camera: Camera, fitScale: number, virtualWidth: number, containerWidth: number, containerHeight: number): Camera`
  - `fitRectToViewport(rect: Rect, fitScale: number, virtualWidth: number, containerWidth: number, containerHeight: number, padding?: number): Camera`
  - `unionRects(rects: Rect[]): Rect | null`
  - `zoomAtPoint(camera: Camera, nextZoom: number, anchorVX: number, anchorVY: number): Camera`

- [ ] **Step 1: Write the failing test**

Create `app/shared/layout/__tests__/camera.test.ts`:

```ts
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
    // virtual (500,300) should land at screen centre (960,540)
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
    // zoom 2 → half-view is 480x270 virtual units
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
  it('centres on the rect', () => {
    const rect = { x: 0, y: 540, width: 1920, height: 540 };
    const cam = fitRectToViewport(rect, 1, 1920, 1920, 1080);
    expect(cam.centerY).toBeGreaterThan(540);
  });

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/shared/layout/__tests__/camera.test.ts`
Expected: FAIL — "Failed to resolve import ../camera"

- [ ] **Step 3: Write minimal implementation**

Create `app/shared/layout/camera.ts`:

```ts
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
 *   scale'   = fitScale × zoom
 *   offsetX' = containerWidth/2  − centerX × scale'
 *   offsetY' = containerHeight/2 − centerY × scale'
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

/** Camera that frames `rect` in the viewport with a small margin. */
export function fitRectToViewport(
  rect: Rect,
  fitScale: number,
  virtualWidth: number,
  containerWidth: number,
  containerHeight: number,
  padding = 1.06,
): Camera {
  const needW = rect.width * padding;
  const needH = rect.height * padding;
  const scaleNeeded = Math.min(containerWidth / needW, containerHeight / needH);
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
 * Screen position of the anchor is `(v − c) × s + viewportCentre`. Holding it
 * fixed across a zoom change gives: c' = v − (v − c) × z/z'.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/shared/layout/__tests__/camera.test.ts`
Expected: PASS — all tests, including the 8 identity cases

- [ ] **Step 5: Confirm the existing suite still passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/shared/layout/`
Expected: PASS — `virtualCanvas.test.ts` untouched and green

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/shared/layout/camera.ts app/shared/layout/__tests__/camera.test.ts
git commit -m "feat(play): board camera core with zoom-1 identity property"
```

---

### Task 3: Wire the camera into `useVirtualCanvas`

**Files:**
- Modify: `app/shared/layout/virtualCanvas.ts`
- Modify: `app/shared/layout/__tests__/virtualCanvas.test.ts`

**Interfaces:**
- Consumes: `Camera`, `composeCamera`, `defaultCamera` from Task 2.
- Produces: `useVirtualCanvas(containerRef, camera?: Camera | null): VirtualCanvasState` — passing `null`/omitting keeps today's exact behaviour. `VirtualCanvasState` gains `fitScale: number` (the pre-camera scale, needed by `useBoardCamera` for clamping).

- [ ] **Step 1: Write the failing test**

Append to `app/shared/layout/__tests__/virtualCanvas.test.ts`:

```ts
import { applyCameraToScale } from '../virtualCanvas';
import { defaultCamera } from '../camera';

describe('applyCameraToScale', () => {
  it('is a no-op for a null camera', () => {
    const fit = calculateScale(1920, 1080);
    expect(applyCameraToScale(fit, null, 1920, 1080)).toEqual(fit);
  });

  it('is a no-op for the default camera', () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/shared/layout/__tests__/virtualCanvas.test.ts`
Expected: FAIL — `applyCameraToScale` is not exported

- [ ] **Step 3: Implement**

In `app/shared/layout/virtualCanvas.ts`, add the import at the top (after the existing `react` import):

```ts
import { composeCamera, type Camera } from './camera';
```

Add this exported helper immediately after `calculateScale`:

```ts
/**
 * Fold an optional camera into a fit transform. A null camera returns the fit
 * transform untouched — this is the path every non-multiplayer consumer takes
 * (goldfish, waiting room, spectator), so their behaviour is bit-identical.
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
```

Change the `VirtualCanvasState` interface to add `fitScale`:

```ts
export interface VirtualCanvasState extends ScaleResult {
  containerWidth: number;
  containerHeight: number;
  /** The scale BEFORE the camera is applied. Camera clamping needs this. */
  fitScale: number;
}
```

Replace the `useMemo` and `return` at the bottom of `useVirtualCanvas` with:

```ts
  const scaling = useMemo(
    () => calculateScale(container.width, container.height),
    [container.width, container.height],
  );

  const composed = useMemo(
    () => applyCameraToScale(scaling, camera, container.width, container.height),
    [scaling, camera, container.width, container.height],
  );

  return {
    ...composed,
    containerWidth: container.width,
    containerHeight: container.height,
    fitScale: scaling.scale,
  };
```

And change the signature to accept the optional camera:

```ts
export function useVirtualCanvas(
  containerRef: RefObject<HTMLDivElement | null>,
  camera?: Camera | null,
): VirtualCanvasState {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/shared/layout/`
Expected: PASS — all existing tests plus the 3 new ones

- [ ] **Step 5: Type-check the three existing consumers**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors. `MultiplayerCanvas.tsx:407`, `app/goldfish/[deckId]/client.tsx:30` and `WaitingRoomGoldfish.tsx:30` all call `useVirtualCanvas(containerRef)` with one argument, which is still valid.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/shared/layout/virtualCanvas.ts app/shared/layout/__tests__/virtualCanvas.test.ts
git commit -m "feat(play): thread an optional camera through useVirtualCanvas"
```

---

### Task 4: Touch bug fixes and gesture surface prep

Three real bugs (spec §3.10) plus the `touch-action` that everything else depends on.

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`
- Modify: `app/shared/components/GameCardNode.tsx`
- Create: `app/play/lib/pointerButton.ts`
- Create: `app/play/lib/__tests__/pointerButton.test.ts`

**Interfaces:**
- Produces: `isPrimaryPointer(evt: { button?: number }): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/play/lib/__tests__/pointerButton.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPrimaryPointer } from '../pointerButton';

describe('isPrimaryPointer', () => {
  it('accepts a left mouse button', () => {
    expect(isPrimaryPointer({ button: 0 })).toBe(true);
  });

  it('rejects middle and right buttons', () => {
    expect(isPrimaryPointer({ button: 1 })).toBe(false);
    expect(isPrimaryPointer({ button: 2 })).toBe(false);
  });

  it('accepts a TouchEvent, which has no button property', () => {
    // This is the live bug: `e.evt.button === 0` is false on touch, so the
    // click counter never incremented and double-tap-to-meek was dead.
    expect(isPrimaryPointer({})).toBe(true);
    expect(isPrimaryPointer({ button: undefined })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/pointerButton.test.ts`
Expected: FAIL — cannot resolve `../pointerButton`

- [ ] **Step 3: Implement the helper**

Create `app/play/lib/pointerButton.ts`:

```ts
/**
 * Konva hands us either a MouseEvent (which has `button`) or a TouchEvent
 * (which does not). Comparing `button === 0` therefore silently reports false
 * for every touch, which is what killed double-tap-to-meek on touch devices.
 * Treat a missing `button` as the primary pointer.
 */
export function isPrimaryPointer(evt: { button?: number }): boolean {
  return evt.button === undefined || evt.button === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/pointerButton.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Apply the fix in `MultiplayerCanvas.tsx`**

Add to the imports:

```ts
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
```

In `handleCardClick` (~line 4925), replace:

```ts
      if (e.evt.button === 0) leftClicksSinceContextMenuRef.current += 1;
```

with:

```ts
      if (isPrimaryPointer(e.evt)) leftClicksSinceContextMenuRef.current += 1;
```

- [ ] **Step 6: Add `touch-action` to the stage container**

In `MultiplayerCanvas.tsx` (~line 6279), replace the container div's style with:

```tsx
    <div
      ref={containerRef}
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        overflow: 'hidden',
        // The board owns every gesture inside it. Without this the browser
        // steals pan/pinch and iOS shows the long-press callout.
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
```

- [ ] **Step 7: Fix the stuck touch hover in `GameCardNode.tsx`**

At `app/shared/components/GameCardNode.tsx`, the node currently has
`onTouchStart={(e) => onMouseEnter(card, e as unknown as Konva.KonvaEventObject<MouseEvent>)}`
with nothing that ever clears it. Add the two clearing handlers directly after it:

```tsx
      onTouchEnd={onMouseLeave}
      onTouchCancel={onMouseLeave}
```

- [ ] **Step 8: Type-check**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 9: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/lib/pointerButton.ts app/play/lib/__tests__/pointerButton.test.ts app/play/components/MultiplayerCanvas.tsx app/shared/components/GameCardNode.tsx
git commit -m "fix(play): restore double-tap-to-meek on touch, clear stuck touch hover, own board gestures"
```

---

# Phase 1 — Touch input layer

Delivers tablet playability.

---

### Task 5: Long-press recognizer

**Files:**
- Create: `app/play/lib/longPressCore.ts`
- Create: `app/play/lib/__tests__/longPressCore.test.ts`
- Create: `app/play/hooks/useLongPress.ts`

**Interfaces:**
- Produces:
  - `LONG_PRESS_MS = 500`, `LONG_PRESS_MOVE_TOLERANCE = 10`
  - `interface PressState { startX: number; startY: number; startedAt: number; firedLongPress: boolean }`
  - `beginPress(x, y, now): PressState`
  - `shouldCancelForMovement(state: PressState, x: number, y: number): boolean`
  - `shouldFireLongPress(state: PressState, now: number): boolean`
  - `useLongPress(onLongPress): { onPointerDown, onPointerMove, onPointerUp, cancel }`

- [ ] **Step 1: Write the failing test**

Create `app/play/lib/__tests__/longPressCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  beginPress, shouldCancelForMovement, shouldFireLongPress,
  LONG_PRESS_MS, LONG_PRESS_MOVE_TOLERANCE,
} from '../longPressCore';

describe('longPressCore', () => {
  it('starts a press with the origin recorded', () => {
    const s = beginPress(100, 200, 1000);
    expect(s.startX).toBe(100);
    expect(s.startY).toBe(200);
    expect(s.startedAt).toBe(1000);
    expect(s.firedLongPress).toBe(false);
  });

  it('does not fire before the threshold', () => {
    const s = beginPress(0, 0, 1000);
    expect(shouldFireLongPress(s, 1000 + LONG_PRESS_MS - 1)).toBe(false);
  });

  it('fires at the threshold', () => {
    const s = beginPress(0, 0, 1000);
    expect(shouldFireLongPress(s, 1000 + LONG_PRESS_MS)).toBe(true);
  });

  it('does not fire twice', () => {
    const s = { ...beginPress(0, 0, 1000), firedLongPress: true };
    expect(shouldFireLongPress(s, 9999)).toBe(false);
  });

  it('tolerates small movement', () => {
    const s = beginPress(100, 100, 1000);
    expect(shouldCancelForMovement(s, 100 + LONG_PRESS_MOVE_TOLERANCE - 1, 100)).toBe(false);
  });

  it('cancels once movement exceeds the tolerance — that is a drag', () => {
    const s = beginPress(100, 100, 1000);
    expect(shouldCancelForMovement(s, 100 + LONG_PRESS_MOVE_TOLERANCE + 1, 100)).toBe(true);
    expect(shouldCancelForMovement(s, 100, 100 + LONG_PRESS_MOVE_TOLERANCE + 1)).toBe(true);
  });

  it('measures movement radially, not per-axis', () => {
    const s = beginPress(0, 0, 1000);
    // 8,8 is 11.3 away — beyond a tolerance of 10 even though neither axis is
    expect(shouldCancelForMovement(s, 8, 8)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/longPressCore.test.ts`
Expected: FAIL — cannot resolve `../longPressCore`

- [ ] **Step 3: Implement**

Create `app/play/lib/longPressCore.ts`:

```ts
/**
 * Long-press recognition, split from React so the timing and movement rules
 * are unit-testable.
 *
 * Arbitration with drag: a press that moves beyond the tolerance BEFORE the
 * threshold elapses is a drag, and the long-press is abandoned. A press that
 * survives the threshold without moving is a long-press, and the caller
 * cancels the pending Konva drag via node.stopDrag().
 */

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_MOVE_TOLERANCE = 10;

export interface PressState {
  startX: number;
  startY: number;
  startedAt: number;
  firedLongPress: boolean;
}

export function beginPress(x: number, y: number, now: number): PressState {
  return { startX: x, startY: y, startedAt: now, firedLongPress: false };
}

/** Radial distance, so a diagonal drag is not accidentally tolerated. */
export function shouldCancelForMovement(state: PressState, x: number, y: number): boolean {
  const dx = x - state.startX;
  const dy = y - state.startY;
  return Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE;
}

export function shouldFireLongPress(state: PressState, now: number): boolean {
  if (state.firedLongPress) return false;
  return now - state.startedAt >= LONG_PRESS_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/longPressCore.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Write the React hook**

Create `app/play/hooks/useLongPress.ts`:

```ts
'use client';

import { useRef, useCallback, useEffect } from 'react';
import {
  beginPress, shouldCancelForMovement, shouldFireLongPress,
  LONG_PRESS_MS, type PressState,
} from '@/app/play/lib/longPressCore';

export interface LongPressPoint { x: number; y: number }

/**
 * Long-press recognizer for Konva nodes. `onLongPress` receives the press
 * origin in the same coordinate space the caller supplied.
 *
 * The caller is responsible for cancelling any pending Konva drag (via
 * node.stopDrag()) inside onLongPress — this hook only decides *when*.
 */
export function useLongPress(onLongPress: (p: LongPressPoint) => void) {
  const stateRef = useRef<PressState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    stateRef.current = null;
  }, [clearTimer]);

  const onPointerDown = useCallback((x: number, y: number) => {
    cancel();
    const state = beginPress(x, y, performance.now());
    stateRef.current = state;
    timerRef.current = setTimeout(() => {
      const s = stateRef.current;
      if (!s) return;
      if (!shouldFireLongPress(s, performance.now())) return;
      s.firedLongPress = true;
      onLongPress({ x: s.startX, y: s.startY });
    }, LONG_PRESS_MS);
  }, [cancel, onLongPress]);

  const onPointerMove = useCallback((x: number, y: number) => {
    const s = stateRef.current;
    if (!s || s.firedLongPress) return;
    if (shouldCancelForMovement(s, x, y)) cancel();
  }, [cancel]);

  const onPointerUp = useCallback(() => cancel(), [cancel]);

  useEffect(() => clearTimer, [clearTimer]);

  return { onPointerDown, onPointerMove, onPointerUp, cancel };
}
```

- [ ] **Step 6: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/lib/longPressCore.ts app/play/lib/__tests__/longPressCore.test.ts app/play/hooks/useLongPress.ts
git commit -m "feat(play): long-press recognizer with drag arbitration"
```

---

### Task 6: Tap-to-move state machine

**Files:**
- Create: `app/play/lib/tapToMoveCore.ts`
- Create: `app/play/lib/__tests__/tapToMoveCore.test.ts`

**Interfaces:**
- Produces:
  - `type TapMoveState = { kind: 'idle' } | { kind: 'armed'; cardId: string; sourceZone: ZoneId; sourceOwner: ZoneOwner }`
  - `type ZoneOwner = 'my' | 'opponent' | 'shared'`
  - `type TapMoveEvent` (discriminated union — see code)
  - `tapMoveReducer(state, event): { state: TapMoveState; commit: CommitMove | null }`
  - `interface CommitMove { cardId: string; toZone: ZoneId; toOwner: ZoneOwner; atPoint: { x: number; y: number } | null }`
  - `legalDestinations(sourceZone, sourceOwner, format): Array<{ zone: ZoneId; owner: ZoneOwner }>`

- [ ] **Step 1: Write the failing test**

Create `app/play/lib/__tests__/tapToMoveCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tapMoveReducer, legalDestinations, type TapMoveState } from '../tapToMoveCore';

const idle: TapMoveState = { kind: 'idle' };
const armed: TapMoveState = {
  kind: 'armed', cardId: 'c1', sourceZone: 'hand', sourceOwner: 'my',
};

describe('tapMoveReducer', () => {
  it('arms on a card tap from idle', () => {
    const r = tapMoveReducer(idle, {
      type: 'tapCard', cardId: 'c1', zone: 'hand', owner: 'my',
    });
    expect(r.state).toEqual(armed);
    expect(r.commit).toBeNull();
  });

  it('disarms when the same card is tapped again', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapCard', cardId: 'c1', zone: 'hand', owner: 'my',
    });
    expect(r.state.kind).toBe('idle');
    expect(r.commit).toBeNull();
  });

  it('re-arms onto a different card', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapCard', cardId: 'c2', zone: 'territory', owner: 'my',
    });
    expect(r.state).toEqual({
      kind: 'armed', cardId: 'c2', sourceZone: 'territory', sourceOwner: 'my',
    });
    expect(r.commit).toBeNull();
  });

  it('commits with a point when a zone is tapped on canvas', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapZone', zone: 'territory', owner: 'my', point: { x: 500, y: 700 },
    });
    expect(r.state.kind).toBe('idle');
    expect(r.commit).toEqual({
      cardId: 'c1', toZone: 'territory', toOwner: 'my', atPoint: { x: 500, y: 700 },
    });
  });

  it('commits without a point when a rail chip is tapped', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapDestinationChip', zone: 'land-of-redemption', owner: 'opponent',
    });
    expect(r.commit).toEqual({
      cardId: 'c1', toZone: 'land-of-redemption', toOwner: 'opponent', atPoint: null,
    });
  });

  it('ignores a zone tap while idle', () => {
    const r = tapMoveReducer(idle, {
      type: 'tapZone', zone: 'territory', owner: 'my', point: { x: 1, y: 2 },
    });
    expect(r.state.kind).toBe('idle');
    expect(r.commit).toBeNull();
  });

  it('does not commit a move to the card\'s own source zone', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapZone', zone: 'hand', owner: 'my', point: { x: 1, y: 2 },
    });
    expect(r.commit).toBeNull();
    expect(r.state.kind).toBe('idle');
  });

  it('cancels on empty-space tap and on explicit cancel', () => {
    expect(tapMoveReducer(armed, { type: 'tapEmpty' }).state.kind).toBe('idle');
    expect(tapMoveReducer(armed, { type: 'cancel' }).state.kind).toBe('idle');
  });
});

describe('legalDestinations', () => {
  it('offers both sides', () => {
    const d = legalDestinations('hand', 'my', 'T1');
    expect(d.some((x) => x.owner === 'my')).toBe(true);
    expect(d.some((x) => x.owner === 'opponent')).toBe(true);
  });

  it('excludes the source zone itself', () => {
    const d = legalDestinations('hand', 'my', 'T1');
    expect(d.some((x) => x.zone === 'hand' && x.owner === 'my')).toBe(false);
  });

  it('includes the opponent Land of Redemption — the cross-side case', () => {
    const d = legalDestinations('territory', 'my', 'T1');
    expect(d).toContainEqual({ zone: 'land-of-redemption', owner: 'opponent' });
  });

  it('offers shared zones only in Paragon', () => {
    expect(legalDestinations('hand', 'my', 'Paragon')
      .some((x) => x.owner === 'shared')).toBe(true);
    expect(legalDestinations('hand', 'my', 'T1')
      .some((x) => x.owner === 'shared')).toBe(false);
  });

  it('never offers the battle zone — that is phase-driven', () => {
    expect(legalDestinations('hand', 'my', 'T1')
      .some((x) => x.zone === 'battle')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/tapToMoveCore.test.ts`
Expected: FAIL — cannot resolve `../tapToMoveCore`

- [ ] **Step 3: Implement**

Create `app/play/lib/tapToMoveCore.ts`:

```ts
/**
 * Tap-to-move state machine.
 *
 * On touch, drag is a poor primary mechanic: cards render around 45-60px, a
 * fingertip covers ~44px, and a destination may be off-screen once the camera
 * can pan. So the primary flow is: tap a card to arm it, then tap a
 * destination. Drag remains available for fine free-form placement.
 *
 * Two distinct commit paths, deliberately:
 *   - tapZone            → drops at the tapped point (position matters for
 *                          equipping and battle placement)
 *   - tapDestinationChip → drops into an auto-arranged slot, and works even
 *                          when the destination is off-screen. This is what
 *                          makes cross-side movement independent of the camera.
 */

import type { ZoneId } from '@/app/shared/types/gameCard';

export type ZoneOwner = 'my' | 'opponent' | 'shared';

export type TapMoveState =
  | { kind: 'idle' }
  | { kind: 'armed'; cardId: string; sourceZone: ZoneId; sourceOwner: ZoneOwner };

export type TapMoveEvent =
  | { type: 'tapCard'; cardId: string; zone: ZoneId; owner: ZoneOwner }
  | { type: 'tapZone'; zone: ZoneId; owner: ZoneOwner; point: { x: number; y: number } }
  | { type: 'tapDestinationChip'; zone: ZoneId; owner: ZoneOwner }
  | { type: 'tapEmpty' }
  | { type: 'cancel' };

export interface CommitMove {
  cardId: string;
  toZone: ZoneId;
  toOwner: ZoneOwner;
  /** Virtual-space drop point, or null to let auto-arrange place the card. */
  atPoint: { x: number; y: number } | null;
}

export interface TapMoveResult {
  state: TapMoveState;
  commit: CommitMove | null;
}

const IDLE: TapMoveState = { kind: 'idle' };

export function tapMoveReducer(state: TapMoveState, event: TapMoveEvent): TapMoveResult {
  switch (event.type) {
    case 'cancel':
    case 'tapEmpty':
      return { state: IDLE, commit: null };

    case 'tapCard': {
      // Tapping the armed card again is a disarm — the natural undo gesture.
      if (state.kind === 'armed' && state.cardId === event.cardId) {
        return { state: IDLE, commit: null };
      }
      return {
        state: {
          kind: 'armed',
          cardId: event.cardId,
          sourceZone: event.zone,
          sourceOwner: event.owner,
        },
        commit: null,
      };
    }

    case 'tapZone': {
      if (state.kind !== 'armed') return { state, commit: null };
      // Dropping a card back where it came from is a no-op, not a move.
      if (state.sourceZone === event.zone && state.sourceOwner === event.owner) {
        return { state: IDLE, commit: null };
      }
      return {
        state: IDLE,
        commit: {
          cardId: state.cardId,
          toZone: event.zone,
          toOwner: event.owner,
          atPoint: event.point,
        },
      };
    }

    case 'tapDestinationChip': {
      if (state.kind !== 'armed') return { state, commit: null };
      return {
        state: IDLE,
        commit: {
          cardId: state.cardId,
          toZone: event.zone,
          toOwner: event.owner,
          atPoint: null,
        },
      };
    }

    default:
      return { state, commit: null };
  }
}

/** Zones a player can send a card to on their own side. */
const MY_DESTINATIONS: ZoneId[] = [
  'territory', 'hand', 'reserve', 'discard', 'deck', 'land-of-redemption', 'banish', 'land-of-bondage',
];

/** Zones a player can send a card to on the opponent's side. Sandbox rules
 *  already permit all of these — see findZoneAtPosition in MultiplayerCanvas. */
const OPPONENT_DESTINATIONS: ZoneId[] = [
  'territory', 'land-of-bondage', 'land-of-redemption', 'discard', 'banish', 'hand',
];

/** Paragon-only shared zones. */
const SHARED_DESTINATIONS: ZoneId[] = ['land-of-bondage', 'soul-deck'];

/**
 * Destinations offered in the rail. 'battle' is deliberately excluded — the
 * Field of Battle is phase-driven and only reachable while a battle is open,
 * so it is handled by the existing drop path rather than the rail.
 */
export function legalDestinations(
  sourceZone: ZoneId,
  sourceOwner: ZoneOwner,
  format: 'T1' | 'T2' | 'Paragon',
): Array<{ zone: ZoneId; owner: ZoneOwner }> {
  const out: Array<{ zone: ZoneId; owner: ZoneOwner }> = [];

  for (const zone of MY_DESTINATIONS) {
    out.push({ zone, owner: 'my' });
  }
  for (const zone of OPPONENT_DESTINATIONS) {
    out.push({ zone, owner: 'opponent' });
  }
  if (format === 'Paragon') {
    for (const zone of SHARED_DESTINATIONS) {
      out.push({ zone, owner: 'shared' });
    }
  }

  return out.filter((d) => !(d.zone === sourceZone && d.owner === sourceOwner));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/tapToMoveCore.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/lib/tapToMoveCore.ts app/play/lib/__tests__/tapToMoveCore.test.ts
git commit -m "feat(play): tap-to-move state machine with cross-side destinations"
```

---

### Task 7: Context sheet shell and touch menu variant

**Files:**
- Create: `app/shared/components/ContextSheet.tsx`
- Modify: `app/shared/components/CardContextMenu.tsx`
- Modify: `app/shared/components/MultiCardContextMenu.tsx`
- Modify: `app/shared/components/DeckContextMenu.tsx`
- Modify: `app/shared/components/ReserveContextMenu.tsx`
- Modify: `app/shared/components/HandContextMenu.tsx`
- Modify: `app/shared/components/ZoneContextMenu.tsx`
- Modify: `app/shared/components/OpponentZoneContextMenu.tsx`
- Modify: `app/shared/components/LorContextMenu.tsx`

**Interfaces:**
- Consumes: `InputMode` from Task 1; `MobileDrawer` from `components/ui/mobile-drawer.tsx`.
- Produces: `<ContextSheet open onClose title>` — a bottom sheet that renders menu rows at touch size. Each menu component gains `variant?: 'pointer' | 'touch'` (default `'pointer'`, so every existing call site is unchanged).

**Design note:** The 1,856 lines of menu *logic* are NOT refactored. Only the outer chrome swaps. Read `app/shared/components/CardContextMenu.tsx` first to match its existing row markup before editing.

- [ ] **Step 1: Create the sheet shell**

Create `app/shared/components/ContextSheet.tsx`:

```tsx
'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface ContextSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/**
 * Bottom sheet used as the touch presentation for the board's context menus.
 *
 * Portals to <body> for the same reason MobileDrawer does: an ancestor with a
 * transform/filter becomes the containing block for fixed children and would
 * confine the backdrop, breaking tap-to-dismiss.
 *
 * Rows rendered inside should be >=44px tall; see CONTEXT_SHEET_ROW_CLASS.
 */
export function ContextSheet({ open, onClose, title, children }: ContextSheetProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed left-0 right-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto
                       rounded-t-2xl border-t border-neutral-700 bg-neutral-900
                       pb-[env(safe-area-inset-bottom)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Grab handle */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1 w-10 rounded-full bg-neutral-600" />
            </div>
            {title && (
              <div className="px-4 pb-2 pt-1 text-sm font-semibold text-neutral-200">
                {title}
              </div>
            )}
            <div className="pb-2">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Row sizing for touch: >=44px tall, 15px text. Apply to menu rows when
 *  variant === 'touch'. */
export const CONTEXT_SHEET_ROW_CLASS =
  'flex w-full items-center gap-3 px-4 py-3 text-[15px] leading-tight min-h-[44px] ' +
  'text-neutral-100 active:bg-neutral-800';
```

- [ ] **Step 2: Add the `variant` prop to `CardContextMenu`**

Read `app/shared/components/CardContextMenu.tsx`. Add to its props interface:

```ts
  /** 'pointer' renders the existing fixed-position menu. 'touch' renders the
   *  same rows inside a bottom sheet with >=44px targets. Defaults to
   *  'pointer' so every existing call site is unchanged. */
  variant?: 'pointer' | 'touch';
```

Destructure it with a default of `'pointer'`. Then wrap the component's existing returned menu element:

```tsx
  if (variant === 'touch') {
    return (
      <ContextSheet open onClose={onClose} title={card?.cardName}>
        {menuBody}
      </ContextSheet>
    );
  }
  return existingFixedPositionMenu;
```

where `menuBody` is the existing row list extracted to a local variable, and rows use `CONTEXT_SHEET_ROW_CLASS` when `variant === 'touch'`. Do not move any action handlers.

- [ ] **Step 3: Repeat for the remaining seven menus**

Apply the identical pattern to `MultiCardContextMenu`, `DeckContextMenu`, `ReserveContextMenu`, `HandContextMenu`, `ZoneContextMenu`, `OpponentZoneContextMenu`, `LorContextMenu`. In each: add the `variant` prop with the same default, extract the row list to a local, and branch on `variant`.

Also widen the inline counter buttons in `CardContextMenu` (currently `width: 22` and `width: 32`) to `44` when `variant === 'touch'`.

- [ ] **Step 4: Type-check**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors — every existing call site omits `variant` and gets `'pointer'`

- [ ] **Step 5: Verify no desktop behaviour changed**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run`
Expected: PASS — the full existing suite

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/shared/components/ContextSheet.tsx app/shared/components/CardContextMenu.tsx app/shared/components/MultiCardContextMenu.tsx app/shared/components/DeckContextMenu.tsx app/shared/components/ReserveContextMenu.tsx app/shared/components/HandContextMenu.tsx app/shared/components/ZoneContextMenu.tsx app/shared/components/OpponentZoneContextMenu.tsx app/shared/components/LorContextMenu.tsx
git commit -m "feat(play): touch variant renders context menus as bottom sheets"
```

---

### Task 8: Destination rail

**Files:**
- Create: `app/play/components/DestinationRail.tsx`

**Interfaces:**
- Consumes: `legalDestinations`, `TapMoveState`, `ZoneOwner` from Task 6; `ZONE_LABELS` from `app/shared/types/gameCard.ts`.
- Produces: `<DestinationRail state format onPick onCancel />` where `onPick(zone: ZoneId, owner: ZoneOwner): void`.

- [ ] **Step 1: Implement**

Create `app/play/components/DestinationRail.tsx`:

```tsx
'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ZONE_LABELS, type ZoneId } from '@/app/shared/types/gameCard';
import { legalDestinations, type TapMoveState, type ZoneOwner } from '@/app/play/lib/tapToMoveCore';

interface DestinationRailProps {
  state: TapMoveState;
  format: 'T1' | 'T2' | 'Paragon';
  cardName?: string;
  onPick: (zone: ZoneId, owner: ZoneOwner) => void;
  onCancel: () => void;
}

/** Short labels — the full ZONE_LABELS strings are too long for a chip. */
const SHORT_LABELS: Partial<Record<ZoneId, string>> = {
  'land-of-redemption': 'LoR',
  'land-of-bondage': 'LoB',
  'soul-deck': 'Soul Deck',
  'territory': 'Territory',
};

function label(zone: ZoneId): string {
  return SHORT_LABELS[zone] ?? ZONE_LABELS[zone];
}

/**
 * Chip bar listing every legal destination for the armed card, INCLUDING
 * destinations that are currently off-screen.
 *
 * This is the answer to the reachability problem a pan/zoom camera creates:
 * with a rail, moving a card to the opponent's side never depends on what the
 * camera happens to be showing.
 */
export function DestinationRail({
  state, format, cardName, onPick, onCancel,
}: DestinationRailProps) {
  const [side, setSide] = useState<'my' | 'opponent' | 'shared'>('my');

  const destinations = useMemo(() => {
    if (state.kind !== 'armed') return [];
    return legalDestinations(state.sourceZone, state.sourceOwner, format);
  }, [state, format]);

  const visible = destinations.filter((d) => d.owner === side);
  const hasShared = destinations.some((d) => d.owner === 'shared');

  return (
    <AnimatePresence>
      {state.kind === 'armed' && (
        <motion.div
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-40
                     border-t border-neutral-700 bg-neutral-900/95 backdrop-blur
                     pb-[env(safe-area-inset-bottom)]"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        >
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="truncate text-[13px] font-medium text-neutral-200">
              Move {cardName ?? 'card'} to…
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] min-w-[44px] px-3 text-[13px] text-neutral-400 active:text-neutral-100"
            >
              Cancel
            </button>
          </div>

          {/* Side toggle */}
          <div className="flex gap-2 px-3 pt-1">
            {(['my', 'opponent', ...(hasShared ? ['shared' as const] : [])] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={
                  'min-h-[44px] rounded-md px-3 text-[13px] font-medium ' +
                  (side === s
                    ? 'bg-neutral-700 text-neutral-50'
                    : 'text-neutral-400 active:bg-neutral-800')
                }
              >
                {s === 'my' ? 'Mine' : s === 'opponent' ? 'Theirs' : 'Shared'}
              </button>
            ))}
          </div>

          {/* Destination chips */}
          <div className="flex gap-2 overflow-x-auto px-3 py-2">
            {visible.map((d) => (
              <button
                key={`${d.owner}:${d.zone}`}
                type="button"
                onClick={() => onPick(d.zone, d.owner)}
                className="min-h-[44px] shrink-0 rounded-lg border border-neutral-600
                           bg-neutral-800 px-4 text-[14px] font-medium text-neutral-100
                           active:bg-neutral-700"
              >
                {label(d.zone)}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/components/DestinationRail.tsx
git commit -m "feat(play): camera-independent destination rail for cross-side moves"
```

---

### Task 9: Wire tap-to-move and long-press into the board

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`
- Create: `app/play/hooks/useTapToMove.ts`

**Interfaces:**
- Consumes: `tapMoveReducer`, `CommitMove` (Task 6); `useLongPress` (Task 5); `useInputMode` (Task 1); `DestinationRail` (Task 8); the existing `findZoneAtPosition` and `gameState.moveCard`.
- Produces: `useTapToMove({ onCommit }): { state, dispatch, reset }`

- [ ] **Step 1: Write the hook wrapper**

Create `app/play/hooks/useTapToMove.ts`:

```ts
'use client';

import { useState, useCallback } from 'react';
import {
  tapMoveReducer, type TapMoveState, type TapMoveEvent, type CommitMove,
} from '@/app/play/lib/tapToMoveCore';

const IDLE: TapMoveState = { kind: 'idle' };

/**
 * Thin React wrapper over the pure tapMoveReducer. All decision logic lives in
 * tapToMoveCore.ts so it stays unit-testable (vitest has no jsdom here).
 */
export function useTapToMove(onCommit: (move: CommitMove) => void) {
  const [state, setState] = useState<TapMoveState>(IDLE);

  const dispatch = useCallback((event: TapMoveEvent) => {
    setState((prev) => {
      const { state: next, commit } = tapMoveReducer(prev, event);
      if (commit) onCommit(commit);
      return next;
    });
  }, [onCommit]);

  const reset = useCallback(() => setState(IDLE), []);

  return { state, dispatch, reset };
}
```

- [ ] **Step 2: Wire into `MultiplayerCanvas.tsx`**

Add imports:

```ts
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { useTapToMove } from '@/app/play/hooks/useTapToMove';
import { useLongPress } from '@/app/play/hooks/useLongPress';
import { DestinationRail } from '@/app/play/components/DestinationRail';
import type { CommitMove } from '@/app/play/lib/tapToMoveCore';
```

Near the existing `useVirtualCanvas` call (~line 407) add:

```ts
  const inputMode = useInputMode();
  const isTouch = inputMode === 'touch';
```

Add the commit handler. It reuses the existing `gameState.moveCard` and the
same `toDbPos` normalisation the drag path uses — read `handleCardDragEnd`
(~line 3908) and mirror its coordinate handling rather than inventing new
logic:

```ts
  const handleTapMoveCommit = useCallback((move: CommitMove) => {
    const targetOwnerId = move.toOwner === 'opponent'
      ? opponentPlayerId
      : move.toOwner === 'shared' ? '' : myPlayerId;

    if (move.atPoint) {
      const rect = (move.toOwner === 'opponent' ? opponentZones : myZones)[move.toZone];
      if (!rect) return;
      const db = toDbPos(
        move.atPoint.x - cardWidth / 2,
        move.atPoint.y - cardHeight / 2,
        rect,
        move.toOwner === 'opponent' ? 'opponent' : 'my',
        { cardWidth, cardHeight },
      );
      gameState.moveCard(
        BigInt(move.cardId), move.toZone, targetOwnerId,
        String(db.x), String(db.y), '0',
      );
      return;
    }
    // Rail chip: no point, let the server/auto-arrange place it.
    gameState.moveCard(BigInt(move.cardId), move.toZone, targetOwnerId);
  }, [gameState, myZones, opponentZones, cardWidth, cardHeight, myPlayerId, opponentPlayerId]);

  const { state: tapMoveState, dispatch: tapMoveDispatch, reset: tapMoveReset } =
    useTapToMove(handleTapMoveCommit);
```

**Note for the implementer:** `myPlayerId` / `opponentPlayerId` / `toDbPos` /
`cardWidth` / `cardHeight` already exist in this component. Confirm their exact
names by reading `handleCardDragEnd` before writing this, and match them.

- [ ] **Step 3: Route taps through the state machine**

In `handleCardClick`, before the existing body, add the touch branch:

```ts
      if (isTouch) {
        tapMoveDispatch({
          type: 'tapCard',
          cardId: card.instanceId,
          zone: card.zone as ZoneId,
          owner: card.ownerId === myPlayerId ? 'my' : 'opponent',
        });
        return;
      }
```

Add a Stage-level tap handler that resolves zone taps and empty taps:

```ts
  const handleStageTap = useCallback((e: Konva.KonvaEventObject<Event>) => {
    if (!isTouch || tapMoveState.kind !== 'armed') return;
    // Taps that landed on a card are handled by handleCardClick.
    if (e.target !== e.target.getStage()) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const v = screenToVirtual(pos.x, pos.y, scale, offsetX, offsetY);
    const hit = findZoneAtPosition(v.x, v.y);
    if (!hit) {
      tapMoveDispatch({ type: 'tapEmpty' });
      return;
    }
    tapMoveDispatch({
      type: 'tapZone', zone: hit.zone as ZoneId, owner: hit.owner, point: { x: v.x, y: v.y },
    });
  }, [isTouch, tapMoveState.kind, scale, offsetX, offsetY, findZoneAtPosition, tapMoveDispatch]);
```

Add `onTap={handleStageTap}` to the `<Stage>` element. Import `screenToVirtual` from `@/app/shared/layout/virtualCanvas` (the file already imports `virtualToScreen` from there — extend that import).

- [ ] **Step 4: Wire long-press to the context menu**

Add near the other handlers:

```ts
  const openMenuFromLongPress = useCallback((card: GameCard) => (p: { x: number; y: number }) => {
    handleCardContextMenu(card, {
      evt: { clientX: p.x, clientY: p.y, preventDefault() {} },
      cancelBubble: false,
      target: null,
    } as unknown as Konva.KonvaEventObject<PointerEvent>);
  }, [handleCardContextMenu]);
```

Then in `GameCardNode`, add long-press support. Modify
`app/shared/components/GameCardNode.tsx` to accept an optional
`onLongPress?: (card: GameCard, p: { x: number; y: number }) => void` prop and,
when supplied, wire `onTouchStart` / `onTouchMove` / `onTouchEnd` through the
`useLongPress` recognizer, calling `node.stopDrag()` before firing so no ghost
drag lingers.

- [ ] **Step 5: Render the rail**

Just before the closing `</div>` of the container in `MultiplayerCanvas.tsx`, add:

```tsx
      {isTouch && (
        <DestinationRail
          state={tapMoveState}
          format={normalizedFormat}
          cardName={
            tapMoveState.kind === 'armed'
              ? allCards.find((c) => c.instanceId === tapMoveState.cardId)?.cardName
              : undefined
          }
          onPick={(zone, owner) => tapMoveDispatch({ type: 'tapDestinationChip', zone, owner })}
          onCancel={tapMoveReset}
        />
      )}
```

**Note:** confirm the correct in-scope variable for the full card list
(`allCards` above is a placeholder name) by reading the component; use whatever
collection `handleCardClick` can already see.

- [ ] **Step 6: Type-check**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Manual smoke test**

Run `npm run dev` in the worktree, open `http://localhost:3000/play?input=touch`, start a goldfish/waiting-room board, and confirm: desktop mouse still behaves exactly as before with `?input=pointer`; with `?input=touch` a click arms a card and shows the rail.

- [ ] **Step 8: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/hooks/useTapToMove.ts app/play/components/MultiplayerCanvas.tsx app/shared/components/GameCardNode.tsx
git commit -m "feat(play): wire tap-to-move and long-press menus into the board"
```

---

# Phase 2 — Camera

---

### Task 10: Jump targets

**Files:**
- Create: `app/play/lib/jumpTargets.ts`
- Create: `app/play/lib/__tests__/jumpTargets.test.ts`

**Interfaces:**
- Consumes: `unionRects`, `Rect` from `app/shared/layout/camera.ts`.
- Produces:
  - `type JumpTargetId = 'fit' | 'my-side' | 'opponent-side' | 'battle'`
  - `buildJumpTargets(zones, battleRect, virtualWidth): Array<{ id: JumpTargetId; label: string; rect: Rect | null }>`

- [ ] **Step 1: Write the failing test**

Create `app/play/lib/__tests__/jumpTargets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildJumpTargets } from '../jumpTargets';

const zones = {
  my: {
    hand:                  { x: 0,    y: 900, width: 1600, height: 180 },
    territory:             { x: 0,    y: 560, width: 1600, height: 300 },
    'land-of-bondage':     { x: 0,    y: 860, width: 1600, height: 40 },
    deck:                  { x: 1600, y: 700, width: 320,  height: 180 },
  },
  opponent: {
    hand:                  { x: 0,    y: 0,   width: 1600, height: 80 },
    territory:             { x: 0,    y: 170, width: 1600, height: 300 },
    'land-of-bondage':     { x: 0,    y: 80,  width: 1600, height: 90 },
    deck:                  { x: 1600, y: 100, width: 320,  height: 180 },
  },
};

describe('buildJumpTargets', () => {
  it('always offers fit spanning the whole board', () => {
    const t = buildJumpTargets(zones, null, 1920);
    const fit = t.find((x) => x.id === 'fit');
    expect(fit?.rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('spans my whole side, not just my territory', () => {
    // The point of "side" over "territory": it must include the hand, the
    // Land of Bondage and the sidebar piles.
    const t = buildJumpTargets(zones, null, 1920);
    const mine = t.find((x) => x.id === 'my-side')!.rect!;
    expect(mine.y).toBe(560);
    expect(mine.y + mine.height).toBe(1080);
    expect(mine.x + mine.width).toBe(1920); // includes the sidebar pile
  });

  it('spans the opponent whole side', () => {
    const t = buildJumpTargets(zones, null, 1920);
    const opp = t.find((x) => x.id === 'opponent-side')!.rect!;
    expect(opp.y).toBe(0);
    expect(opp.x + opp.width).toBe(1920);
    expect(opp.y + opp.height).toBe(470);
  });

  it('omits battle when no band is active', () => {
    const t = buildJumpTargets(zones, null, 1920);
    expect(t.some((x) => x.id === 'battle')).toBe(false);
  });

  it('includes battle when a band is active', () => {
    const band = { x: 0, y: 470, width: 1600, height: 90 };
    const t = buildJumpTargets(zones, band, 1920);
    expect(t.find((x) => x.id === 'battle')?.rect).toEqual(band);
  });

  it('tolerates missing zones', () => {
    const t = buildJumpTargets({ my: {}, opponent: {} }, null, 1920);
    expect(t.find((x) => x.id === 'my-side')?.rect).toBeNull();
    expect(t.find((x) => x.id === 'fit')?.rect).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/jumpTargets.test.ts`
Expected: FAIL — cannot resolve `../jumpTargets`

- [ ] **Step 3: Implement**

Create `app/play/lib/jumpTargets.ts`:

```ts
/**
 * Camera jump targets.
 *
 * Deliberately "side", not "territory": what a player controls is spread
 * across their hand, territory, Land of Bondage and sidebar piles, so jumping
 * to territory alone would hide most of what the opponent controls.
 */

import { unionRects, type Rect } from '@/app/shared/layout/camera';
import { VIRTUAL_HEIGHT } from '@/app/shared/layout/virtualCanvas';

export type JumpTargetId = 'fit' | 'my-side' | 'opponent-side' | 'battle';

export interface JumpTarget {
  id: JumpTargetId;
  label: string;
  rect: Rect | null;
}

type ZoneMap = Record<string, Rect>;

export function buildJumpTargets(
  zones: { my: ZoneMap; opponent: ZoneMap },
  battleRect: Rect | null,
  virtualWidth: number,
): JumpTarget[] {
  const mine = unionRects(Object.values(zones.my));
  const theirs = unionRects(Object.values(zones.opponent));

  const targets: JumpTarget[] = [
    { id: 'fit', label: 'Fit', rect: { x: 0, y: 0, width: virtualWidth, height: VIRTUAL_HEIGHT } },
    { id: 'opponent-side', label: 'Opponent', rect: theirs },
    { id: 'my-side', label: 'Mine', rect: mine },
  ];

  if (battleRect) {
    targets.push({ id: 'battle', label: 'Battle', rect: battleRect });
  }

  return targets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/jumpTargets.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/lib/jumpTargets.ts app/play/lib/__tests__/jumpTargets.test.ts
git commit -m "feat(play): side-based camera jump targets"
```

---

### Task 11: Gesture classification

**Files:**
- Create: `app/play/lib/gestureCore.ts`
- Create: `app/play/lib/__tests__/gestureCore.test.ts`

**Interfaces:**
- Produces:
  - `interface PointerSample { id: number; x: number; y: number }`
  - `type GestureKind = 'none' | 'pan' | 'pinch'`
  - `classifyGesture(pointers: PointerSample[]): GestureKind`
  - `pinchMetrics(a: PointerSample, b: PointerSample): { distance: number; midX: number; midY: number }`
  - `pinchZoomDelta(startDistance: number, currentDistance: number): number`

- [ ] **Step 1: Write the failing test**

Create `app/play/lib/__tests__/gestureCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyGesture, pinchMetrics, pinchZoomDelta } from '../gestureCore';

describe('classifyGesture', () => {
  it('is none with no pointers', () => {
    expect(classifyGesture([])).toBe('none');
  });

  it('is pan with one pointer', () => {
    expect(classifyGesture([{ id: 1, x: 0, y: 0 }])).toBe('pan');
  });

  it('is pinch with two pointers', () => {
    expect(classifyGesture([{ id: 1, x: 0, y: 0 }, { id: 2, x: 10, y: 10 }])).toBe('pinch');
  });

  it('is pinch with more than two pointers, using the first two', () => {
    expect(classifyGesture([
      { id: 1, x: 0, y: 0 }, { id: 2, x: 10, y: 10 }, { id: 3, x: 20, y: 20 },
    ])).toBe('pinch');
  });
});

describe('pinchMetrics', () => {
  it('computes distance and midpoint', () => {
    const m = pinchMetrics({ id: 1, x: 0, y: 0 }, { id: 2, x: 6, y: 8 });
    expect(m.distance).toBe(10);
    expect(m.midX).toBe(3);
    expect(m.midY).toBe(4);
  });
});

describe('pinchZoomDelta', () => {
  it('is 1 when the distance is unchanged', () => {
    expect(pinchZoomDelta(100, 100)).toBe(1);
  });

  it('is >1 when fingers spread', () => {
    expect(pinchZoomDelta(100, 200)).toBe(2);
  });

  it('is <1 when fingers pinch together', () => {
    expect(pinchZoomDelta(200, 100)).toBe(0.5);
  });

  it('guards against a zero start distance', () => {
    expect(pinchZoomDelta(0, 100)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/gestureCore.test.ts`
Expected: FAIL — cannot resolve `../gestureCore`

- [ ] **Step 3: Implement**

Create `app/play/lib/gestureCore.ts`:

```ts
/**
 * Pure gesture classification for the board camera. Kept separate from the
 * React/Konva wiring so the arbitration rules are unit-testable.
 */

export interface PointerSample {
  id: number;
  x: number;
  y: number;
}

export type GestureKind = 'none' | 'pan' | 'pinch';

/** One finger pans the camera; two or more pinch. A second finger arriving
 *  mid-drag promotes the interaction to a pinch — the caller cancels the card
 *  drag and restores the card when that happens. */
export function classifyGesture(pointers: PointerSample[]): GestureKind {
  if (pointers.length === 0) return 'none';
  if (pointers.length === 1) return 'pan';
  return 'pinch';
}

export function pinchMetrics(a: PointerSample, b: PointerSample) {
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  };
}

/** Multiplicative zoom factor for a pinch. Guards a zero start distance,
 *  which happens when both touches land on the same pixel. */
export function pinchZoomDelta(startDistance: number, currentDistance: number): number {
  if (startDistance <= 0) return 1;
  return currentDistance / startDistance;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/gestureCore.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/lib/gestureCore.ts app/play/lib/__tests__/gestureCore.test.ts
git commit -m "feat(play): pure gesture classification for the board camera"
```

---

### Task 12: `useBoardCamera` and Stage gesture wiring

**Files:**
- Create: `app/play/hooks/useBoardCamera.ts`
- Modify: `app/play/components/MultiplayerCanvas.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2, 10, 11.
- Produces: `useBoardCamera({ fitScale, virtualWidth, containerWidth, containerHeight }): { camera, setCamera, jumpTo(rect), reset, onPointersChange, isZoomed }`

- [ ] **Step 1: Implement the hook**

Create `app/play/hooks/useBoardCamera.ts`:

```ts
'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  defaultCamera, clampCamera, fitRectToViewport, zoomAtPoint,
  MIN_ZOOM, type Camera, type Rect,
} from '@/app/shared/layout/camera';
import {
  classifyGesture, pinchMetrics, pinchZoomDelta, type PointerSample,
} from '@/app/play/lib/gestureCore';

interface UseBoardCameraArgs {
  fitScale: number;
  virtualWidth: number;
  containerWidth: number;
  containerHeight: number;
  enabled: boolean;
}

export function useBoardCamera({
  fitScale, virtualWidth, containerWidth, containerHeight, enabled,
}: UseBoardCameraArgs) {
  const [camera, setCameraRaw] = useState<Camera>(() => defaultCamera(virtualWidth));

  // Re-centre when the virtual width changes (rotation, resize).
  useEffect(() => {
    setCameraRaw((c) => (c.zoom === MIN_ZOOM ? defaultCamera(virtualWidth) : c));
  }, [virtualWidth]);

  const setCamera = useCallback((next: Camera) => {
    if (fitScale <= 0) return;
    setCameraRaw(clampCamera(next, fitScale, virtualWidth, containerWidth, containerHeight));
  }, [fitScale, virtualWidth, containerWidth, containerHeight]);

  const jumpTo = useCallback((rect: Rect) => {
    if (fitScale <= 0) return;
    setCameraRaw(fitRectToViewport(rect, fitScale, virtualWidth, containerWidth, containerHeight));
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

  /** Feed the current set of active pointers (screen coords) each frame. */
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
    // Anchor on the pinch midpoint in virtual space.
    const anchorVX = camera.centerX + (m.midX - containerWidth / 2) / scale;
    const anchorVY = camera.centerY + (m.midY - containerHeight / 2) / scale;
    setCamera(zoomAtPoint(camera, nextZoom, anchorVX, anchorVY));
  }, [enabled, fitScale, camera, containerWidth, containerHeight, setCamera]);

  const isZoomed = useMemo(() => camera.zoom > MIN_ZOOM + 1e-6, [camera.zoom]);

  return { camera: enabled ? camera : null, setCamera, jumpTo, reset, onPointersChange, isZoomed };
}
```

- [ ] **Step 2: Wire into `MultiplayerCanvas.tsx`**

The camera must be created BEFORE `useVirtualCanvas` consumes it, but it needs
`fitScale` FROM `useVirtualCanvas`. Break the cycle by calling
`useVirtualCanvas` twice is wrong — instead, call it once with `null`, read
`fitScale`, then compose manually. Replace the existing line 407 call with:

```ts
  const fit = useVirtualCanvas(containerRef);
  const {
    camera, jumpTo, reset: resetCamera, onPointersChange, isZoomed,
  } = useBoardCamera({
    fitScale: fit.fitScale,
    virtualWidth: fit.virtualWidth,
    containerWidth: fit.containerWidth,
    containerHeight: fit.containerHeight,
    enabled: isTouch,
  });
  const { scale, offsetX, offsetY } = applyCameraToScale(
    fit, camera, fit.containerWidth, fit.containerHeight,
  );
  const { containerWidth, containerHeight, virtualWidth } = fit;
```

Import `applyCameraToScale` from `@/app/shared/layout/virtualCanvas` and
`useBoardCamera` from `@/app/play/hooks/useBoardCamera`.

- [ ] **Step 3: Feed pointers from the Stage**

Add Stage touch handlers that collect active touches in screen coordinates
(relative to the container) and call `onPointersChange`:

```ts
  const collectPointers = useCallback((evt: TouchEvent): PointerSample[] => {
    const stage = stageRef.current;
    if (!stage) return [];
    const box = stage.container().getBoundingClientRect();
    return Array.from(evt.touches).map((t, i) => ({
      id: t.identifier ?? i,
      x: t.clientX - box.left,
      y: t.clientY - box.top,
    }));
  }, []);
```

Wire `onTouchStart` / `onTouchMove` / `onTouchEnd` on the `<Stage>` so that
they call `onPointersChange(collectPointers(e.evt))` **only when the touch did
not start on a card** (`e.target === e.target.getStage()`), so card drags are
untouched.

- [ ] **Step 4: Add double-tap-to-fit on empty space**

Add `onDblTap` to the `<Stage>`:

```ts
  const handleStageDblTap = useCallback((e: Konva.KonvaEventObject<Event>) => {
    if (!isTouch) return;
    if (e.target !== e.target.getStage()) return;  // card dbl-tap = meek
    if (isZoomed) resetCamera();
  }, [isTouch, isZoomed, resetCamera]);
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Verify desktop is untouched**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run`
Expected: PASS. With `enabled: false` on pointer devices, `camera` is `null` and
`applyCameraToScale` returns the fit transform unchanged.

- [ ] **Step 7: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/hooks/useBoardCamera.ts app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): pinch/pan board camera wired to the stage"
```

---

### Task 13: Touch controls and the test hook

**Files:**
- Create: `app/play/components/TouchControls.tsx`
- Modify: `app/play/components/MultiplayerCanvas.tsx`

**Interfaces:**
- Consumes: `buildJumpTargets` (Task 10), `jumpTo`/`isZoomed` (Task 12).
- Produces: `<TouchControls targets onJump activeId />`; and `window.__mpCamera` in non-production builds.

- [ ] **Step 1: Implement the control cluster**

Create `app/play/components/TouchControls.tsx`:

```tsx
'use client';

import React from 'react';
import type { JumpTarget, JumpTargetId } from '@/app/play/lib/jumpTargets';

interface TouchControlsProps {
  targets: JumpTarget[];
  onJump: (target: JumpTarget) => void;
  activeId: JumpTargetId | null;
}

/**
 * Camera jump cluster. Every button is >=44x44 (WCAG 2.5.5 / Apple HIG) —
 * unlike GameToolbar, which is sized for a mouse.
 */
export function TouchControls({ targets, onJump, activeId }: TouchControlsProps) {
  return (
    <div
      className="pointer-events-auto absolute right-2 top-2 z-30 flex flex-col gap-1
                 rounded-lg border border-neutral-700 bg-neutral-900/90 p-1 backdrop-blur"
      style={{ paddingRight: 'env(safe-area-inset-right)' }}
      data-testid="touch-controls"
    >
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={!t.rect}
          onClick={() => t.rect && onJump(t)}
          data-testid={`jump-${t.id}`}
          className={
            'min-h-[44px] min-w-[44px] rounded-md px-3 text-[13px] font-medium ' +
            'disabled:opacity-40 ' +
            (activeId === t.id
              ? 'bg-neutral-700 text-neutral-50'
              : 'text-neutral-300 active:bg-neutral-800')
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Render it and expose the test hook**

In `MultiplayerCanvas.tsx`, build the targets and render the cluster when
`isTouch`:

```tsx
  const jumpTargets = useMemo(
    () => buildJumpTargets(
      { my: myZones as Record<string, Rect>, opponent: opponentZones as Record<string, Rect> },
      battleActive ? (mpLayout?.zones.battle ?? null) : null,
      virtualWidth,
    ),
    [myZones, opponentZones, battleActive, mpLayout, virtualWidth],
  );
```

```tsx
      {isTouch && (
        <TouchControls
          targets={jumpTargets}
          onJump={(t) => t.rect && jumpTo(t.rect)}
          activeId={isZoomed ? null : 'fit'}
        />
      )}
```

Add the test hook so Playwright can drive the camera without synthesising
gestures:

```ts
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as any).__mpCamera = {
      get: () => camera,
      jumpTo: (id: string) => {
        const t = jumpTargets.find((x) => x.id === id);
        if (t?.rect) jumpTo(t.rect);
      },
      reset: resetCamera,
    };
    return () => { delete (window as any).__mpCamera; };
  }, [camera, jumpTargets, jumpTo, resetCamera]);
```

- [ ] **Step 3: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/components/TouchControls.tsx app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): camera jump controls and __mpCamera test hook"
```

---

# Phase 3 — Phone layout profile

---

### Task 14: `TOUCH_PROFILE`

**Files:**
- Modify: `app/play/layout/multiplayerLayout.ts`
- Create: `app/play/layout/__tests__/multiplayerLayout.touch.test.ts`

**Interfaces:**
- Produces: `calculateMultiplayerLayout(stageWidth, stageHeight, format, viewerKind, battleActive, compact = false)` — a sixth optional parameter. `compact: true` selects `TOUCH_PROFILE`.

- [ ] **Step 1: Write the failing test**

Create `app/play/layout/__tests__/multiplayerLayout.touch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateMultiplayerLayout } from '../multiplayerLayout';

describe('TOUCH_PROFILE', () => {
  it('produces larger cards than the default profile at the same size', () => {
    const normal  = calculateMultiplayerLayout(1440, 1080, 'T1', 'player', false, false);
    const compact = calculateMultiplayerLayout(1440, 1080, 'T1', 'player', false, true);
    expect(compact.mainCard.cardWidth).toBeGreaterThan(normal.mainCard.cardWidth);
  });

  it('gives more width to the play area by shrinking the sidebar', () => {
    const normal  = calculateMultiplayerLayout(1440, 1080, 'T1', 'player', false, false);
    const compact = calculateMultiplayerLayout(1440, 1080, 'T1', 'player', false, true);
    expect(compact.playAreaWidth).toBeGreaterThan(normal.playAreaWidth);
  });

  it('keeps every zone inside the stage', () => {
    const l = calculateMultiplayerLayout(1440, 1080, 'T1', 'player', false, true);
    for (const [key, r] of Object.entries(l.zones)) {
      if (!r) continue;
      expect(r.x, `${key}.x`).toBeGreaterThanOrEqual(0);
      expect(r.y, `${key}.y`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width,  `${key} right`).toBeLessThanOrEqual(1440 + 1);
      expect(r.y + r.height, `${key} bottom`).toBeLessThanOrEqual(1080 + 1);
    }
  });

  it('leaves vertical room for a full card row in each territory', () => {
    const l = calculateMultiplayerLayout(1440, 1080, 'T1', 'player', false, true);
    expect(l.zones.territory.height).toBeGreaterThanOrEqual(l.mainCard.cardHeight);
    expect(l.zones.oppTerritory.height).toBeGreaterThanOrEqual(l.mainCard.cardHeight);
  });

  it('does not change the default profile', () => {
    const before = calculateMultiplayerLayout(1920, 1080, 'T1', 'player', false);
    const after  = calculateMultiplayerLayout(1920, 1080, 'T1', 'player', false, false);
    expect(after).toEqual(before);
  });
});
```

**Note for the implementer:** the exact zone keys in `l.zones` (e.g.
`territory` vs `oppTerritory`) must be confirmed by reading
`multiplayerLayout.ts`'s `MultiplayerLayout` interface. Fix the test's key
names to match the real ones before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/layout/__tests__/multiplayerLayout.touch.test.ts`
Expected: FAIL — `calculateMultiplayerLayout` ignores the sixth argument, so the compact and normal layouts are identical

- [ ] **Step 3: Add the profile**

In `app/play/layout/multiplayerLayout.ts`, add after `STANDARD_PROFILE` (~line 145):

```ts
/**
 * Compact touch profile — phone landscape.
 *
 * Physical card width is containerWidth x (1 - sidebarWidthRatio) x
 * mainCardWidthRatio; VIRTUAL_HEIGHT cancels out of that expression, so the
 * only levers are the sidebar ratio and the card ratio. This profile shrinks
 * the sidebar to an icon rail and enlarges cards, taking the vertical budget
 * from the opponent's hand (a strip of card backs, of little value) and
 * giving it to the two territories.
 */
const TOUCH_PROFILE: LayoutProfile = {
  sidebarWidthRatio: 0.10,   // icon rail; tapping a pile opens a sheet
  oppHandRatio: 0.05,        // thin strip of backs
  oppTerritoryRatio: 0.30,
  oppLobRatio: 0.085,
  dividerRatio: 0.005,
  playerLobRatio: 0.085,
  playerTerritoryRatio: 0.30,
  playerHandRatio: 0.175,
  mainCardWidthRatio: 0.078, // ~57px on an iPhone 14 Pro landscape
  oppHandScale: 0.55,
  pileLabelRatio: 0.14,
};
// Sum check: 0.05 + 0.30 + 0.085 + 0.005 + 0.085 + 0.30 + 0.175 = 1.0 ✓
```

Change `getProfile` to:

```ts
function getProfile(virtualWidth: number, compact = false): LayoutProfile {
  if (compact) return TOUCH_PROFILE;
  return virtualWidth <= BREAKPOINT_WIDTH ? NARROW_PROFILE : STANDARD_PROFILE;
}
```

Change the `calculateMultiplayerLayout` signature and its `getProfile` call:

```ts
export function calculateMultiplayerLayout(
  stageWidth: number,
  stageHeight: number,
  format: 'T1' | 'T2' | 'Paragon' = 'T1',
  viewerKind: 'player' | 'spectator' = 'player',
  battleActive = false,
  compact = false,
): MultiplayerLayout {
  const baseProfile = getProfile(stageWidth, compact);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/layout/`
Expected: PASS — new tests plus the existing `multiplayerLayout.battle.test.ts` and `lobClassification.test.ts`

- [ ] **Step 5: Select the profile in the canvas**

In `MultiplayerCanvas.tsx`, find the existing `calculateMultiplayerLayout` call
and pass the compact flag:

```ts
  const useCompactLayout = isTouch && containerHeight < 500;
```

Append `useCompactLayout` as the sixth argument. Add it to that `useMemo`'s
dependency array.

- [ ] **Step 6: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/layout/multiplayerLayout.ts app/play/layout/__tests__/multiplayerLayout.touch.test.ts app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): compact touch layout profile for phone landscape"
```

---

### Task 15: Orientation gate

**Files:**
- Create: `app/play/lib/orientationGate.ts`
- Create: `app/play/lib/__tests__/orientationGate.test.ts`
- Create: `app/play/components/RotateDevicePrompt.tsx`
- Modify: `app/play/[code]/client.tsx`

**Interfaces:**
- Produces: `shouldGateForPortrait(width, height, inputMode): boolean`; `<RotateDevicePrompt />`

- [ ] **Step 1: Write the failing test**

Create `app/play/lib/__tests__/orientationGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldGateForPortrait } from '../orientationGate';

describe('shouldGateForPortrait', () => {
  it('gates a phone in portrait', () => {
    expect(shouldGateForPortrait(393, 852, 'touch')).toBe(true);
  });

  it('does not gate a phone in landscape', () => {
    expect(shouldGateForPortrait(852, 393, 'touch')).toBe(false);
  });

  it('does not gate an iPad in portrait — it letterboxes but works', () => {
    expect(shouldGateForPortrait(834, 1112, 'touch')).toBe(false);
  });

  it('never gates a pointer device, however narrow the window', () => {
    expect(shouldGateForPortrait(400, 900, 'pointer')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/orientationGate.test.ts`
Expected: FAIL — cannot resolve `../orientationGate`

- [ ] **Step 3: Implement**

Create `app/play/lib/orientationGate.ts`:

```ts
import type { InputMode } from '@/app/shared/layout/inputMode';

/** Below this width, a portrait board is structurally broken rather than
 *  merely tight: RightPanel's 280px floor leaves ~113px of canvas. iPad
 *  portrait (834px) stays above the line and is allowed through. */
export const PORTRAIT_GATE_MAX_WIDTH = 700;

export function shouldGateForPortrait(
  width: number,
  height: number,
  inputMode: InputMode,
): boolean {
  if (inputMode !== 'touch') return false;
  return width < height && width < PORTRAIT_GATE_MAX_WIDTH;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run app/play/lib/__tests__/orientationGate.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Build the prompt**

Create `app/play/components/RotateDevicePrompt.tsx`:

```tsx
'use client';

import React from 'react';
import { RotateCcw } from 'lucide-react';

export function RotateDevicePrompt() {
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center
                 gap-4 bg-neutral-950 px-8 text-center"
      data-testid="rotate-device-prompt"
    >
      <RotateCcw className="h-12 w-12 text-neutral-400" aria-hidden />
      <h1 className="text-xl font-semibold text-neutral-100">Rotate your device</h1>
      <p className="max-w-xs text-sm text-neutral-400">
        Redemption plays in landscape — there isn&apos;t enough width in portrait
        to show both sides of the board.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Gate the game shell**

In `app/play/[code]/client.tsx`, at the main game render (~line 1799), add
above the returned tree:

```tsx
  const inputMode = useInputMode();
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  if (shouldGateForPortrait(viewport.w, viewport.h, inputMode)) {
    return <RotateDevicePrompt />;
  }
```

**Important:** place this AFTER all other hooks in the component so hook order
stays stable across renders.

- [ ] **Step 7: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add app/play/lib/orientationGate.ts app/play/lib/__tests__/orientationGate.test.ts app/play/components/RotateDevicePrompt.tsx "app/play/[code]/client.tsx"
git commit -m "feat(play): gate phone portrait behind a rotate prompt"
```

---

### Task 16: Reclaim canvas space on touch

**Files:**
- Modify: `app/play/[code]/client.tsx`
- Modify: `app/play/components/RightPanel.tsx`
- Modify: `app/shared/components/GameToolbar.tsx`

- [ ] **Step 1: Make `RightPanel` a sheet on touch**

In `RightPanel.tsx`, add a `variant?: 'sidebar' | 'sheet'` prop defaulting to
`'sidebar'`. When `'sheet'`, render the panel contents inside `ContextSheet`
(Task 7) triggered by a chat/preview button, rather than as a flex sibling.
Keep `PANEL_EXPANDED_WIDTH` and `PANEL_COLLAPSED_WIDTH` for the sidebar path.

This is the single biggest width win: at its 280px floor, the panel consumes
71% of a 393px viewport.

- [ ] **Step 2: Overlay the turn indicator on touch**

In `app/play/[code]/client.tsx`, the `TurnIndicator` currently sits in a
`flexShrink: 0, height: 48` div, permanently consuming 48px of the height that
`scale` is derived from. When `isTouch`, render it absolutely positioned over
the canvas instead so the board gets the full height (a ~14% gain on a phone):

```tsx
  {isTouch ? (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
                  paddingTop: 'env(safe-area-inset-top)', pointerEvents: 'none' }}>
      <TurnIndicator {...turnIndicatorProps} />
    </div>
  ) : (
    <div style={{ flexShrink: 0, height: 48 }}>
      <TurnIndicator {...turnIndicatorProps} />
    </div>
  )}
```

- [ ] **Step 3: Honour safe-area insets**

On the outermost game shell div, add:

```tsx
    paddingLeft: 'env(safe-area-inset-left)',
    paddingRight: 'env(safe-area-inset-right)',
```

so the landscape notch does not overlap the board.

- [ ] **Step 4: Size `GameToolbar` for touch**

In `GameToolbar.tsx`, accept `variant?: 'pointer' | 'touch'`. When `'touch'`:
buttons get `minWidth: 44, minHeight: 44`, icons `size={22}`, and the
`fontSize: 8` labels are dropped entirely (unreadable at that size) in favour
of icon-only buttons with `aria-label`. Keep the pointer path byte-identical.

- [ ] **Step 5: Type-check and commit**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx tsc --noEmit`
Expected: no new errors

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add "app/play/[code]/client.tsx" app/play/components/RightPanel.tsx app/shared/components/GameToolbar.tsx
git commit -m "feat(play): reclaim canvas width and height on touch layouts"
```

---

# Phase 4 — Validation

Research basis: single-signal UI validation fails (pixel diffs catch movement but
miss intent; LLM critique still trails human experts), so this is four layers with
the LLM never the sole judge and every finding tied to a screenshot.

---

### Task 17: Layer 1 — deterministic assertions

**Files:**
- Create: `e2e/mobile/layoutRules.ts`
- Create: `e2e/mobile/__tests__/layoutRules.test.ts`
- Create: `e2e/mobile/layout-rules.spec.ts`

**Interfaces:**
- Produces: `checkTargetSize(box)`, `checkFontSize(px)`, `MIN_TARGET_PX = 44`, `ABSOLUTE_MIN_TARGET_PX = 24`, `MIN_FONT_PX = 11`

- [ ] **Step 1: Write the failing test**

Create `e2e/mobile/__tests__/layoutRules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  checkTargetSize, checkFontSize,
  MIN_TARGET_PX, ABSOLUTE_MIN_TARGET_PX, MIN_FONT_PX,
} from '../layoutRules';

describe('checkTargetSize', () => {
  it('passes a 44x44 target', () => {
    expect(checkTargetSize({ width: 44, height: 44 }).ok).toBe(true);
  });

  it('passes a larger target', () => {
    expect(checkTargetSize({ width: 80, height: 50 }).ok).toBe(true);
  });

  it('flags a target under the AA floor as an error', () => {
    const r = checkTargetSize({ width: 20, height: 20 });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('error');
  });

  it('flags a target between the AA floor and the AAA target as a warning', () => {
    const r = checkTargetSize({ width: 30, height: 30 });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe('warning');
  });
});

describe('checkFontSize', () => {
  it('passes 11px and above', () => {
    expect(checkFontSize(11).ok).toBe(true);
    expect(checkFontSize(15).ok).toBe(true);
  });

  it('flags 8px — the current GameToolbar label size', () => {
    expect(checkFontSize(8).ok).toBe(false);
  });
});

describe('thresholds', () => {
  it('match the documented standards', () => {
    expect(MIN_TARGET_PX).toBe(44);          // WCAG 2.5.5 AAA / Apple HIG
    expect(ABSOLUTE_MIN_TARGET_PX).toBe(24); // WCAG 2.5.8 AA
    expect(MIN_FONT_PX).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run e2e/mobile/__tests__/layoutRules.test.ts`
Expected: FAIL — cannot resolve `../layoutRules`

- [ ] **Step 3: Implement**

Create `e2e/mobile/layoutRules.ts`:

```ts
/**
 * Deterministic layout rules, kept pure so they are unit-tested by vitest and
 * reused by the Playwright spec.
 *
 * Standards:
 *   WCAG 2.5.8 (AA)  — 24x24 CSS px minimum, or 24px spacing
 *   WCAG 2.5.5 (AAA) — 44x44 CSS px
 *   Apple HIG 44x44pt, Material 48x48dp
 *
 * Game cards themselves take the WCAG "essential" exception on rendered size,
 * but their tap hit-region must still meet MIN_TARGET_PX.
 */

export const MIN_TARGET_PX = 44;
export const ABSOLUTE_MIN_TARGET_PX = 24;
export const MIN_FONT_PX = 11;

export interface RuleResult {
  ok: boolean;
  severity: 'error' | 'warning' | null;
  message: string;
}

const PASS: RuleResult = { ok: true, severity: null, message: '' };

export function checkTargetSize(box: { width: number; height: number }): RuleResult {
  const min = Math.min(box.width, box.height);
  if (min >= MIN_TARGET_PX) return PASS;
  if (min < ABSOLUTE_MIN_TARGET_PX) {
    return {
      ok: false,
      severity: 'error',
      message: `target ${box.width}x${box.height} is below the WCAG 2.5.8 AA floor of ${ABSOLUTE_MIN_TARGET_PX}px`,
    };
  }
  return {
    ok: false,
    severity: 'warning',
    message: `target ${box.width}x${box.height} is below the ${MIN_TARGET_PX}px AAA target`,
  };
}

export function checkFontSize(px: number): RuleResult {
  if (px >= MIN_FONT_PX) return PASS;
  return {
    ok: false,
    severity: 'error',
    message: `font size ${px}px is below the ${MIN_FONT_PX}px legibility floor`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-mobile-touch && npx vitest run e2e/mobile/__tests__/layoutRules.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Write the Playwright spec**

Create `e2e/mobile/layout-rules.spec.ts` that, for each of the viewports
`{ 852x393, 1133x744, 1024x768 }`, loads a seeded game with `?input=touch`,
then asserts:

- every `button`, `[role="button"]` and `a` inside the game shell passes
  `checkTargetSize` at `severity: 'error'` level;
- no rendered text is below `MIN_FONT_PX`;
- `document.documentElement.scrollWidth <= clientWidth` (no horizontal scroll);
- `window.__mpCamera.get().zoom === 1` on load.

Reuse the existing seeding helpers in `e2e/seed.ts` and `e2e/fixtures.ts` —
read them first and follow their patterns rather than inventing new auth.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add e2e/mobile/layoutRules.ts e2e/mobile/__tests__/layoutRules.test.ts e2e/mobile/layout-rules.spec.ts
git commit -m "test(play): deterministic mobile layout rules"
```

---

### Task 18: Layer 2 — screenshot matrix harness

**Files:**
- Create: `e2e/mobile/touchGestures.ts`
- Create: `scripts/mobile-shots.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `pinch(page, opts)`, `tapAt(page, x, y)`, `swipe(page, from, to)`; `npm run shots:mobile`

- [ ] **Step 1: Write the CDP gesture helpers**

Create `e2e/mobile/touchGestures.ts`:

```ts
import type { Page } from '@playwright/test';

/**
 * Multi-touch gestures via CDP. Playwright's own touch API is single-point, so
 * pinch requires Input.dispatchTouchEvent directly (Chromium only).
 * Input.synthesizePinchGesture also exists but is marked experimental and is
 * reported flaky in CI, so it is avoided here.
 */

interface TouchPoint { x: number; y: number }

export async function pinch(
  page: Page,
  opts: { center: TouchPoint; startRadius: number; endRadius: number; steps?: number },
) {
  const { center, startRadius, endRadius, steps = 10 } = opts;
  const cdp = await page.context().newCDPSession(page);

  const points = (r: number) => ([
    { x: center.x - r, y: center.y },
    { x: center.x + r, y: center.y },
  ]);

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: points(startRadius),
  });

  for (let i = 1; i <= steps; i++) {
    const r = startRadius + ((endRadius - startRadius) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: points(r),
    });
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function tapAt(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function longPressAt(page: Page, x: number, y: number, ms = 600) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function swipe(page: Page, from: TouchPoint, to: TouchPoint, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
```

- [ ] **Step 2: Write the screenshot harness**

Create `scripts/mobile-shots.ts` — a standalone Playwright script that iterates
`VIEWPORTS × BOARD_STATES × CAMERA_STATES`, writes PNGs to
`.artifacts/mobile-shots/<viewport>__<state>__<camera>.png`, and writes a
`manifest.json` alongside recording, for each shot: viewport, board state,
camera state, route, and the design intent for that combination.

```ts
const VIEWPORTS = [
  { name: 'iphone-14-pro-landscape', width: 852,  height: 393 },
  { name: 'iphone-se-landscape',     width: 667,  height: 375 },
  { name: 'ipad-mini-landscape',     width: 1133, height: 744 },
  { name: 'ipad-pro-11-landscape',   width: 1194, height: 834 },
  { name: 'iphone-14-pro-portrait',  width: 393,  height: 852 },
  { name: 'desktop-baseline',        width: 1920, height: 1080 },
];

const CAMERA_STATES = ['fit', 'my-side', 'opponent-side'];
```

Drive the camera through `window.__mpCamera.jumpTo(id)` rather than gestures,
so screenshots stay deterministic. The manifest is what lets the critique
agents cite `(screenshot, viewport, state)` for every finding.

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `scripts`:

```json
    "shots:mobile": "npx tsx scripts/mobile-shots.ts"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add e2e/mobile/touchGestures.ts scripts/mobile-shots.ts package.json
git commit -m "test(play): CDP touch gestures and mobile screenshot matrix harness"
```

---

### Task 19: Layer 3 — task-driven play specs

**Files:**
- Create: `e2e/mobile/touch-play.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Write the task specs**

Create `e2e/mobile/touch-play.spec.ts` covering the spec's success criteria as
literal user tasks. Each test seeds a game, forces `?input=touch`, and drives
only through touch:

1. **Play a Hero from hand to territory** — tap the card, assert the rail
   appears, tap the `Territory` chip, assert the card's zone changed.
2. **Move a Lost Soul to the opponent's Land of Redemption** — the cross-side
   acceptance test. Tap the soul, switch the rail to `Theirs`, tap `LoR`,
   assert the card moved with the opponent as owner. Crucially, do this while
   the camera is zoomed to *my* side, proving reachability does not depend on
   the destination being visible.
3. **Long-press opens the context sheet** — `longPressAt` on a card, assert
   `ContextSheet` is visible and its rows are ≥44px.
4. **Camera round-trip** — `jump-opponent-side`, assert `zoom > 1`, then
   `jump-fit`, assert `zoom === 1`.
5. **Pinch zooms** — `pinch()` outward, assert `window.__mpCamera.get().zoom`
   increased.
6. **Portrait gate** — at 393×852, assert `rotate-device-prompt` is visible.

- [ ] **Step 2: Add a compact-phone Playwright project**

In `playwright.config.ts`, add alongside the existing `chromium-desktop` and
`chromium-mobile` projects:

```ts
    {
      name: "chromium-phone-landscape",
      use: {
        ...devices["iPhone 12 landscape"],
        // CDP touch injection needs Chromium, not the WebKit device default
        browserName: "chromium",
      },
    },
```

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add e2e/mobile/touch-play.spec.ts playwright.config.ts
git commit -m "test(play): task-driven touch play specs incl. cross-side move"
```

---

### Task 20: Implementation doc and real-device checklist

**Files:**
- Create: `docs/superpowers/implementations/2026-08-29-mobile-multiplayer-touch.md`
- Create: `docs/mobile-device-qa-checklist.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the implementation doc**

Document, for a future maintainer: the camera composition and its identity
property; why tap-to-move is primary and drag secondary; why the destination
rail exists (camera-independent reachability); the card-size formula and why
`VIRTUAL_HEIGHT` is not a lever; the profile-selection rule; and the four
validation layers with how to run each.

- [ ] **Step 2: Write the real-device checklist**

`docs/mobile-device-qa-checklist.md` covering what emulation structurally
cannot reach:

- iOS Safari long-press callout does not appear over the board
- Safari's collapsing URL bar — board rescales without layout break
- Safe-area insets in landscape on a notched device
- Pinch feel and inertia
- Double-tap on a card toggles meek and does NOT zoom
- Rotating to portrait shows the rotate prompt, rotating back restores the board
- Two real devices in one game: cross-side move lands correctly for both

- [ ] **Step 3: Add a Key References row**

In `CLAUDE.md`, add to the Key References table:

```markdown
| Mobile touch support | `docs/superpowers/specs/2026-08-29-mobile-multiplayer-touch-design.md` + `app/shared/layout/camera.ts`; run `npm run shots:mobile` for the screenshot matrix |
```

- [ ] **Step 4: Commit**

```bash
cd /Users/timestes/projects/rtt-mobile-touch
git add docs/superpowers/implementations/2026-08-29-mobile-multiplayer-touch.md docs/mobile-device-qa-checklist.md CLAUDE.md
git commit -m "docs(play): mobile touch implementation notes and device QA checklist"
```

---

## Self-Review Notes

**Spec coverage.** §3.1 → Task 1. §3.2 → Tasks 2, 3, 12. §3.3 → Task 10. §3.4 → Tasks 6, 9. §3.5 → Tasks 6, 8. §3.6 → Tasks 4, 5, 11, 12. §3.7 → Task 7. §3.8 → Tasks 14, 16. §3.9 → Task 15. §3.10 → Task 4. §4 L1 → Task 17, L2 → Task 18, L3 → Task 19, L4 → Task 20.

**Known implementer judgement calls.** Three steps require reading surrounding code before writing, and say so explicitly: Task 9 Step 2 (exact names of `myPlayerId` / `toDbPos` / card dimensions), Task 9 Step 5 (the in-scope card collection), and Task 14 Step 1 (exact `MultiplayerLayout` zone keys). These are deliberate — inventing names for them would be worse than directing the implementer to the source.
