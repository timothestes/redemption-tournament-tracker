# Lost Soul "deal" animation — design

**Date:** 2026-07-07
**Status:** Approved design, pre-implementation
**Area:** Multiplayer game canvas (`app/play`), Goldfish canvas (`app/goldfish`), shared game components

## Problem

When a Lost Soul lands in the Land of Bondage (LOB), the current arrival is a
full-screen **cinematic**: a ~900ms DOM overlay that dims the whole board with a
dark-amber vignette, fans out up to 3 chained soul images, "forges" a gold chain
over them, and titles each in Cinzel
([`LostSoulCinematic.tsx`](../../../app/shared/components/LostSoulCinematic.tsx),
[`useLostSoulCinematic.ts`](../../../app/shared/hooks/useLostSoulCinematic.ts),
`.lsc-*` keyframes in [`globals.css`](../../../app/globals.css) lines 290–511).

This happens many times per game and grabs the camera each time — it reads as a
cutscene interrupting play. The card itself never moves: the LOB is an
auto-arrange zone, so when the server marks a card `zone: 'land-of-bondage'`,
Konva re-renders it directly at its final slot and it pops into place.

We want to replace the cutscene with a **gesture**: the soul is visibly *dealt*
from the deck into its LOB slot — on the board, peripheral, non-interrupting.

## Goals

- Replace the full-screen cinematic with an on-board "deal from deck" motion.
- Keep the arrival legible and satisfying without seizing the camera.
- Handle soul chains (multiple souls arriving in one tick) gracefully.
- Preserve soul identity feedback (which soul arrived) in a lightweight way.
- Respect `prefers-reduced-motion`.
- Keep the multiplayer and Goldfish canvases in parity.

## Non-goals

- No change to server-side soul routing logic (`spacetimedb/src/cardAbilities.ts`
  and the LOB auto-route in `spacetimedb/src/index.ts`). This is purely a client
  presentation change.
- No new deal/flight animation for non-soul cards or other zones. Scope is Lost
  Souls entering the LOB.
- No change to the existing amber landing glow behavior beyond it becoming the
  sole "it stuck" beat.

## Current behavior (what fires today)

Two independent effects on LOB arrival:

