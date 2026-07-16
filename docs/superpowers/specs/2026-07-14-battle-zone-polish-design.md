# Battle Zone Polish — Design Spec

Date: 2026-07-14
Status: Approved for implementation.
Scope: Two targeted fixes to the shipped Field of Battle feature (PR #197). No
schema changes, no new reducers. Builds on `2026-07-12-battle-zone-design.md`.

## Problem statement

1. **Jerky/abrupt open & close.** When the band opens or closes the transition
   reads as a hard cut in places.
2. **"Willy-nilly" card placement on auto-return.** When the battle closes,
   some cards land stacked on top of / overlapping cards already sitting in the
   territory.

## Fix 1 — Occupancy-aware auto-return placement (server)

### Root cause
`autoReturnBattleCards` (`spacetimedb/src/index.ts` ~2250) returns
origin-territory survivors to their exact pre-battle spot, but routes three
kinds of card through `nextFreeSpot` instead:
- characters whose `originZone !== 'territory'` (drafted attackers, characters
  played straight into battle),
- kept `place` enhancements,
- the rule-5 fallback (Dominants/Artifacts/etc. with no stored origin).

`nextFreeSpot` (~2285) fans from the top-left corner `(0.03, 0.05)` on a fresh
per-owner counter that is **blind to what is already on the board** — neither
the cards that never entered the battle, nor the survivors that just reclaimed
their origin spots. So fanned cards pile onto whatever occupies the top-left.

### Design
Make free-spot selection occupancy-aware, contained to this one routine:

1. **Build a per-owner occupied set** of normalized territory positions before
   any fanning:
   - every card currently in that owner's `territory` that is **not** in the
     battle (it stayed put), plus
   - the origin positions (`originPosX/originPosY`) of battle cards that will
     return via `originZone === 'territory'` (they reclaim those exact spots).
2. **Greedy placement** replaces the blind counter: walk the existing fan-grid
   candidate cells in reading order, skip any candidate within a collision
   radius (~one card footprint in normalized units) of an occupied position,
   place at the first free cell, then add that cell to the occupied set so
   fanned cards do not stack on each other either.

Structure: compute the occupied set up front (origin-return positions are
deterministic — just the origin fields of the origin-territory battle cards), so
the single routing pass is preserved; only `nextFreeSpot` changes from a blind
counter into an occupancy-aware scan seeded with that set.

Philosophy unchanged ("app computes, players decide") — everything stays
draggable afterward; this only stops the initial drop from landing on top of
existing cards.

### Out of scope (mentioned, not touched)
`move_cards_batch`'s territory auto-fan (the `~2982` reference `nextFreeSpot`
mirrors) is blind the same way. That is a pre-existing issue outside the
reported bug and is left alone.

### Tests
Extend the auto-return routing unit test with a "territory already occupied"
case: a survivor returning from a non-territory origin must be placed clear of a
pre-existing territory card and clear of an origin-returning survivor.

## Fix 2 — Animation polish (client, `MultiplayerCanvas.tsx`)

### Root cause
- The band **background pops in instantly** on open (deliberately un-tweened to
  avoid exposing raw board art as a bright flash — see the comment at ~627) but
  **fades out** on close: asymmetric.
- The band **chrome** (header bar, STR/TGH chips, dashed centerline) mounts and
  unmounts with `battleActive`, so it **pops** in and out with the layout flip.
- (Explicitly deferred, per owner: cards crossing territory↔battle teleport
  because each zone renders in its own clipped Konva group. That cross-zone
  glide — via the `DealLayer` overlay-sprite pattern — is the next lever if this
  pass is not enough. Not in this scope.)

### Design
Quick, low-risk, flash-safe polish reusing the band-bg lifecycle already in the
file (`bandBgVisible` + `lastBandRectRef` + node-ref tween):

1. **BG open "settle."** On open, start the bg rect at full opacity (1.0) and
   tween down to the resting `BAND_BG_OPACITY` (0.75) over ~160ms. Because it
   only ever gets *more* opaque than rest during the transition, it can never
   expose the bright-flash the hard cut was avoiding — but the eye catches a
   soft materialize instead of a hard pop. Close keeps its existing 200ms fade.
2. **Chrome fade in/out.** Give the chrome group a node ref and drive its
   opacity with a tween: 0→1 on open (~160ms), 1→0 on close (200ms), managed in
   the same effect as the bg so the whole band presentation shares one
   lifecycle. Keep the chrome mounted through the close (gate on
   `battleActive || bandBgVisible`, geometry from `lastBandRectRef`, content
   from a last-value snapshot ref) so the fade-out renders stable content
   instead of recomputing from emptied battle rows. The chrome sits above the
   opaque bg, so fading it is always flash-safe.
3. **Consistent timing.** BG close, chrome fade, and the existing card reflow
   (`useHandLayoutTween`, 200ms EaseOut) all share the 200ms/EaseOut curve;
   the open settle uses ~160ms EaseOut.

### Optional stretch (not in this scope unless requested)
- Hand-card **size tween** (removes the accepted ~13% resize snap).
- Territory **background-rect glide** (so the shrink/grow reads as cohesive as
  the cards).

### Tests
Manual/visual (Konva canvas animation is not unit-tested in this codebase). The
existing battle E2E and layout-invariant tests must still pass.

## Deployment
Fix 1 changes `spacetimedb/src/index.ts` logic only (no schema change), so it
needs a module republish via the `spacetimedb-deploy` skill — a normal publish,
**no `--clear`** (no schema migration). Bindings need no regeneration (no
signature change). Fix 2 is client-only.
