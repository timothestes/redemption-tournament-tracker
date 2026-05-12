# Multiplayer Discord Feedback Batch — Design

**Date:** 2026-05-11
**Status:** Spec — pending implementation
**Source:** Discord feedback from Kevinthedude (5/9/26)

## Overview

Three independent multiplayer-mode polish features bundled in one spec:

1. **Persistent look popup** — toggle inside `DeckPeekModal` to suppress auto-close-on-empty so players can take multiple cards from a single look (e.g. cards that say "take up to 2") and recover from misclicks.
2. **Always-visible Priority button** — the toolbar's `Priority` action becomes available to the active player too, so the offense can request initiative in battle without losing the End-Turn button.
3. **Three Nails (GoC) reset** — right-click Three Nails (GoC) in territory to activate its printed reset ability, gated by an opponent-approval toast.

Order of implementation: 1 → 3 → 2 (smallest blast radius first; 2 is full-stack).

## Feature 1 — Persistent Look Popup

### Files
- [`app/shared/components/DeckPeekModal.tsx`](../../../app/shared/components/DeckPeekModal.tsx)

### Change
Add a `keepOpen` toggle near the modal's title bar (top-right area, inside the modal box).

- New state: `const [keepOpen, setKeepOpen] = useState(false)` — per-modal-instance, **not** persisted across looks.
- Toggle UI: small switch + label "Keep open" near the existing close affordance.
- Auto-close-on-empty (lines 234–238) becomes conditional:
  ```
  if (!hasRemaining && peekedIds.length > 0 && onClose && !keepOpen) {
    onClose();
  }
  ```
- Outside-click and Esc behavior unchanged. This matches the peer modals (`ZoneBrowseModal`, `DeckSearchModal`, `OpponentBrowseModal`, `DeckExchangeModal`) which all stay open through multiple actions and dismiss only on outside-click / Esc / explicit close.
- The `handleCloseAction('top')` underdeck-rest action is unaffected — outside-click still triggers it; if the look is empty when dismissed, it's a no-op.

### Empty state
When `keepOpen` is ON and all cards have been moved out, the modal shows the existing empty grid (no cards rendered). User dismisses via Esc / outside-click / X.

### Mode coverage
`DeckPeekModal` is shared between goldfish and multiplayer modes. The toggle works identically in both — no mode-specific branching.

### Out of scope
- Persisting the toggle state across looks (per-look opt-in is intentional).
- Showing already-moved cards as a greyed-out reference list.
- Drag-back-to-deck undo from the modal (separate concern; existing undo stack handles move undo).

## Feature 3 — Always-Visible Priority Button

### Files
- [`app/shared/components/GameToolbar.tsx`](../../../app/shared/components/GameToolbar.tsx) (lines 146–160)

### Change
Replace the mutually-exclusive End Turn / Priority swap with both buttons rendered side-by-side whenever `isMultiplayer`.

Current logic:
```
isMultiplayer && isMyTurn         → End Turn button
isMultiplayer && !isMyTurn        → Priority button
```

New logic:
```
isMultiplayer && !isFinished      → both End Turn and Priority
  - End Turn:  enabled iff isMyTurn
  - Priority:  enabled iff !hasPendingPriority
```

Buttons stay in the same toolbar row, in this order: End Turn first, Priority second. Disabled state uses the existing greyed-out styling (no hide).

### Backend
No changes required. The existing `requestZoneSearch('action-priority')` reducer does not gate on whose turn it is — verified by reading the call sites and the `request_opponent_action` reducer in [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts).

### Chat log
Existing strings in [`app/play/components/ChatPanel.tsx`](../../../app/play/components/ChatPanel.tsx) ("requested action priority", "granted action priority") stay as-is. Active-player priority requests log identically to non-active-player ones — matches Kevin's mental model that "action priority" and "initiative" are the same request type.

### Out of scope
- Adding a separate `Initiative` button distinct from `Priority`.
- Moving End Turn into the phase progression bar.
- Renaming "action priority" anywhere in chat or UI.

## Feature 2 — Three Nails (GoC) Reset

### Card text
> Three Nails (GoC) — Artifact (Apostle/Christ-related). "If opponent has board advantage, you may banish this card. If you do, shuffle all cards in play, set-aside areas and hands and each player must draw 8. Regardless of protect abilities. Cannot be negated."

The "opponent has board advantage" condition is a strategic judgment. The opponent-approval gate IS the verification — if the opponent agrees they have board advantage, they approve.

### Card registry — both copies in parity

Files:
- [`lib/cards/cardAbilities.ts`](../../../lib/cards/cardAbilities.ts)
- [`spacetimedb/src/cardAbilities.ts`](../../../spacetimedb/src/cardAbilities.ts)

Add a new variant to the `CardAbility` union:
```ts
| { type: 'three_nails_reset' }
```

Register on the card:
```ts
'Three Nails (GoC)': [{ type: 'three_nails_reset' }],
```

Source zones default (`territory + land-of-bondage + land-of-redemption`) — Three Nails is an artifact in territory.

Parity is enforced by [`lib/cards/__tests__/cardAbilities.test.ts`](../../../lib/cards/__tests__/cardAbilities.test.ts).

### Right-click flow (client)

In [`app/play/components/MultiplayerCanvas.tsx`](../../../app/play/components/MultiplayerCanvas.tsx) — the existing right-click context-menu builder. When the card has a `three_nails_reset` ability, add a single menu item: **"Activate Reset (banishes Nails)"**.

