# Paragon Shared LoB — Polish & Interaction Design

**Status:** Draft — follow-up to `2026-04-18-paragon-soul-deck-implementation.md` (Tasks 14–15 already shipped).

## Context

Tasks 14 and 15 introduced a shared Land of Bondage and Soul Deck pile for Paragon multiplayer. Manual audit surfaced five issues:

1. The shared LoB band is roughly 3× too tall, pushing the player's hand off-screen.
2. The shared LoB has no background fill (just a label floats on the cave art).
3. Souls in the shared LoB render at the small per-seat-LoB card size despite the band being much taller.
4. The right sidebars (deck/discard/reserve/banish/lor) leave a large empty vertical band beside the shared LoB.
5. Several interactions are missing: drag-back from a player's territory to the shared LoB; right-click "Top of Deck" / "Bottom of Deck" / "Shuffle into Deck" route to the player's *private* deck rather than the shared Soul Deck; refill fires on every exit from the shared LoB rather than only on rescue.

This design addresses all five.

## Section 1 — Layout reallocation

**File:** `app/play/layout/multiplayerLayout.ts`

Paragon vertical structure becomes:

```
[opp hand]
[opp territory]              ← shifted up, gains some height
[shared LoB band]            ← shrunk to one LoB's worth
[player territory]           ← gains some height
[player hand]
```

Concrete changes inside the `format === 'Paragon'` branch:

- **Drop the opp LoB slot at the top.** New `oppTerritoryY = oppHandHeight` (was `oppHandHeight + oppLobHeight`).
- **Shrink the shared band** to one LoB's visual weight: `sharedBandHeight = oppLobHeight + gap * 2`.
- **Redistribute the freed budget** (`dividerHeight + playerLobHeight - gap * 2`): split evenly into `oppTerritoryHeight` and `playerTerritoryHeight`. Each gains roughly half the freed pixels.
- **Sidebar bounds extend across the shared band's vertical center:**
  - Opp sidebar: `oppHandHeight` → `sharedBandY + sharedBandHeight / 2`
  - Player sidebar: `sharedBandY + sharedBandHeight / 2` → `playerHandY`
- **Recompute `lobCard` for Paragon** from `sharedBandHeight` (still leaves headroom for label + accessory peek). Souls render at the right size for the new band.

The collapsed legacy zero-height rects for `opponentLob`, `divider`, `playerLob` are kept so existing render sites that touch those keys stay silent no-ops.

## Section 2 — Background fills + drop target

**File:** `app/play/components/MultiplayerCanvas.tsx`

- **Shared LoB background `<Rect>`** matching the per-seat LoB style: `fill="#1e1610"`, `stroke="#6b4e27"`, `cornerRadius={3}`, `opacity={0.45}`. Rendered in the existing zone-backgrounds block, gated on `normalizedFormat === 'Paragon' && mpLayout.zones.sharedLob`.
- **Soul Deck background `<Rect>`** with the same visual style at `mpLayout.zones.soulDeck`.
- **Drop target.** Add the shared LoB rect to the drop-zone hit-testing path (currently keyed off `myZones` / `opponentZones` — neither contains `sharedLob`). When a card drops inside the rect:
  - Compute normalized 0–1 position within the shared band.
  - Call `gameState.moveCard(BigInt(id), 'land-of-bondage', undefined, posX, posY, '0')` — the `'0'` is the "shared" sentinel ownerId.
  - Server move_card reducer must accept ownership transfer to `'0'` for soul-origin cards. Verify the existing move_card path; add the smallest possible diff if it doesn't already (a `targetOwnerId === '0'` clause that only fires for `isSoulDeckOrigin === true`).
- **Right-click on the shared LoB background** opens the existing zone menu (spawn lost soul). Spawned cards land in the shared pile (`ownerId === 0n`), not the right-clicker's pile. Wire by passing `targetPlayerId: '0'` (or undefined + a Paragon branch in the spawn handler).

## Section 3 — Right-click on a shared soul card

**Files:**
- `app/play/components/MultiplayerCanvas.tsx` — CardContextMenu wiring
- `app/shared/components/DeckExchangeModal.tsx` — accept a `targetZone` prop (default `'deck'`) so it can drive the soul-deck instead

When the right-clicked card has `zone === 'land-of-bondage'` AND `ownerId === 0n`, redirect four deck-targeting actions:

| Action | Currently | Becomes |
|---|---|---|
| Top of Deck | `moveCardToTopOfDeck(id)` → player's private deck | `gameState.moveCard(id, 'soul-deck', '0')` (top of soul deck) |
| Bottom of Deck | `moveCardToBottomOfDeck(id)` → player's private deck | `gameState.moveCard(id, 'soul-deck')` (bottom; server appends) |
| Shuffle into Deck | `shuffleCardIntoDeck(id)` → adds to player's private deck then shuffles it | `gameState.moveCard(id, 'soul-deck')` followed by `gameState.shuffleSoulDeck()` (card joins the soul deck; pile re-shuffles) |
| Exchange with Deck | `onExchange([id])` opens `DeckExchangeModal` against `zones.deck` | Open `DeckExchangeModal` with `targetZone='soul-deck'`, sourcing replacement cards from the shared soul deck |

All other context menu rows (move to my LoR = rescue, discard, banish, hand, etc.) keep their existing per-player routing.

