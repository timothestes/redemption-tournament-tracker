# Lost Soul "deal" animation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-screen Lost Soul cinematic with an on-board "deal from deck" motion — the soul flies from its deck to its Land-of-Bondage (LOB) slot, settles, glows, and a light toast names it.

**Architecture:** A pure geometry module (`lostSoulDeal.ts`, unit-tested) computes each flight; a detection hook (`useLostSoulDeals`) mirrors the existing cinematic hook's arrival-detection and owns an in-flight-ID set; a Konva overlay (`LostSoulDealLayer`) renders transient flying cards on the game layer (unclipped, non-interactive) and tweens them deck→slot. The two canvases (`MultiplayerCanvas`, `GoldfishCanvas`) skip rendering a settled soul node while its ID is in flight, route the amber glow to the *visible* (landed) IDs so the glow fires on landing, and mount the overlay as the last child of the game layer. The old cinematic is deleted once nothing imports it.

**Tech Stack:** React 19, TypeScript, Konva / react-konva (imperative `Konva.Tween`), Vitest (unit tests), Playwright (manual/e2e verification).

## Global Constraints

- **Animation library on the canvas:** Konva imperative `Konva.Tween` only (matches the existing glow tween in `GameCardNode.tsx`). No framer-motion / GSAP on the Konva canvas. `KonvaLib` is the default import from `konva`.
- **Coordinate space:** All LOB positions, zone rects, and deck rects are in the game layer's **virtual coords** (the `<Layer>` has `scaleX/scaleY={scale}` + `x/y={offset}`). The flyer renders inside that same `<Layer>`, so use the rects verbatim — do not apply scale/offset yourself.
- **Constants (tunable, keep in one place):** `FLIGHT_DURATION_MS = 380`, `STAGGER_MS = 100`, `START_SCALE = 0.72`, easing `KonvaLib.Easings.EaseOut`.
- **Reduced motion:** `window.matchMedia('(prefers-reduced-motion: reduce)').matches` → no flight; the flyer lands immediately (settled node appears + glow).
- **Facing:** soul flies **face-up** the whole way (reuse the same resolved image the settled node uses). No flip.
- **Hydration gate:** never deal for pre-existing souls on load/reconnect. Reuse `soulsHydrated = !gameState.isLoading && !!gameState.myPlayer` (multiplayer) as the `ready` flag; goldfish is always ready.
- **Type gate command (never full-build while dev runs — see repo memory):** `npx tsc --noEmit`. Unit tests: `npm run test`. A single optional full build at the end uses `NEXT_DIST_DIR=.next-build npm run build`.

## File Structure

- **Create** `app/shared/utils/lostSoulDeal.ts` — pure geometry + arrival diff. No React/Konva/Next imports. Unit-tested.
- **Create** `app/shared/utils/__tests__/lostSoulDeal.test.ts` — vitest unit tests for the pure module.
- **Create** `app/shared/hooks/useLostSoulDeals.ts` — arrival-detection hook; owns the in-flight-ID map + `onLand`. Consumes `diffNewArrivals` from the pure module.
- **Create** `app/shared/components/LostSoulDealLayer.tsx` — Konva overlay rendering transient flyers; imperative tween per flyer.
- **Modify** `app/play/components/MultiplayerCanvas.tsx` — my/opp/Paragon LOB wiring; remove cinematic mount.
- **Modify** `app/goldfish/components/GoldfishCanvas.tsx` — single-player wiring; remove cinematic mount.
- **Delete** `app/shared/components/LostSoulCinematic.tsx`, `app/shared/hooks/useLostSoulCinematic.ts`, and the `.lsc-*` block in `app/globals.css` (lines ~290–511) — once no file imports them.

---

### Task 1: Pure deal-geometry module + tests

**Files:**
- Create: `app/shared/utils/lostSoulDeal.ts`
- Test: `app/shared/utils/__tests__/lostSoulDeal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `interface Point { x: number; y: number }`
  - `interface DealFlight { from: Point; to: Point; startScale: number; endScale: number; delayMs: number }`
  - `function diffNewArrivals(prevIds: Set<string>, currentIds: string[]): string[]`
  - `function computeDealFlight(params: { deck: Rect; slot: Point; cardWidth: number; cardHeight: number; seq: number; staggerMs?: number; startScale?: number }): DealFlight`
  - `const STAGGER_MS = 100`, `const START_SCALE = 0.72`

- [ ] **Step 1: Write the failing test**

Create `app/shared/utils/__tests__/lostSoulDeal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  diffNewArrivals,
  computeDealFlight,
  STAGGER_MS,
  START_SCALE,
} from '../lostSoulDeal';