Clicking it calls the existing `dispatch_card_ability(sourceCardId, abilityIndex)` reducer (same entrypoint as Mayhem, Delivered, etc.). The dispatch reducer routes to a new `three_nails_reset` branch in [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts) which inserts a `ZoneSearchRequest`:
- `requesterId = player.id`, `targetPlayerId = opponent.id`
- `zone = 'territory'` (placeholder; not used by this action), `action = 'three_nails_reset'`
- `actionParams = JSON.stringify({ sourceInstanceId: source.id.toString() })` — so the executor can find the exact Three Nails card to banish even if the player owns multiple
- No immediate effect runs; this is all-or-nothing pending approval

The "you already have a pending request" guard (existing in the dispatch reducer) prevents stacking.

### Approval toast (opponent's client)

Reuse the existing `incomingSearchRequest` rendering in `MultiplayerCanvas.tsx` (~line 6241–6275, where `action-priority` is special-cased). Add a new branch for `three_nails_reset`:
- Toast text: **"{requester} is activating Three Nails (GoC) — shuffles all hands, territories, and lands of bondage; both players draw 8. Approve?"**
- Buttons: **Approve** / **Deny**
- On approve: opponent's client calls the existing `approve_zone_search` reducer to flip `status='approved'`; this triggers the requester's existing `approvedSearchRequest` watcher in `MultiplayerCanvas.tsx` (~line 2099–2108), which dispatches based on `action`. Add a new case for `three_nails_reset`: requester's client fires the new `three_nails_reset_execute({ requestId })` reducer.
- On deny: opponent's client calls the existing `deny_zone_search` reducer; chat logs denial via the existing path.

This keeps the pattern consistent with `shuffle_and_draw` (Mayhem) — opponent approves, requester executes.

### Server reducer — `three_nails_reset_execute`

New reducer in [`spacetimedb/src/index.ts`](../../../spacetimedb/src/index.ts).

Signature:
```ts
export const three_nails_reset_execute = spacetimedb.reducer(
  { requestId: t.u64() },
  (ctx, { requestId }) => { /* ... */ },
);
```

Steps:
1. **Validate** the `ZoneSearchRequest`: exists, `requesterId === ctx.sender` (requester executes after approval), `status === 'approved'`, `action === 'three_nails_reset'`. Throw `SenderError` otherwise.
2. **Locate the source card** — parse `actionParams` for `sourceInstanceId`, find the card by primary key, then verify `gameId` matches, `ownerId === request.requesterId`, `cardName === 'Three Nails (GoC)'`, `zone === 'territory'`. If any check fails (e.g. moved/negated mid-flight), no-op with a chat event "Three Nails (GoC) no longer in play — reset cancelled" and mark request `completed`.
3. **Banish** Three Nails (GoC): move to `banish` zone, owner unchanged.
4. **Sweep zones** for each player in the game:
   - Collect cards in `hand`, `territory`, `land-of-bondage`.
   - Routing per card:
     - **Shared paragon soul-deck cards** (Lost Souls drawn from a paragon shared `soul-deck`): return to `soul-deck`, restoring the original shared zone.
     - **All other cards**: route to `card.ownerId`'s `deck` zone.
   - Cards with attachments (souls on demons, equipment on heroes): existing move-card logic should cascade. To be verified during implementation; if not, attachments are explicitly relocated by the reducer.
5. **Shuffle** each player's `deck` (use the same deterministic-RNG path as the existing `shuffleDeck` reducer).
6. **Draw 8** for each player: move top 8 from `deck` to `hand`, capped at deck size.
7. **Mark request completed** and delete it (matches existing pattern for resolved requests).
8. **Chat event**: insert a single summary event "Three Nails (GoC) reset executed — both players drew 8".

### Side effects & edge cases

- **Counters / outline state**: cleared when cards re-enter the deck (existing behavior on deck moves).
- **Cards "in battle"**: in this app's model, battle is a transient overlay, not a separate zone — battle cards live in `territory`. They get swept like everything else. Correct per card text.
- **Other pending zone-search requests**: become stale after the reset. Acceptable; the reset is a major state change. Existing requests are not explicitly cancelled by this reducer (they will time out or be denied normally).
- **Three Nails (GoC) not in territory when approved**: handled by step 2 — no-op with chat note.
- **Either player can activate** if they hold Three Nails (GoC) in territory — matches card text. The active-player gate does not apply.
- **Cannot be negated** is enforced by the design itself (no negation hook is wired into this reducer).

### Out of scope
- Auto-validating "opponent has board advantage" — explicitly delegated to the opponent's approval choice.
- Animated transition for the reset (instant subscription update).
- Sweeping `reserve` / `discard` / `banish` / `land-of-redemption` (per Tim's scope decision).

## Implementation order

1. **Feature 1** — `DeckPeekModal` toggle. Smallest, no backend, easy to test in goldfish.
2. **Feature 3** — `GameToolbar` button layout. Small, no backend.
3. **Feature 2** — Three Nails (GoC) reset. Full stack: registry parity update, new ability variant, new server reducer, new client toast branch. Requires `make spacetimedb` deploy + bindings regen via the `spacetimedb-deploy` skill.

## Testing notes

- Feature 1: in goldfish, peek 7, take 1, verify modal stays open with toggle ON; verify auto-closes with toggle OFF (current behavior).
- Feature 3: in multiplayer, verify the active player sees both buttons, can click Priority, and the opponent receives the existing approval toast.
- Feature 2: in multiplayer with both players seated, place Three Nails (GoC) into one player's territory (via deck-search or hand drop), right-click → Activate Reset. Verify opponent toast text, approve flow, deny flow, and the no-op path when Nails has been moved out of territory before approval.
