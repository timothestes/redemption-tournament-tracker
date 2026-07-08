# "The Deal" Draw Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When cards move from the player's deck to their hand in multiplayer (turn-start auto-draw of 3, Draw button, Draw N, draw bottom/random), each card visibly flies from the deck pile to its hand slot one at a time — card back leaves the pile, flips to its face mid-flight, lands in the fan with the existing amber arrival glow.

**Architecture:** Pure client-side; zero SpacetimeDB module changes. A pure detection core (`dealAnimationCore.ts`) diffs card zones between renders and flags deck→hand transitions. A thin hook (`useDealAnimation.ts`) turns detections into scheduled, staggered deals with failsafe timers. A Konva overlay (`DealLayer.tsx`) renders temporary flying sprites; the real hand card is hidden until its sprite lands, then revealed with the existing `lobArrivalGlow` bloom. Follows the `undoStackCore.ts` pattern (tested pure core + thin hook) and the `useLobArrivalEffect` arrival-diff pattern.

**Tech Stack:** React 19, react-konva/Konva imperative Tweens (same as `GameCardNode`'s LOB glow), vitest for the pure core.

## Global Constraints

- No changes under `spacetimedb/` — this is presentation-only.
- Multiplayer only (`app/play/`); goldfish canvas untouched.
- Spectators never get the deal animation (`viewerKind === 'spectator'` disables it).
- `prefers-reduced-motion: reduce` skips the flight; the landing glow still fires.
- A card must NEVER be stuck invisible: every deal has an 8s failsafe force-complete, and deals cancel when the card leaves the hand (undo, play mid-flight).
- Animation timing: 200ms stagger between cards, 420ms flight, batch stagger compresses so any batch spreads over ≤1600ms (opening-hand safety).
- Match existing conventions: card ids are `bigint` stringified via `String(card.id)`; corner radius 4; `KonvaLib.Tween` + `KonvaLib.Easings.EaseOut`.

---

### Task 1: Pure detection + scheduling core

**Files:**
- Create: `app/play/hooks/dealAnimationCore.ts`
- Test: `app/play/hooks/__tests__/dealAnimationCore.test.ts`

**Interfaces:**
- Produces: `DealCardSnapshot { id: string; zone: string }`, `diffDeals(prevZones: Map<string,string> | null, cards: DealCardSnapshot[]): { dealt: string[]; nextZones: Map<string,string> }`, `scheduleDeals(nowMs: number, prevLastStartAt: number, count: number): { startAts: number[] }`, constants `DEAL_STAGGER_MS = 200`, `DEAL_FLIGHT_MS = 420`, `DEAL_MAX_SPREAD_MS = 1600`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/play/hooks/__tests__/dealAnimationCore.test.ts
import { describe, it, expect } from 'vitest';
import {
  diffDeals,
  scheduleDeals,
  DEAL_STAGGER_MS,
  DEAL_MAX_SPREAD_MS,
} from '../dealAnimationCore';

describe('diffDeals', () => {
  it('returns no deals on the initial snapshot (prevZones null)', () => {
    const cards = [
      { id: '1', zone: 'hand' },
      { id: '2', zone: 'deck' },
    ];
    const { dealt, nextZones } = diffDeals(null, cards);
    expect(dealt).toEqual([]);
    expect(nextZones.get('1')).toBe('hand');
    expect(nextZones.get('2')).toBe('deck');
  });

  it('flags cards that moved deck → hand, in current hand order', () => {
    const prev = new Map([
      ['1', 'hand'],
      ['2', 'deck'],
      ['3', 'deck'],
      ['4', 'deck'],
    ]);
    const cards = [
      { id: '1', zone: 'hand' },
      { id: '2', zone: 'hand' },
      { id: '3', zone: 'hand' },
      { id: '4', zone: 'deck' },
    ];
    expect(diffDeals(prev, cards).dealt).toEqual(['2', '3']);
  });

  it('ignores hand arrivals from other zones (territory, reserve, unknown)', () => {
    const prev = new Map([
      ['1', 'territory'],
      ['2', 'reserve'],
    ]);
    const cards = [
      { id: '1', zone: 'hand' },
      { id: '2', zone: 'hand' },
      { id: '9', zone: 'hand' }, // never seen before (e.g. game-start insert)
    ];
    expect(diffDeals(prev, cards).dealt).toEqual([]);
  });

  it('ignores cards that left the hand', () => {
    const prev = new Map([['1', 'hand']]);
    const cards = [{ id: '1', zone: 'discard' }];
    const { dealt, nextZones } = diffDeals(prev, cards);
    expect(dealt).toEqual([]);
    expect(nextZones.get('1')).toBe('discard');
  });
});

describe('scheduleDeals', () => {
  it('staggers a batch by DEAL_STAGGER_MS starting now', () => {
    const { startAts } = scheduleDeals(1000, -Infinity, 3);
    expect(startAts).toEqual([1000, 1000 + DEAL_STAGGER_MS, 1000 + 2 * DEAL_STAGGER_MS]);
  });

  it('queues a new batch after an in-flight one', () => {
    const first = scheduleDeals(1000, -Infinity, 2);
    const lastStart = first.startAts[1];
    const second = scheduleDeals(1050, lastStart, 1);
    expect(second.startAts[0]).toBe(lastStart + DEAL_STAGGER_MS);
  });

  it('compresses stagger for large batches so total spread ≤ DEAL_MAX_SPREAD_MS', () => {
    const { startAts } = scheduleDeals(0, -Infinity, 12);
    expect(startAts[11] - startAts[0]).toBeLessThanOrEqual(DEAL_MAX_SPREAD_MS);
    expect(startAts[1] - startAts[0]).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/play/hooks/__tests__/dealAnimationCore.test.ts`
Expected: FAIL — cannot resolve `../dealAnimationCore`.

- [ ] **Step 3: Write the implementation**

```ts
// app/play/hooks/dealAnimationCore.ts
// Pure logic for "the deal" draw animation: detecting deck→hand transitions
// between renders and scheduling staggered launch times. Kept free of React
// and Konva so it can be unit-tested directly (same pattern as undoStackCore).

export interface DealCardSnapshot {
  id: string;
  zone: string;
}

/** Delay between consecutive card launches. */
export const DEAL_STAGGER_MS = 200;
/** Flight duration for one card, deck pile → hand slot. */
export const DEAL_FLIGHT_MS = 420;
/** A batch never spreads its launches over more than this (big draws compress). */
export const DEAL_MAX_SPREAD_MS = 1600;

export interface DealDiffResult {
  /** Instance IDs newly arrived in hand FROM THE DECK, in current hand order. */
  dealt: string[];
  /** Zone map to carry into the next diff. */
  nextZones: Map<string, string>;
}

/**
 * Diff the previous id→zone map against the current card list. Only a card
 * whose previous zone was 'deck' and whose current zone is 'hand' counts as a
 * deal — cards returning from territory/reserve/search-inserts don't animate.
 * A null prevZones means "first snapshot" (page load / reconnect): never deal.
 */
export function diffDeals(
  prevZones: Map<string, string> | null,
  cards: DealCardSnapshot[],
): DealDiffResult {
  const nextZones = new Map<string, string>();
  for (const c of cards) nextZones.set(c.id, c.zone);
  if (prevZones === null) return { dealt: [], nextZones };

  const dealt: string[] = [];
  for (const c of cards) {
    if (c.zone === 'hand' && prevZones.get(c.id) === 'deck') dealt.push(c.id);
  }
  return { dealt, nextZones };
}

/**
 * Launch times for a batch of `count` deals. Starts at `nowMs`, or chains
 * after `prevLastStartAt` when a previous deal is still queued (rapid Draw
 * button presses keep the one-at-a-time rhythm instead of overlapping).
 */
export function scheduleDeals(
  nowMs: number,
  prevLastStartAt: number,
  count: number,
): { startAts: number[] } {
  const stagger =
    count > 1 ? Math.min(DEAL_STAGGER_MS, DEAL_MAX_SPREAD_MS / (count - 1)) : DEAL_STAGGER_MS;
  const first = Math.max(nowMs, prevLastStartAt + stagger);
  return {
    startAts: Array.from({ length: count }, (_, i) => first + i * stagger),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/play/hooks/__tests__/dealAnimationCore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/play/hooks/dealAnimationCore.ts app/play/hooks/__tests__/dealAnimationCore.test.ts
git commit -m "feat(play): pure deck→hand deal detection + stagger scheduling core"
```

---

### Task 2: `useDealAnimation` hook

**Files:**
- Create: `app/play/hooks/useDealAnimation.ts`

**Interfaces:**
- Consumes: `diffDeals`, `scheduleDeals`, `DEAL_FLIGHT_MS` from Task 1.
- Produces: `useDealAnimation(cards: DealCardSnapshot[], enabled: boolean): { deals: ActiveDeal[]; dealingIds: Set<string>; glowIds: Set<string>; completeDeal: (instanceId: string) => void }` where `ActiveDeal { instanceId: string; startAt: number }` (`startAt` is a `performance.now()` timestamp).

No unit test — the repo has no DOM test environment (vitest without jsdom/testing-library); all branching logic lives in the tested core. Verified end-to-end in Task 4.

- [ ] **Step 1: Write the hook**

```ts
// app/play/hooks/useDealAnimation.ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  diffDeals,
  scheduleDeals,
  DEAL_FLIGHT_MS,
  type DealCardSnapshot,
} from './dealAnimationCore';

export interface ActiveDeal {
  instanceId: string;
  /** performance.now()-based timestamp when this sprite should launch. */
  startAt: number;
}

/** How long the landing glow flag stays set (GameCardNode's tween is ~1.8s). */
const GLOW_DURATION_MS = 2000;
/**
 * Failsafe: a dealing card is force-revealed this long after its scheduled
 * launch even if the Konva tween never finishes (backgrounded tab, unmounted
 * sprite). A card must never be stuck invisible.
 */
const DEAL_FAILSAFE_MS = 8000;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Tracks deck→hand transitions for the local player's cards and exposes the
 * transient state driving "the deal": which cards currently have a sprite in
 * flight (render the real card hidden), and which just landed (render with
 * the arrival glow). `completeDeal` is called by the DealLayer sprite when it
 * lands — or by the failsafe timer, whichever comes first.
 */
export function useDealAnimation(cards: DealCardSnapshot[], enabled: boolean) {
  const prevZonesRef = useRef<Map<string, string> | null>(null);
  const lastStartAtRef = useRef(-Infinity);
  const [deals, setDeals] = useState<ActiveDeal[]>([]);
  const [glowIds, setGlowIds] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const glowTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      for (const t of glowTimersRef.current.values()) clearTimeout(t);
    };
  }, []);

  const completeDeal = useCallback((instanceId: string) => {
    const failsafe = timersRef.current.get(instanceId);
    if (failsafe) {
      clearTimeout(failsafe);
      timersRef.current.delete(instanceId);
    }
    setDeals(prev =>
      prev.some(d => d.instanceId === instanceId)
        ? prev.filter(d => d.instanceId !== instanceId)
        : prev,
    );
    setGlowIds(prev => {
      if (prev.has(instanceId)) return prev;
      const next = new Set(prev);
      next.add(instanceId);
      return next;
    });
    const existingGlow = glowTimersRef.current.get(instanceId);
    if (existingGlow) clearTimeout(existingGlow);
    glowTimersRef.current.set(
      instanceId,
      setTimeout(() => {
        glowTimersRef.current.delete(instanceId);
        setGlowIds(prev => {
          const next = new Set(prev);
          next.delete(instanceId);
          return next;
        });
      }, GLOW_DURATION_MS),
    );
  }, []);

  useEffect(() => {
    const { dealt, nextZones } = diffDeals(prevZonesRef.current, cards);
    prevZonesRef.current = nextZones;

    // Cancel deals whose card left the hand mid-flight (undo, direct play).
    setDeals(prev => {
      const stillDealing = prev.filter(d => nextZones.get(d.instanceId) === 'hand');
      return stillDealing.length === prev.length ? prev : stillDealing;
    });

    if (!enabled || dealt.length === 0) return;

    if (prefersReducedMotion()) {
      // No flight — just mark the new cards with the landing glow.
      for (const id of dealt) completeDeal(id);
      return;
    }

    const now = performance.now();
    const { startAts } = scheduleDeals(now, lastStartAtRef.current, dealt.length);
    lastStartAtRef.current = startAts[startAts.length - 1];

    setDeals(prev => [
      ...prev,
      ...dealt.map((instanceId, i) => ({ instanceId, startAt: startAts[i] })),
    ]);
    dealt.forEach((instanceId, i) => {
      const t = setTimeout(
        () => completeDeal(instanceId),
        Math.max(0, startAts[i] - now) + DEAL_FAILSAFE_MS,
      );
      const existing = timersRef.current.get(instanceId);
      if (existing) clearTimeout(existing);
      timersRef.current.set(instanceId, t);
    });
  }, [cards, enabled, completeDeal]);

  const dealingIds = useMemo(
    () => new Set(deals.map(d => d.instanceId)),
    [deals],
  );

  return { deals, dealingIds, glowIds, completeDeal };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i dealanimation || echo "clean"`
Expected: `clean` (no errors mentioning the new files; the repo build is the real gate in Task 4).

- [ ] **Step 3: Commit**

```bash
git add app/play/hooks/useDealAnimation.ts
git commit -m "feat(play): useDealAnimation hook — staggered deal state with failsafes"
```

---

### Task 3: `DealLayer` flying-sprite component

**Files:**
- Create: `app/play/components/DealLayer.tsx`

**Interfaces:**
- Consumes: `ActiveDeal` from Task 2, `DEAL_FLIGHT_MS` from Task 1, `CardBackShape` from `app/shared/components/GameCardNode.tsx`.
- Produces: `<DealLayer sprites={DealSpriteSpec[]} onLanded={(instanceId: string) => void} />` with
  `DealSpriteSpec { deal: ActiveDeal; origin: { x: number; y: number }; originScale: number; target: { x: number; y: number; rotation: number }; cardWidth: number; cardHeight: number; image: HTMLImageElement | undefined }`.
  Coordinates are in the game-layer coordinate space (the caller renders DealLayer inside the already-scaled Konva `<Layer>`), `origin`/`target` are card top-left points matching how `GameCardNode` is positioned.

- [ ] **Step 1: Write the component**

```tsx
// app/play/components/DealLayer.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { CardBackShape } from '@/app/shared/components/GameCardNode';
import { DEAL_FLIGHT_MS } from '../hooks/dealAnimationCore';
import type { ActiveDeal } from '../hooks/useDealAnimation';

export interface DealSpriteSpec {
  deal: ActiveDeal;
  /** Card top-left at the deck pile, game-layer coords. */
  origin: { x: number; y: number };
  /** Initial group scale so the back matches the pile card size. */
  originScale: number;
  /** Final hand-slot position/rotation (same values the real card renders with). */
  target: { x: number; y: number; rotation: number };
  cardWidth: number;
  cardHeight: number;
  image: HTMLImageElement | undefined;
}

/** Fraction of the flight elapsed when the back→face flip starts. */
const FLIP_START_FRACTION = 0.3;
const FLIP_SHRINK_S = 0.09;
const FLIP_GROW_S = 0.14;

function DealSprite({
  spec,
  onLanded,
}: {
  spec: DealSpriteSpec;
  onLanded: (instanceId: string) => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const flipRef = useRef<Konva.Group | null>(null);
  const [showFace, setShowFace] = useState(false);

  // Mount-only animation: a sprite's spec is fixed for its lifetime — the
  // parent keys sprites by instanceId and unmounts them when the deal ends.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    let cancelled = false;
    const tweens: Konva.Tween[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const land = () => {
      if (!cancelled) onLanded(spec.deal.instanceId);
    };

    g.visible(false);
    const wait = Math.max(0, spec.deal.startAt - performance.now());
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        const node = groupRef.current;
        if (!node) return;
        node.visible(true);
        const flight = new KonvaLib.Tween({
          node,
          duration: DEAL_FLIGHT_MS / 1000,
          x: spec.target.x,
          y: spec.target.y,
          rotation: spec.target.rotation,
          scaleX: 1,
          scaleY: 1,
          easing: KonvaLib.Easings.EaseOut,
          onFinish: land,
        });
        tweens.push(flight);
        flight.play();

        // Mid-flight flip: shrink the inner group to a sliver, swap the back
        // for the face, grow it again. Skipped when we have no face image
        // (shouldn't happen for own cards — they stay a card back).
        if (spec.image) {
          timers.push(
            setTimeout(() => {
              const f = flipRef.current;
              if (cancelled || !f) return;
              const shrink = new KonvaLib.Tween({
                node: f,
                duration: FLIP_SHRINK_S,
                scaleX: 0,
                onFinish: () => {
                  if (cancelled) return;
                  setShowFace(true);
                  const fl = flipRef.current;
                  if (!fl) return;
                  const grow = new KonvaLib.Tween({
                    node: fl,
                    duration: FLIP_GROW_S,
                    scaleX: 1,
                  });
                  tweens.push(grow);
                  grow.play();
                },
              });
              tweens.push(shrink);
              shrink.play();
            }, DEAL_FLIGHT_MS * FLIP_START_FRACTION),
          );
        }
      }, wait),
    );

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      for (const t of tweens) t.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Group
      ref={groupRef}
      x={spec.origin.x}
      y={spec.origin.y}
      scaleX={spec.originScale}
      scaleY={spec.originScale}
      listening={false}
    >
      {/* offsetX/x pair recenters the flip axis on the card's vertical midline */}
      <Group ref={flipRef} offsetX={spec.cardWidth / 2} x={spec.cardWidth / 2}>
        {showFace && spec.image ? (
          <KonvaImage
            image={spec.image}
            width={spec.cardWidth}
            height={spec.cardHeight}
            cornerRadius={4}
            perfectDrawEnabled={false}
          />
        ) : (
          <CardBackShape width={spec.cardWidth} height={spec.cardHeight} />
        )}
      </Group>
    </Group>
  );
}

/**
 * Overlay of in-flight "deal" sprites — card backs flying from the deck pile
 * to their hand slots, flipping face-up mid-flight. Rendered inside the main
 * scaled game Layer, after the hand, so sprites draw above everything.
 */
export function DealLayer({
  sprites,
  onLanded,
}: {
  sprites: DealSpriteSpec[];
  onLanded: (instanceId: string) => void;
}) {
  if (sprites.length === 0) return null;
  return (
    <Group listening={false}>
      {sprites.map(spec => (
        <DealSprite key={spec.deal.instanceId} spec={spec} onLanded={onLanded} />
      ))}
    </Group>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/play/components/DealLayer.tsx
git commit -m "feat(play): DealLayer — Konva flying card sprites with mid-flight flip"
```

---

### Task 4: Wire into MultiplayerCanvas

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx`
  - imports (top of file, near the other `../hooks` imports)
  - hook call near `useLobArrivalEffect` (~line 596)
  - my-hand render block (~lines 6092–6154)

**Interfaces:**
- Consumes: `useDealAnimation` (Task 2), `DealLayer`/`DealSpriteSpec` (Task 3).
- Uses existing locals: `myCards`, `viewerKind`, `myZones.deck` (ZoneRect), `pileCardWidth`, `handCardWidth`, `handCardHeight`, `getCardImage`, `adaptCard`, `calculateHandPositions`.

- [ ] **Step 1: Add imports**

```ts
import { useDealAnimation } from '../hooks/useDealAnimation';
import { DealLayer, type DealSpriteSpec } from './DealLayer';
```

- [ ] **Step 2: Call the hook near the LOB glow hooks (~line 596)**

```ts
// "The deal" — flying-card animation when my cards move deck → hand
// (turn-start auto-draw, Draw button, draw N/bottom/random). Snapshot is
// id+zone only so the memo stays stable across unrelated card mutations.
const myCardZoneSnapshot = useMemo(() => {
  const flat: { id: string; zone: string }[] = [];
  for (const [zone, zoneCards] of Object.entries(myCards)) {
    for (const c of zoneCards) flat.push({ id: String(c.id), zone });
  }
  return flat;
}, [myCards]);
const {
  deals: activeDeals,
  dealingIds,
  glowIds: dealGlowIds,
  completeDeal,
} = useDealAnimation(myCardZoneSnapshot, viewerKind !== 'spectator');
```

Note: `myCardZoneSnapshot` recomputes when `myCards` changes identity, which happens on any of my card mutations — that's exactly when a diff is needed. The flat array is new each time, but the hook's effect depends on it intentionally (diff runs per change; `diffDeals` returns no deals when zones are unchanged).

- [ ] **Step 3: Hide dealing cards + glow on landing in the my-hand block (~line 6111)**

Inside `handCards.map((card, i) => {`, right after `const pos = positions[i]; if (!pos) return null;` add:

```ts
const idStr = String(card.id);
// Card is mid-deal: its DealLayer sprite is flying — don't render the
// real node yet (positions[] still reserves its slot in the fan).
if (dealingIds.has(idStr)) return null;
```

And on the `<GameCardNode>` add the landing glow prop:

```tsx
lobArrivalGlow={dealGlowIds.has(idStr)}
```

(The spectator early-return branch above stays untouched — spectators have the hook disabled, `dealingIds` is always empty for them.)

- [ ] **Step 4: Render the DealLayer after the my-hand Group**

Still inside the same IIFE, build sprite specs and return them with the hand. Replace the block's final `return (...)` structure with:

```tsx
const deckRect = myZones['deck'];
const dealSprites: DealSpriteSpec[] = [];
if (deckRect && activeDeals.length > 0) {
  const originScale = handCardWidth > 0 ? pileCardWidth / handCardWidth : 1;
  for (const deal of activeDeals) {
    const idx = handCards.findIndex(c => String(c.id) === deal.instanceId);
    if (idx === -1) continue;
    const pos = positions[idx];
    if (!pos) continue;
    dealSprites.push({
      deal,
      origin: {
        x: deckRect.x + deckRect.width / 2 - (handCardWidth * originScale) / 2,
        y: deckRect.y + deckRect.height / 2 - (handCardHeight * originScale) / 2,
      },
      originScale,
      target: { x: pos.x, y: pos.y, rotation: pos.rotation },
      cardWidth: handCardWidth,
      cardHeight: handCardHeight,
      image: getCardImage(handCards[idx]),
    });
  }
}

return (
  <Group>
    <Group>
      {handCards.map((card, i) => {
        /* ...existing card mapping (with Step 3 edits)... */
      })}
    </Group>
    <DealLayer sprites={dealSprites} onLanded={completeDeal} />
  </Group>
);
```

Key detail: sprite `key` is the instanceId and `DealSprite` animates mount-only, so re-renders mid-flight (target drift from hand re-layout) do NOT restart the tween; the sprite flies to the target captured at launch and any sub-pixel drift is corrected the instant the real card replaces it.

- [ ] **Step 5: Full test suite + build**

Run: `npx vitest run` → Expected: all pass.
Run: `npx next build` (or `npm run build`) → Expected: compiles clean. (Build matters here: tsconfig `strict:false` hides narrowing issues that only the build catches.)

- [ ] **Step 6: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx
git commit -m "feat(play): deal animation — cards fly from deck to hand on draw"
```

---

### Task 5: Manual verification in the running app

Use the repo's `verify` skill (mint real Supabase sessions, standalone Playwright against the dev server) with two accounts in one game.

- [ ] **Step 1: Start dev server, create a 2-player game** (per `verify` skill)
- [ ] **Step 2: Draw button** — press Draw in the game toolbar; expect: one card back lifts off my deck pile, flips face-up mid-flight, lands in the hand fan with the amber glow; hand slot reserved during flight (no overlap/jump).
- [ ] **Step 3: Turn-start auto-draw** — end turn from the other seat; on my turn start expect three cards dealt one-at-a-time (~200ms apart), each flipping and glowing on landing.
- [ ] **Step 4: Draw N via deck context menu** — draw 3 via "Draw" submenu; same staggered behavior.
- [ ] **Step 5: Spectator sanity** — spectate the game; no deal sprites render for spectators; hands render as before.
- [ ] **Step 6: Screenshot/video evidence for the PR.**

### Task 6: PR

- [ ] Push branch, open PR against `main` with before/after description, the Discord complaint context, and the verification evidence.