**Implementation notes:**
- Detect "shared soul" at the call site that mounts `CardContextMenu` (right-click on a shared LoB card). Pass overridden `actions.moveCardToTopOfDeck` / `.moveCardToBottomOfDeck` / `.shuffleCardIntoDeck` props plus a customized `onExchange` that opens `DeckExchangeModal` with the soul-deck target.
- `CardContextMenu.tsx` stays unchanged — only the props passed in differ.
- `DeckExchangeModal.tsx` adds an optional `targetZone?: ZoneId` prop (default `'deck'`). All internal `zones.deck` reads become `zones[targetZone]`, and the final move at the end of the exchange flow goes to `targetZone`. The host wraps the modal in a `ModalGameProvider` whose `zones[targetZone]` exposes the soul-deck cards (the `soulDeckModalGameValue` set up in Task 15 already does this — extend it to expose the soul-deck under both `'soul-deck'` and the props-supplied `targetZone`, or restructure cleanly).
- "Shuffle into Deck" is two reducer calls (move + shuffle) rather than a single atomic reducer. Acceptable — the visible state converges and there's no race window where the pile is in a broken state.

## Section 4 — Rescue-only refill semantics

**File:** `spacetimedb/src/index.ts` (the `move_card` reducer's refill clause); plus `app/goldfish/state/gameReducer.ts` for goldfish parity.

Current refill condition: `card.isSoulDeckOrigin === true && card.zone === 'land-of-bondage' && toZone !== 'land-of-bondage'`.

New refill condition: refill *only* when the soul is genuinely rescued — `toZone === 'land-of-redemption'`.

Rationale (matches Redemption Paragon rules and the new "drag back" workflow):
- Moving a soul to your territory, hand, soul-deck, discard, etc. is a *temporary* placement and shouldn't change the visible LoB count.
- Moving a soul to *any* `land-of-redemption` (yours or your opponent's) is a real rescue and triggers the standard refill (pull next from soul-deck, place into shared LoB).
- The "drag back to shared LoB" workflow naturally produces no double-counting: drag soul → territory (no refill), drag back → land-of-bondage (no refill, no change in count).

Apply the same condition change in goldfish so single-player practice matches multiplayer behavior. Goldfish's existing tests for rescue refill should continue to pass; tests for non-rescue refill (territory, hand) need to be updated to assert *no* refill.

## Section 5 — Ownership on rescue

**File:** `spacetimedb/src/index.ts` (move_card reducer's existing rescue branch)

Already implemented in Task 12: when a soul-origin card moves from `land-of-bondage` to `land-of-redemption`, ownership transfers from `0n` to the rescuer's playerId. No change required — included here so reviewers know this interaction is intact under the new refill semantics.

## Out of scope

- Visual polish of the Soul Deck pile (dimensions, label styling) beyond what naturally improves with Section 1's resizing.
- Any change to the goldfish UI other than the refill semantics in Section 4.
- Any change to the server reducer beyond the refill condition + (if needed) accepting `targetOwnerId === '0'` for shared LoB drops.
- Drag-from-Soul-Deck (still deferred per Task 15 notes; right-click reveal remains the primary path).
- Per-card animations / arrival glow specific to refill events.

## Verification

1. **Layout — visual.** Paragon multiplayer game: hand fully visible, sidebars touch the shared LoB band's vertical edges, shared LoB visually weighs roughly the same as a single per-seat LoB, souls render at a comfortable size.
2. **Drag-back.** From shared LoB, drag soul → my territory → drag back to shared LoB. Both moves succeed. LoB count returns to 3. Soul Deck count unchanged throughout.
3. **Right-click → top of soul deck.** Right-click a soul, "Top of Deck". Soul Deck count goes up by 1 (soul moved into the deck, pinned to top). LoB count drops by 1, *no refill fires*.
4. **Right-click → shuffle into deck.** Right-click a soul, "Shuffle into Deck". Soul Deck count goes up by 1 (soul moved into the deck, pile re-shuffled). LoB count drops by 1, *no refill fires*.
5. **Right-click → exchange with deck.** Right-click a soul, "Exchange with Deck". Modal opens showing the shared soul deck's cards (not the player's private deck). Selecting one swaps it with the soul: soul goes into soul-deck, replacement comes out into a player-chosen destination per the existing exchange flow.
6. **Rescue still refills.** Drag soul → my LoR. LoR gains 1. LoB refills back to 3 from soul deck (soul deck count drops by 1). Both windows sync.
7. **Goldfish parity.** Same Paragon deck loaded in goldfish: territory/hand placements don't trigger refill, only LoR placement does.

## File touch summary

- `app/play/layout/multiplayerLayout.ts` — layout reallocation (Section 1)
- `app/play/components/MultiplayerCanvas.tsx` — backgrounds, drop target, context menu wiring (Sections 2 + 3)
- `app/shared/components/DeckExchangeModal.tsx` — `targetZone` prop (Section 3)
- `spacetimedb/src/index.ts` — refill condition; possibly accept shared-ownerId on move (Sections 4 + 2)
- `app/goldfish/state/gameReducer.ts` — refill condition parity (Section 4)
- Any goldfish test files asserting non-rescue refill (Section 4)
- Regenerated client bindings if any reducer signature changed (`make` or skill `spacetimedb-deploy`)