describe('diffNewArrivals', () => {
  it('returns ids present now but not before', () => {
    const prev = new Set(['a', 'b']);
    expect(diffNewArrivals(prev, ['a', 'b', 'c'])).toEqual(['c']);
  });

  it('returns empty when nothing is new', () => {
    const prev = new Set(['a', 'b']);
    expect(diffNewArrivals(prev, ['a', 'b'])).toEqual([]);
  });

  it('returns all when prev is empty', () => {
    expect(diffNewArrivals(new Set(), ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('preserves input order of new ids', () => {
    expect(diffNewArrivals(new Set(['x']), ['x', 'c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });
});

describe('computeDealFlight', () => {
  const deck = { x: 0, y: 0, width: 100, height: 140 };
  const slot = { x: 500, y: 300 };
  const cardWidth = 80;
  const cardHeight = 112;

  it('starts at the deck center', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.from).toEqual({ x: 50, y: 70 });
  });

  it('ends at the slot center (slot top-left + half card)', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.to).toEqual({ x: 540, y: 356 });
  });

  it('applies stagger by seq using the default interval', () => {
    const f0 = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    const f2 = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 2 });
    expect(f0.delayMs).toBe(0);
    expect(f2.delayMs).toBe(2 * STAGGER_MS);
  });

  it('uses default scales', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.startScale).toBe(START_SCALE);
    expect(f.endScale).toBe(1);
  });

  it('honors custom stagger and startScale', () => {
    const f = computeDealFlight({
      deck, slot, cardWidth, cardHeight, seq: 3, staggerMs: 50, startScale: 0.5,
    });
    expect(f.delayMs).toBe(150);
    expect(f.startScale).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/shared/utils/__tests__/lostSoulDeal.test.ts`
Expected: FAIL — `Failed to resolve import "../lostSoulDeal"` (module doesn't exist yet).

- [ ] **Step 3: Write the module**

Create `app/shared/utils/lostSoulDeal.ts`:

```ts
/**
 * Pure geometry + arrival-diff helpers for the Lost Soul "deal" animation.
 * No React / Konva / Next imports — safe to unit-test in isolation.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DealFlight {
  /** Center point the flyer starts at (deck center). */
  from: Point;
  /** Center point the flyer lands at (LOB slot center). */
  to: Point;
  startScale: number;
  endScale: number;
  /** Stagger delay before this flyer starts moving. */
  delayMs: number;
}

/** Stagger between souls dealt in the same batch. */
export const STAGGER_MS = 100;
/** Flyer scale as it leaves the deck; grows to 1 on landing. */
export const START_SCALE = 0.72;

/** IDs present in `currentIds` that were not in `prevIds`, in input order. */
export function diffNewArrivals(prevIds: Set<string>, currentIds: string[]): string[] {
  return currentIds.filter((id) => !prevIds.has(id));
}

/**
 * Build a flight from a deck rect to an LOB slot. `slot` is the top-left of the
 * slot (as returned by the LOB layout's `hostPositions`); the flyer is
 * center-anchored, so we convert both endpoints to centers here.
 */
export function computeDealFlight(params: {
  deck: Rect;
  slot: Point;
  cardWidth: number;
  cardHeight: number;
  seq: number;
  staggerMs?: number;
  startScale?: number;
}): DealFlight {
  const staggerMs = params.staggerMs ?? STAGGER_MS;
  const startScale = params.startScale ?? START_SCALE;
  return {
    from: {
      x: params.deck.x + params.deck.width / 2,
      y: params.deck.y + params.deck.height / 2,
    },
    to: {
      x: params.slot.x + params.cardWidth / 2,
      y: params.slot.y + params.cardHeight / 2,
    },
    startScale,
    endScale: 1,
    delayMs: params.seq * staggerMs,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/shared/utils/__tests__/lostSoulDeal.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add app/shared/utils/lostSoulDeal.ts app/shared/utils/__tests__/lostSoulDeal.test.ts
git commit -m "feat(play): pure geometry + arrival-diff for lost soul deal animation"
```

---

### Task 2: `useLostSoulDeals` detection hook

**Files:**
- Create: `app/shared/hooks/useLostSoulDeals.ts`

**Interfaces:**
- Consumes: `diffNewArrivals` from `app/shared/utils/lostSoulDeal`.
- Produces:
  - `interface SoulDealState { inFlight: Map<string, number>; onLand: (id: string) => void }`
  - `function useLostSoulDeals(soulIds: string[], ready: boolean, onArrive?: (newIds: string[]) => void): SoulDealState`
  - `inFlight` maps a flying soul's instance ID → its stagger `seq` (0-based index within its arrival batch).

**Notes:** No hook-testing library is installed (only vitest + Playwright), so this hook is verified by `tsc --noEmit` and by the canvas manual checks in later tasks — not a unit test. The pure diff it relies on is already covered by Task 1. Mirror the strict-mode-safe detection structure of `useLostSoulCinematic.ts` (refs for `prevIds`/`isInitial`, `ready` gate).

- [ ] **Step 1: Write the hook**

Create `app/shared/hooks/useLostSoulDeals.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { diffNewArrivals } from '../utils/lostSoulDeal';

export interface SoulDealState {
  /** Souls currently in flight → their stagger seq within the arrival batch. */
  inFlight: Map<string, number>;
  /** Call when a flyer finishes; reveals the settled node (removes from set). */
  onLand: (id: string) => void;
}

/**
 * Detects Lost Souls newly arriving in a Land-of-Bondage zone and tracks which
 * are mid-flight. The consumer:
 *   - hides the settled node for any id in `inFlight` (the flyer shows it),
 *   - renders a flyer per `inFlight` entry and calls `onLand(id)` when its
 *     tween finishes,
 *   - routes the arrival glow to the *visible* ids (lobIds minus inFlight) so
 *     the glow fires on landing, not on server placement.
 *
 * `ready` MUST gate initial-hydration detection: the SpacetimeDB subscription
 * pushes the whole LOB on load/reconnect; without the gate every pre-existing
 * soul would register as a new arrival. Pass `false` until subscription applied
 * (and `myPlayer` resolved), then `true`. Goldfish passes `true`.
 *
 * `onArrive` fires once per detected batch with the new ids (for a single
 * summarizing toast). It fires as the souls begin dealing (~one flight ahead of
 * landing) — close enough to "on land" without coordinating N flyer landings.
 *
 * Strict-mode safe: detection lives in refs, mirroring useLostSoulCinematic.
 */
export function useLostSoulDeals(
  soulIds: string[],
  ready: boolean,
  onArrive?: (newIds: string[]) => void,
): SoulDealState {
  const prevIdsRef = useRef<Set<string>>(new Set());
  const isInitialRef = useRef(true);
  const [inFlight, setInFlight] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!ready) return;

    const currentIds = new Set(soulIds);

    if (isInitialRef.current) {
      prevIdsRef.current = currentIds;
      isInitialRef.current = false;
      return;
    }

    const newIds = diffNewArrivals(prevIdsRef.current, soulIds);
    prevIdsRef.current = currentIds;

    // Prune any in-flight souls that left the LOB before landing (e.g. rescued
    // mid-flight) so we never leave a permanently hidden settled node.
    setInFlight((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of next.keys()) {
        if (!currentIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      newIds.forEach((id, i) => {
        if (!next.has(id)) {
          next.set(id, i);
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    if (newIds.length > 0) onArrive?.(newIds);
  }, [soulIds, ready, onArrive]);

  const onLand = useCallback((id: string) => {
    setInFlight((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return { inFlight, onLand };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors introduced by the new file).

- [ ] **Step 3: Commit**

```bash
git add app/shared/hooks/useLostSoulDeals.ts
git commit -m "feat(play): useLostSoulDeals — arrival detection + in-flight set"
```

---

### Task 3: `LostSoulDealLayer` Konva overlay

**Files:**
- Create: `app/shared/components/LostSoulDealLayer.tsx`

**Interfaces:**
- Consumes: `DealFlight` from `app/shared/utils/lostSoulDeal`.
- Produces:
  - `interface SoulDeal { id: string; image: HTMLImageElement | undefined; cardWidth: number; cardHeight: number; rotation: number; flight: DealFlight }`
  - `function LostSoulDealLayer(props: { deals: SoulDeal[]; onLand: (id: string) => void; durationMs?: number }): JSX.Element`
- Renders inside an existing `<Layer>` (it returns a `<Group>`, not its own Layer). Non-interactive (`listening={false}`). Each flyer is center-anchored (`offsetX/Y = card/2`) so rotation and scale pivot on the card center and it lands aligned with the settled node.

**Notes:** Visual component — verified by `tsc --noEmit` here and by the canvas manual checks in Tasks 4–6, not a unit test. Mirror the imperative-tween + cleanup pattern from `GameCardNode.tsx` lines 136–179.

- [ ] **Step 1: Write the component**

Create `app/shared/components/LostSoulDealLayer.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import type { DealFlight } from '../utils/lostSoulDeal';

const FLIGHT_DURATION_MS = 380;

export interface SoulDeal {
  id: string;
  image: HTMLImageElement | undefined;
  cardWidth: number;
  cardHeight: number;
  /** 0 for the local seat's LOB, 180 for the opponent's (matches settled node). */
  rotation: number;
  flight: DealFlight;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Transient overlay that "deals" newly-arrived Lost Souls from the deck into
 * their LOB slot. Each flyer runs one imperative Konva tween (center-anchored
 * so rotation/scale pivot on the card center) and calls `onLand(id)` when it
 * finishes. Lives on the game layer, above the settled cards, unclipped and
 * non-interactive so it can cross the zone boundary mid-flight.
 */
export function LostSoulDealLayer({
  deals,
  onLand,
  durationMs = FLIGHT_DURATION_MS,
}: {
  deals: SoulDeal[];
  onLand: (id: string) => void;
  durationMs?: number;
}) {
  return (
    <Group listening={false}>
      {deals.map((deal) => (
        <DealFlyer key={deal.id} deal={deal} durationMs={durationMs} onLand={onLand} />
      ))}
    </Group>
  );
}

function DealFlyer({
  deal,
  durationMs,
  onLand,
}: {
  deal: SoulDeal;
  durationMs: number;
  onLand: (id: string) => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const { flight, id, image } = deal;

  useEffect(() => {
    const node = groupRef.current;
    // No node, no image, or reduced motion → skip the flight and hand off
    // immediately so the settled node + glow take over without delay.
    if (!node || !image || prefersReducedMotion()) {
      onLand(id);
      return;
    }

    node.position({ x: flight.from.x, y: flight.from.y });
    node.scale({ x: flight.startScale, y: flight.startScale });

    let tween: Konva.Tween | null = null;
    const timer = setTimeout(() => {
      tween = new KonvaLib.Tween({
        node,
        duration: durationMs / 1000,
        x: flight.to.x,
        y: flight.to.y,
        scaleX: flight.endScale,
        scaleY: flight.endScale,
        easing: KonvaLib.Easings.EaseOut,
        onFinish: () => onLand(id),
      });
      tween.play();
    }, flight.delayMs);

    return () => {
      clearTimeout(timer);
      tween?.destroy();
    };
    // Start once per flyer; a live layout reflow does not restart the tween.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Group
      ref={groupRef as any}
      x={flight.from.x}
      y={flight.from.y}
      offsetX={deal.cardWidth / 2}
      offsetY={deal.cardHeight / 2}
      rotation={deal.rotation}
      scaleX={flight.startScale}
      scaleY={flight.startScale}
      listening={false}
    >
      {image ? (
        <KonvaImage
          image={image}
          width={deal.cardWidth}
          height={deal.cardHeight}
          cornerRadius={4}
          perfectDrawEnabled={false}
        />
      ) : (
        <Rect
          width={deal.cardWidth}
          height={deal.cardHeight}
          fill="#2a1f12"
          stroke="#6b4e27"
          strokeWidth={1}
          cornerRadius={4}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/shared/components/LostSoulDealLayer.tsx
git commit -m "feat(play): LostSoulDealLayer — transient deck→slot flyer overlay"
```

---

### Task 4: Wire the deal into MultiplayerCanvas (my + opponent LOB)

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

**Interfaces:**
- Consumes: `useLostSoulDeals` (Task 2), `LostSoulDealLayer` + `SoulDeal` (Task 3), `computeDealFlight` (Task 1). Existing in-file: `myZones`, `opponentZones`, `myLobLayout`, `opponentLobLayout`, `getCardImage`, `isLostSoulCard`, `simplifyLostSoulName` (already imported in `GameCardNode`; import here too), `showGameToast`, `soulsHydrated`, `lobCard`.
- Produces: nothing new for later tasks.

This task covers standard (non-Paragon) my/opponent LOB. Paragon shared LOB is Task 5.

- [ ] **Step 1: Add imports**

Near the other `@/app/shared` imports (around lines 40–79), add:

```tsx
import { useLostSoulDeals } from '@/app/shared/hooks/useLostSoulDeals';
import { LostSoulDealLayer, type SoulDeal } from '@/app/shared/components/LostSoulDealLayer';
import { computeDealFlight } from '@/app/shared/utils/lostSoulDeal';
import { simplifyLostSoulName } from '@/lib/cards/cardAbilities';
```

(If `simplifyLostSoulName` is already imported from `@/lib/cards/cardAbilities`, add it to that existing import instead of duplicating. `isLostSoulCard` is already imported at line 53.)

- [ ] **Step 2: Build soul-ID lists and a name lookup**

Replace the glow block at lines 587–597. Current:

```tsx
  // ---- LOB arrival glow effect ----
  const myLobIds = useMemo(
    () => (myCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [myCards],
  );
  const oppLobIds = useMemo(
    () => (opponentCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [opponentCards],
  );
  const { getGlowIntensity: getMyLobGlow } = useLobArrivalEffect(myLobIds);
  const { getGlowIntensity: getOppLobGlow } = useLobArrivalEffect(oppLobIds);
```

With:

```tsx
  // ---- LOB arrival glow effect ----
  const myLobIds = useMemo(
    () => (myCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [myCards],
  );
  const oppLobIds = useMemo(
    () => (opponentCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [opponentCards],
  );

  // ---- Lost Soul "deal" animation ----
  // Only Lost Souls fly; other LOB arrivals (attached sites) keep the plain glow.
  const myLobSoulIds = useMemo(
    () => (myCards['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => String(c.id)),
    [myCards],
  );
  const oppLobSoulIds = useMemo(
    () => (opponentCards['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => String(c.id)),
    [opponentCards],
  );
  // id → display name, for the summarizing toast.
  const lobSoulNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of (myCards['land-of-bondage'] ?? [])) m.set(String(c.id), c.cardName);
    for (const c of (opponentCards['land-of-bondage'] ?? [])) m.set(String(c.id), c.cardName);
    return m;
  }, [myCards, opponentCards]);

  const fireSoulToast = useCallback((newIds: string[]) => {
    if (newIds.length === 1) {
      const name = simplifyLostSoulName(lobSoulNameById.get(newIds[0]) ?? 'Lost Soul');
      showGameToast(`Lost Soul dealt: ${name}`);
    } else if (newIds.length > 1) {
      showGameToast(`${newIds.length} Lost Souls dealt`);
    }
  }, [lobSoulNameById]);

  const { inFlight: myDeals, onLand: onMyLand } =
    useLostSoulDeals(myLobSoulIds, soulsHydrated, fireSoulToast);
  const { inFlight: oppDeals, onLand: onOppLand } =
    useLostSoulDeals(oppLobSoulIds, soulsHydrated, fireSoulToast);

  // Route the glow to *visible* ids: a soul in flight is excluded until it lands,
  // so the amber glow fires on landing rather than on server placement.
  const myVisibleLobIds = useMemo(
    () => myLobIds.filter(id => !myDeals.has(id)),
    [myLobIds, myDeals],
  );
  const oppVisibleLobIds = useMemo(
    () => oppLobIds.filter(id => !oppDeals.has(id)),
    [oppLobIds, oppDeals],
  );
  const { getGlowIntensity: getMyLobGlow } = useLobArrivalEffect(myVisibleLobIds);
  const { getGlowIntensity: getOppLobGlow } = useLobArrivalEffect(oppVisibleLobIds);
```

Confirm `useCallback` is in the React import at the top of the file (add it if missing).

- [ ] **Step 3: Remove the multiplayer cinematic wiring**

Delete the cinematic block at lines 599–624 (the `lobSoulsForCinematic` memo, `soulsHydrated` is defined here — **keep the `soulsHydrated` line**, move it above the deal hooks in Step 2 if needed, since the deal hooks use it). Concretely, keep:

```tsx
  const soulsHydrated = !gameState.isLoading && !!gameState.myPlayer;
```

and delete `lobSoulsForCinematic` and the `useLostSoulCinematic(...)` call. Also delete the imports at lines 75–76:

```tsx
import { useLostSoulCinematic } from '@/app/shared/hooks/useLostSoulCinematic';
import { LostSoulCinematic } from '@/app/shared/components/LostSoulCinematic';
```

(Move the `soulsHydrated` definition so it appears *before* the `useLostSoulDeals` calls in Step 2.)

- [ ] **Step 4: Skip the settled host node while in flight (my LOB)**

In the my-LOB host loop (around lines 5119–5129), change:

```tsx
            for (const host of hosts) {
              const hostPos = myLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
```

to:

```tsx
            for (const host of hosts) {
              const hostPos = myLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              // In flight → the flyer shows it; skip the settled node this frame.
              if (myDeals.has(String(host.id))) continue;
```

- [ ] **Step 5: Skip the settled host node while in flight (opponent LOB)**

In the opponent-LOB host loop (around lines 5193–5208), change:

```tsx
            for (const host of hosts) {
              const hostPos = opponentLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
```

to:

```tsx
            for (const host of hosts) {
              const hostPos = opponentLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              if (oppDeals.has(String(host.id))) continue;
```

- [ ] **Step 6: Build the deals and mount the overlay**

Just before the game layer closes at line 6155 (`</Layer>`), add the deal overlay as the last child of the game layer. Insert:

```tsx
          {/* ================================================================
              Lost Soul "deal" flyers — transient cards dealt deck → LOB slot.
              Rendered last in the game layer so they draw above settled cards,
              unclipped so they can cross the zone boundary mid-flight.
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && (() => {
            const deals: SoulDeal[] = [];
            const myDeck = myZones['deck'];
            const oppDeck = opponentZones['deck'];
            const byId = (cards: CardInstance[] | undefined, id: string) =>
              (cards ?? []).find(c => String(c.id) === id);

            if (myDeck) {
              for (const [id, seq] of myDeals) {
                const slot = myLobLayout.hostPositions.get(id);
                const card = byId(myCards['land-of-bondage'], id);
                if (!slot || !card) continue;
                deals.push({
                  id,
                  image: getCardImage(card),
                  cardWidth: lobCard.cardWidth,
                  cardHeight: lobCard.cardHeight,
                  rotation: 0,
                  flight: computeDealFlight({
                    deck: myDeck, slot, cardWidth: lobCard.cardWidth,
                    cardHeight: lobCard.cardHeight, seq,
                  }),
                });
              }
            }
            if (oppDeck) {
              for (const [id, seq] of oppDeals) {
                const slot = opponentLobLayout.hostPositions.get(id);
                const card = byId(opponentCards['land-of-bondage'], id);
                if (!slot || !card) continue;
                deals.push({
                  id,
                  image: getCardImage(card),
                  cardWidth: lobCard.cardWidth,
                  cardHeight: lobCard.cardHeight,
                  rotation: 180,
                  flight: computeDealFlight({
                    deck: oppDeck, slot, cardWidth: lobCard.cardWidth,
                    cardHeight: lobCard.cardHeight, seq,
                  }),
                });
              }
            }

            const handleLand = (id: string) => {
              if (myDeals.has(id)) onMyLand(id);
              if (oppDeals.has(id)) onOppLand(id);
            };
            return deals.length > 0
              ? <LostSoulDealLayer deals={deals} onLand={handleLand} />
              : null;
          })()}
```

- [ ] **Step 7: Remove the cinematic mount (DOM overlay)**

Delete the mount block at lines 7604–7609:

```tsx
      {soulCinematic && (
        <LostSoulCinematic
          key={soulCinematic.id}
          souls={soulCinematic.souls}
        />
      )}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. Fix any missing imports (`useCallback`, `simplifyLostSoulName`, `SoulDeal`, `CardInstance` is already used in-file).

- [ ] **Step 9: Manual verification (multiplayer)**

Use the `verify` skill (it mints real Supabase sessions and drives the dev server via Playwright). Start the dev server, open a multiplayer game as two seats, and draw a Lost Soul (or trigger a soul to route to the LOB).

Verify:
- The soul flies from the deck pile to its LOB slot (not a full-screen vignette), lands, and the amber glow fires **on landing**.
- A toast reads `Lost Soul dealt: <name>` (or `N Lost Souls dealt` for a chain), and chains stagger.
- No card appears in two places at once; the settled card sits exactly where the flyer landed.
- Reconnect/reload with souls already in the LOB → **no** deal animation fires for pre-existing souls.

- [ ] **Step 10: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): deal lost souls from deck into LOB (my/opp); retire cinematic mount"
```

---

### Task 5: Paragon shared-LOB deal (additive)

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`

**Interfaces:**
- Consumes: same as Task 4, plus `sharedCards`, `sharedLobLayout`, `mpLayout.zones.soulDeck`.
- Produces: nothing new.

**Context:** In Paragon, souls live in `sharedCards['land-of-bondage']` (rendered with `rotation={0}`), and the old cinematic never fired for them (it only read my/opp LOB). So this is **new** arrival feedback for Paragon, flying from the shared `soulDeck`. Paragon shared LOB has no glow today; we do not add one — the deal + toast is the signal.

- [ ] **Step 1: Add the shared-LOB deal hook**

After the my/opp deal hooks (Task 4, Step 2), add:

```tsx
  const sharedLobSoulIds = useMemo(
    () => (sharedCards['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => String(c.id)),
    [sharedCards],
  );
  const { inFlight: sharedDeals, onLand: onSharedLand } =
    useLostSoulDeals(sharedLobSoulIds, soulsHydrated, (newIds) => {
      if (newIds.length === 1) {
        const c = (sharedCards['land-of-bondage'] ?? []).find(x => String(x.id) === newIds[0]);
        showGameToast(`Lost Soul dealt: ${simplifyLostSoulName(c?.cardName ?? 'Lost Soul')}`);
      } else if (newIds.length > 1) {
        showGameToast(`${newIds.length} Lost Souls dealt`);
      }
    });
```

- [ ] **Step 2: Skip the settled shared host while in flight**

In the shared-LOB host loop (around lines 5263–5271), change:

```tsx
            for (const host of hosts) {
              const hostPos = sharedLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
```

to:

```tsx
            for (const host of hosts) {
              const hostPos = sharedLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              if (sharedDeals.has(String(host.id))) continue;
```

- [ ] **Step 3: Mount a Paragon deal overlay**

Right after the non-Paragon deal overlay from Task 4 Step 6 (still before `</Layer>` at 6155), add:

```tsx
          {normalizedFormat === 'Paragon' && mpLayout?.zones.soulDeck && (() => {
            const deck = mpLayout.zones.soulDeck;
            const deals: SoulDeal[] = [];
            for (const [id, seq] of sharedDeals) {
              const slot = sharedLobLayout.hostPositions.get(id);
              const card = (sharedCards['land-of-bondage'] ?? []).find(c => String(c.id) === id);
              if (!slot || !card) continue;
              deals.push({
                id,
                image: getCardImage(card),
                cardWidth: lobCard.cardWidth,
                cardHeight: lobCard.cardHeight,
                rotation: 0,
                flight: computeDealFlight({
                  deck, slot, cardWidth: lobCard.cardWidth,
                  cardHeight: lobCard.cardHeight, seq,
                }),
              });
            }
            return deals.length > 0
              ? <LostSoulDealLayer deals={deals} onLand={onSharedLand} />
              : null;
          })()}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual verification (Paragon)**

Start a Paragon game; draw a soul from the Soul Deck into the shared LOB. Verify the soul flies from the Soul Deck pile to its slot, lands, and a toast names it. No full-screen effect; no double-render.

- [ ] **Step 6: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): deal lost souls from soul deck into shared LOB (Paragon)"
```

---

### Task 6: Wire the deal into GoldfishCanvas (single-player)

**Files:**
- Modify: `app/goldfish/components/GoldfishCanvas.tsx`

**Interfaces:**
- Consumes: `useLostSoulDeals`, `LostSoulDealLayer` + `SoulDeal`, `computeDealFlight`, `calculateAutoArrangePositions` (already imported line 11), `getLobGlow`, `zoneLayout`, `showGameToast`/`simplifyLostSoulName`.
- Produces: nothing new.

**Context:** Single-player: everything is in `state.zones`. LOB slot positions come from `calculateAutoArrangePositions(count, lobZone, cardWidth, cardHeight)` indexed by the soul's order in `state.zones['land-of-bondage']` (the same call the LOB render at ~line 2097 uses). Deck rect is `zoneLayout['deck']`. Rotation 0.

- [ ] **Step 1: Add imports**

Alongside the existing shared imports (lines 40–45), add:

```tsx
import { useLostSoulDeals } from '@/app/shared/hooks/useLostSoulDeals';
import { LostSoulDealLayer, type SoulDeal } from '@/app/shared/components/LostSoulDealLayer';
import { computeDealFlight } from '@/app/shared/utils/lostSoulDeal';
import { simplifyLostSoulName } from '@/lib/cards/cardAbilities';
```

(If `simplifyLostSoulName` / `isLostSoulCard` are already imported, extend the existing import. `isLostSoulCard` is used at line 94, so it is already imported.)

- [ ] **Step 2: Add the deal hook and route the glow to visible ids**

Replace the glow line at line 84:

```tsx
  const { getGlowIntensity: getLobGlow } = useLobArrivalEffect(lobCardIds);
```

with:

```tsx
  const lobSoulIds = useMemo(
    () => (state.zones['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => c.instanceId),
    [state.zones['land-of-bondage']],
  );
  const { inFlight: soulDeals, onLand: onSoulLand } = useLostSoulDeals(
    lobSoulIds,
    true,
    (newIds) => {
      if (newIds.length === 1) {
        const c = (state.zones['land-of-bondage'] ?? []).find(x => x.instanceId === newIds[0]);
        showGameToast(`Lost Soul dealt: ${simplifyLostSoulName(c?.cardName ?? 'Lost Soul')}`);
      } else if (newIds.length > 1) {
        showGameToast(`${newIds.length} Lost Souls dealt`);
      }
    },
  );
  const visibleLobIds = useMemo(
    () => lobCardIds.filter(id => !soulDeals.has(id)),
    [lobCardIds, soulDeals],
  );
  const { getGlowIntensity: getLobGlow } = useLobArrivalEffect(visibleLobIds);
```

- [ ] **Step 3: Remove the goldfish cinematic wiring**

Delete the `lobSouls` memo (lines 91–100) and the `useLostSoulCinematic(lobSouls)` call (line 101), and the imports at lines 44–45:

```tsx
import { useLostSoulCinematic } from '@/app/shared/hooks/useLostSoulCinematic';
import { LostSoulCinematic } from '@/app/shared/components/LostSoulCinematic';
```

- [ ] **Step 4: Skip the settled soul node while in flight**

In the LOB render block (around lines 2090–2120, the `.map` that renders each LOB card with `lobArrivalGlow={getLobGlow(card.instanceId) > 0}`), skip cards that are in flight. Find the start of the per-card render inside that block and add an early return for in-flight souls. Concretely, in the `cards.map((card, i) => { ... })` callback, add as the first line:

```tsx
                if (soulDeals.has(card.instanceId)) return null;
```

(If the block computes positions via index `i` for all cards, keep using `i` — the slot for a skipped card stays reserved because `calculateAutoArrangePositions(cards.length, ...)` still counts it; the flyer targets that same index. See Step 5.)

- [ ] **Step 5: Mount the goldfish deal overlay**

Just before the game layer closes at line 2302 (`</Layer>`), add:

```tsx
          {(() => {
            const lobZone = zoneLayout['land-of-bondage'];
            const deck = zoneLayout['deck'];
            if (!lobZone || !deck) return null;
            const lobCards = state.zones['land-of-bondage'] ?? [];
            const slots = calculateAutoArrangePositions(lobCards.length, lobZone, cardWidth, cardHeight);
            const deals: SoulDeal[] = [];
            for (const [id, seq] of soulDeals) {
              const idx = lobCards.findIndex(c => c.instanceId === id);
              const slot = idx >= 0 ? slots[idx] : undefined;
              const card = idx >= 0 ? lobCards[idx] : undefined;
              if (!slot || !card) continue;
              deals.push({
                id,
                image: getCardImage(card),
                cardWidth,
                cardHeight,
                rotation: 0,
                flight: computeDealFlight({ deck, slot, cardWidth, cardHeight, seq }),
              });
            }
            return deals.length > 0
              ? <LostSoulDealLayer deals={deals} onLand={onSoulLand} />
              : null;
          })()}
```

**Note:** confirm the goldfish image getter used by the LOB render. If it is not named `getCardImage`, use the same getter the LOB `.map` passes to its `image={...}` prop (grep the block around line 2097 for the `image=` expression and reuse it verbatim).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Manual verification (goldfish)**

Open the goldfish practice board, draw/route a Lost Soul into the LOB. Verify: soul flies from the deck to its slot, lands, glows, toast names it; reduced-motion (OS setting) → instant place + glow, no flight.

- [ ] **Step 8: Commit**

```bash
git add app/goldfish/components/GoldfishCanvas.tsx
git commit -m "feat(goldfish): deal lost souls from deck into LOB; retire cinematic mount"
```

---

### Task 7: Delete the old cinematic + CSS

**Files:**
- Delete: `app/shared/components/LostSoulCinematic.tsx`
- Delete: `app/shared/hooks/useLostSoulCinematic.ts`
- Modify: `app/globals.css` (remove the `.lsc-*` block, ~lines 290–511)

**Interfaces:** none. This is dead-code removal — do it only after Tasks 4 and 6 removed every import.

- [ ] **Step 1: Confirm nothing references the cinematic**

Run:

```bash
grep -rnE "LostSoulCinematic|useLostSoulCinematic|SoulCinematicCard|SoulCinematicBatch|lsc-" app --include='*.ts' --include='*.tsx' --include='*.css'
```

Expected: only matches inside the three files being removed/edited (the two cinematic files and the `.lsc-*` block in `globals.css`). If any other file matches, stop and fix that reference first.

- [ ] **Step 2: Delete the cinematic files**

```bash
git rm app/shared/components/LostSoulCinematic.tsx app/shared/hooks/useLostSoulCinematic.ts
```

- [ ] **Step 3: Remove the `.lsc-*` CSS**

In `app/globals.css`, delete the Lost Soul cinematic block (the `@keyframes lsc-*` and `.lsc-*` rules and their reduced-motion overrides, ~lines 290–511). Read the file first to confirm the exact start/end of the block (a comment like the cinematic section header marks the top; it ends just before the next unrelated rule). Remove only that block.

- [ ] **Step 4: Verify removal is clean**

Run:

```bash
grep -rnE "LostSoulCinematic|useLostSoulCinematic|lsc-" app --include='*.ts' --include='*.tsx' --include='*.css'
```

Expected: **no matches.**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Full build + unit tests**

Run: `npm run test`
Expected: PASS (includes the Task 1 suite).

Run: `NEXT_DIST_DIR=.next-build npm run build`
Expected: build succeeds (only if no dev server conflict; see repo memory on shared `.next`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(play): remove lost soul cinematic component, hook, and CSS"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-07-lost-soul-deal-animation-design.md`):
- Deal from deck (my/opp/Paragon) → Tasks 4, 5. Deck rects: `myZones['deck']`, `opponentZones['deck']`, `mpLayout.zones.soulDeck`; goldfish `zoneLayout['deck']` → Task 6. ✓
- Face-up, ~380ms, ease-out, scale settle → Task 3 (`FLIGHT_DURATION_MS`, `START_SCALE`, `EaseOut`). ✓
- Short local hop (deck near its LOB) → inherent in using each side's own deck rect. ✓
- Batch stagger ~100ms → `computeDealFlight` `delayMs = seq * STAGGER_MS`; `seq` assigned in `useLostSoulDeals`. ✓
- Transient flyer layer immune to reflow; settled node hidden via in-flight set → Task 3 + the `if (deals.has(id)) continue;` skips in Tasks 4–6. ✓
- Landing beat = amber glow → routed to *visible* ids so it fires on land (Tasks 4, 6). Paragon shared LOB has no glow today; not added (documented). ✓
- Light toast on land → `showGameToast` summarizing toast in `onArrive` (Tasks 4–6). Timing reconciled: fires as souls begin dealing (~one flight ahead), documented in the hook. ✓
- Reduced motion → `prefersReducedMotion` in `DealFlyer` skips flight (Task 3). ✓
- Retire cinematic → mounts removed in Tasks 4/6; files + CSS deleted in Task 7. ✓
- Goldfish parity → Task 6. ✓
- Edge cases: missing deck rect (guarded `if (deck)`/`if (!lobZone||!deck)`), missing image (flyer skips to `onLand`), card removed mid-flight (hook prunes in-flight ids), strict-mode (refs in hook, tween cleanup in flyer). ✓

**Known limitation (documented in spec Tunables):** if souls arrive in *separate* ticks close together, the auto-arrange layout re-centers and an already-flying flyer's fixed target can be slightly stale on landing; the on-land glow masks it. Souls drawn together share one tick → one layout → no mid-batch drift. A live-retargeting flyer is a future enhancement.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The one "confirm the getter name" note in Task 6 Step 5 is a concrete grep instruction, not a deferred decision.

**Type consistency:** `SoulDeal` fields (`id`, `image`, `cardWidth`, `cardHeight`, `rotation`, `flight`) match between Task 3's definition and the construction sites in Tasks 4–6. `useLostSoulDeals` returns `{ inFlight: Map<string,number>, onLand }` — consumers use `.has(id)`, iterate `[id, seq]`, and call `onLand(id)` consistently. `computeDealFlight` params (`deck`, `slot`, `cardWidth`, `cardHeight`, `seq`) match all call sites.