1. **Full-screen cinematic** (souls only) — the DOM overlay described above.
   Triggered from [`MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx)
   via `useLostSoulCinematic(lobSoulsForCinematic, soulsHydrated)` and rendered as
   `<LostSoulCinematic ... />`. Mirrored in
   [`GoldfishCanvas.tsx`](../../../app/goldfish/components/GoldfishCanvas.tsx).
2. **Per-card amber glow** (all LOB arrivals) —
   [`useLobArrivalEffect.ts`](../../../app/shared/hooks/useLobArrivalEffect.ts)
   tracks newly-arrived IDs and returns a timed flag; a Konva stroke-pulse tween
   in [`GameCardNode.tsx`](../../../app/shared/components/GameCardNode.tsx) lines
   133–179 blooms then fades an amber border over ~1.8s.

The card is auto-placed: it appears instantly at its final slot. There is no
existing deal/fly-to/position primitive on the canvas — the only imperative Konva
animation is the glow tween.

## Design

### Trigger & detection

Reuse the new-arrival detector that already backs the glow
(`useLobArrivalEffect`'s "new IDs entering the LOB" logic). For each newly-arrived
**soul** ID we start a deal flight. Non-soul LOB arrivals keep the glow only (no
change).

The initial subscription hydration must not fire deals for pre-existing souls on
load/reconnect. Reuse the same hydration gate the cinematic uses today
(`soulsHydrated = !gameState.isLoading && !!gameState.myPlayer`), so a fresh
subscription push does not deal out every soul already in the LOB.

### Deal source (which deck a soul flies from)

The flight starts at the deck rect for the owning side and ends at the soul's
computed final LOB slot (the same x/y the settled `GameCardNode` renders at):

| Soul location        | Source rect                                   |
|----------------------|-----------------------------------------------|
| My LOB               | `sidebar.player.deck` (`ZoneRect`)            |
| Opponent LOB         | `sidebar.opponent.deck` (`ZoneRect`)          |
| Paragon shared LOB   | `zones.soulDeck` (`ZoneRect`)                 |

Each deck sits near its own LOB, so every flight is a short local hop, not a
full-board sweep. This is what keeps the motion subtle. If a source rect is
absent for any reason, fall back to instant placement + glow (see Edge cases).

### Motion (one soul)

- Render a **face-up** soul flyer at the deck rect, sized to the deck/pile card
  size.
- Tween position deck → final slot along a **slight arc**, easing **ease-out**
  with a small settle (a touch of overshoot/scale-down at the end).
- Scale interpolates from pile size → LOB-card size over the flight.
- Duration ≈ **380ms** (tunable).
- On land: reveal the real settled `GameCardNode` at its slot, trigger the
  existing amber glow, and remove the flyer.

The soul is face-up throughout (no flip) — chosen for clarity over reveal-drama,
consistent with trimming flash.

### Batching (soul chains)

When multiple souls arrive in one tick, deal them out **staggered ~100ms apart**
(dealer-flick cadence) rather than simultaneously. The stagger paces the batch
naturally; there is no arbitrary cap (this replaces the old
`MAX_SHOWN_CARDS = 3` fan-out). Flights run concurrently once started, so a large
batch still resolves quickly.

### Landing feedback

- **Glow** — the existing amber stroke-pulse becomes the sole "it stuck" beat,
  fired at land time.
- **Toast** — on land, call `showGameToast(...)` (module-level dispatcher in
  [`GameToast.tsx`](../../../app/shared/components/GameToast.tsx)) with a brief
  line naming the soul, e.g. `Lost Soul dealt: <name>`. Use `simplifyLostSoulName`
  from `cardAbilities.ts` for the display name. For a batch, prefer a single
  summarizing toast over N toasts (e.g. `2 Lost Souls dealt` or the names joined),
  to avoid a toast stack — exact copy is a tunable during implementation.

### Reduced motion

When `prefers-reduced-motion` is set: skip the flight entirely, place the card
instantly, and keep a single short glow. Mirrors today's reduced-motion fallback
in the cinematic CSS.

### What gets retired

- Stop mounting `LostSoulCinematic` and calling `useLostSoulCinematic` in both
  `MultiplayerCanvas.tsx` and `GoldfishCanvas.tsx`.
- Remove `LostSoulCinematic.tsx`, `useLostSoulCinematic.ts`, and the `.lsc-*`
  keyframes/classes in `globals.css` (lines 290–511) once nothing references them.
- Keep `useLobArrivalEffect` and the `GameCardNode` glow tween.

## Components & interfaces

### `LostSoulDealLayer` (new — the one architectural unit)

A dedicated, isolated Konva overlay that owns transient flying soul cards.

- **What it does:** given a set of pending deals, renders each as a temporary
  face-up soul image on its own layer, tweens it from its source deck rect to its
  target slot, and on arrival fires an `onLand(soulId)` callback (which reveals
  the settled node, triggers the glow, and shows the toast).
- **Hiding the settled node during flight:** the canvas keeps a set of in-flight
  soul IDs. Any `GameCardNode` whose ID is in that set renders at **opacity 0**
  (or is skipped) so the soul is not visible in its slot while its flyer is still
  travelling — otherwise the card appears in two places at once. `onLand` removes
  the ID from the set, so the settled node becomes visible exactly as the flyer is
  removed, producing a seamless hand-off. In-flight IDs are the single source of
  truth shared between the deal layer and the board render.
- **How you use it:** the canvas feeds it deals derived from the new-arrival
  detector. Roughly:
  ```
  type PendingDeal = {
    soulId: string;
    imageUrl: string;
    name: string;
    from: ZoneRect;        // deck / soulDeck rect
    to: { x: number; y: number; width: number; height: number }; // final slot
    delayMs: number;       // stagger offset within the batch
  };
  ```
  `<LostSoulDealLayer deals={pendingDeals} onLand={handleLand} />`
- **What it depends on:** Konva (imperative `Tween`, same primitive as the glow),
  the resolved soul image URL (`resolveCardImageUrl` / forge resolver — already
  computed for the old `lobSoulsForCinematic` list), and the layout rects.

**Why a transient flyer, not tweening the real node from an offset:** the LOB is
auto-arranged and re-runs its layout whenever *another* card lands. Tweening the
settled node in place would let a second arrival reflow a card mid-flight. A
separate flyer layer is immune to board reflows, has one clear purpose, and
mirrors how the old cinematic was its own overlay. The settled board render is
never touched by the animation.

### Changes to existing units

- **`MultiplayerCanvas.tsx`** — replace the `useLostSoulCinematic` +
  `<LostSoulCinematic/>` wiring with: derive `PendingDeal`s from the soul
  new-arrival detector (source rects from `sidebar`/`zones`, target from the LOB
  layout positions already computed for rendering), render `<LostSoulDealLayer/>`,
  and implement `onLand` (glow + toast). The existing `lobSoulsForCinematic`
  image/name resolution is reused to build deals.
- **`GoldfishCanvas.tsx`** — same replacement, single-player mirror.
- **`useLobArrivalEffect.ts`** — reused as-is for the glow; may expose the fresh
  soul IDs to the canvas if not already convenient (small, additive).

## Data flow

1. Server sets a card `zone: 'land-of-bondage'` with a `zoneIndex`.
2. Canvas re-renders; the LOB layout computes the card's final slot x/y (as today).
   The soul's ID is added to the in-flight set, so its settled `GameCardNode`
   renders at opacity 0 until its flight lands.
3. New-arrival detector flags the soul ID as fresh (gated by hydration).
4. Canvas builds a `PendingDeal` (source deck rect + target slot + staggered
   delay + resolved image/name) and passes it to `LostSoulDealLayer`.
5. The layer tweens the flyer deck → slot.
6. `onLand` reveals the settled node, fires the amber glow, and shows the toast;
   the flyer is removed.

## Edge cases & error handling

- **Missing source rect** (deck rect undefined, unusual layout/format): skip the
  flight, place instantly + glow. Never block the card from appearing.
- **Missing/slow image:** the flyer uses the same resolved URL path as the
  settled node; if the image is not yet cached, fall back to placing instantly (or
  a plain placeholder flyer) rather than delaying the card. The settled node's
  existing image-load handling is authoritative.
- **Reconnect / hydration:** pre-existing souls must not deal on load — hydration
  gate as above.
- **Rapid/large batches:** stagger paces them; flights are concurrent. No cap, but
  keep the flyer layer lightweight (image + one tween each) so a big batch stays
  cheap. Removed the old shadow-blur for perf; do not reintroduce heavy shadows on
  flyers.
- **Strict-mode double-invoke:** own timers/tween cleanup so a double effect
  invoke doesn't double-deal (the cinematic hook already solved this pattern;
  follow it).
- **Card removed mid-flight** (e.g. immediately rescued): if the settled node no
  longer exists on land, drop the flyer silently. Always clear the soul's ID from
  the in-flight set on land/cleanup so a removed soul can't leave a permanently
  hidden node behind.

## Testing

- **Reduced-motion:** with `prefers-reduced-motion`, souls place instantly, glow
  once, no flight.
- **Single soul:** flies from the correct deck (mine vs opponent vs Paragon
  soulDeck) to the correct slot; toast names the soul; glow fires on land.
- **Batch/chain:** N souls stagger and each land in their own slot; single
  summarizing toast (no stack).
- **Reconnect:** existing LOB souls do not re-deal on subscription hydration.
- **Goldfish parity:** same behavior in single-player.
- **No cinematic regressions:** the old vignette never appears; `.lsc-*` styles
  removed with no dangling references.

## Tunables (decide during implementation)

- Flight duration (~380ms), arc height, easing/settle amount.
- Stagger interval (~100ms).
- Toast copy for single vs batch, and whether a batch shows one line or names.

## File touch list

- **New:** `app/shared/components/LostSoulDealLayer.tsx`
- **Edit:** `app/play/components/MultiplayerCanvas.tsx`,
  `app/goldfish/components/GoldfishCanvas.tsx`
- **Reuse:** `app/shared/hooks/useLobArrivalEffect.ts`,
  `app/shared/components/GameToast.tsx`,
  `app/shared/components/GameCardNode.tsx` (glow),
  `app/play/layout/multiplayerLayout.ts` (deck / soulDeck rects),
  `spacetimedb`/`lib` `cardAbilities.ts` (`isLostSoulCard`, `simplifyLostSoulName`)
- **Remove (after references gone):** `app/shared/components/LostSoulCinematic.tsx`,
  `app/shared/hooks/useLostSoulCinematic.ts`, `.lsc-*` block in `app/globals.css`
