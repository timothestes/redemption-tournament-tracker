# Delivered — "Discard top card of opponent's deck" ability

**Date:** 2026-04-26
**Card:** `Delivered` (PoC)
**Source ability text:** "STAR: Discard the top card of each opponent's deck."

## Goal

Add a right-click ability on `Delivered` that discards the top card of the
opponent's deck. The opponent must approve before the discard happens.

## Approach

Reuse the existing opponent-consent infrastructure. Add one reusable
`CardAbility` variant (`discard_opponent_deck`), register `Delivered`
against it, and add a client-side router that translates the variant
into the existing `discard_deck_top` action string. No new server
reducer, no new approval UI, no schema changes.

The variant is reusable rather than one-off: shape mirrors
`look_at_opponent_deck` (`position` + `count`) so future cards with
similar effects can register without further plumbing.

## Existing infrastructure (reused as-is)

- `request_opponent_action` reducer creates a pending
  `ZoneSearchRequest` row tagged with action + JSON params.
- The opponent's client renders a consent dialog using
  `describeOpponentAction()` (`MultiplayerCanvas.tsx:167`). The
  `discard_deck_top` action string is already mapped to "discard the
  top N card(s) of your deck" (line 188).
- On approval, the requester's client dispatches based on the action
  string. `discard_deck_top` is already handled at line 1886, calling
  `moveOpponentDeckCardsToZone('top', count, 'discard')`.
- On denial, the requester sees a toast generated from
  `describeRequesterAction()` (line 226 already covers
  `discard_deck_top`).
- Empty-deck handling is already safe: `moveOpponentDeckCardsToZone`
  no-ops when there are no cards to move; the request completes.

## Changes

### 1. Ability variant (both copies)

Add to the `CardAbility` union in
`lib/cards/cardAbilities.ts` and `spacetimedb/src/cardAbilities.ts`:

```ts
| { type: 'discard_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
```

The parity test in `lib/cards/__tests__/cardAbilities.test.ts` enforces
the two copies stay aligned.

### 2. Menu label (`abilityLabel()`)

Add a `case 'discard_opponent_deck'` mirroring the
`look_at_opponent_deck` formatting:

```ts
case 'discard_opponent_deck': {
  const where = a.position === 'random' ? `${a.count} random` : `${a.position} ${a.count}`;
  return `Discard ${where} card${a.count === 1 ? '' : 's'} of opponent's deck`;
}
```

For Delivered (`position: 'top'`, `count: 1`) this renders as:
**"Discard top 1 card of opponent's deck"**.

### 3. Registry entry (both copies)

```ts
'Delivered': [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
```

The exact `cardName` value comes from
`lib/cards/generated/cardData.ts:17932` — bare `"Delivered"` with no
set suffix.

### 4. Client menu router

In `app/play/components/MultiplayerCanvas.tsx`, alongside the existing
`look_at_opponent_deck` branch (~line 1061):

```ts
if (ability?.type === 'discard_opponent_deck') {
  const action =
    ability.position === 'top' ? 'discard_deck_top'
    : ability.position === 'bottom' ? 'discard_deck_bottom'
    : 'discard_deck_random';
  requestOpponentAction(action, JSON.stringify({ count: ability.count }));
  return;
}
```

### 5. Server dispatch (`execute_card_ability`)

Match the `look_at_opponent_deck` precedent — this variant is dispatched
client-side, never reaches the reducer. In `spacetimedb/src/index.ts`'s
`execute_card_ability` switch (~line 2810):

```ts
case 'discard_opponent_deck':
  throw new SenderError('discard_opponent_deck is dispatched by the client, not this reducer');
```

The TypeScript exhaustiveness check on `_exhaustive: never = ability`
forces this addition.

### 6. Goldfish dispatch

Single-player goldfish has no opponent. Match the `look_at_opponent_deck`
no-op in `app/goldfish/state/gameReducer.ts:920` — extend the existing
case fallthrough:

```ts
case 'reveal_own_deck':
case 'look_at_own_deck':
case 'look_at_opponent_deck':
case 'discard_opponent_deck':
  // Modal-driven or opponent-required — GoldfishCanvas intercepts or
  // the effect is multiplayer-only. No-op here.
  return state;
```

### 7. Tests

- Parity test (`lib/cards/__tests__/cardAbilities.test.ts`) auto-covers
  the registry diff and union diff between the two files.
- Goldfish reducer test: dispatching the `discard_opponent_deck`
  ability returns the same state reference (no-op).
- Add an `abilityLabel()` snapshot for the new variant covering top /
  bottom / random / count > 1 plural forms.

### 8. Deploy

Run the `spacetimedb-deploy` skill to publish + regenerate bindings
(both registries changed). Schema is unchanged so the publish is
in-place. Hard-refresh the browser after deploy.

## Manual QA

In a two-browser multiplayer session:

1. Both players load decks containing Delivered.
2. Player A plays Delivered into territory.
3. Player A right-clicks → "Discard top 1 card of opponent's deck".
4. Player B sees consent dialog: "Player A wants to discard the top 1
   card of your deck."
5. Player B approves → top card of B's deck moves to B's discard,
   request row deletes, action log entry written.
6. Repeat with B denying → A sees denial toast, no card moves.
7. Repeat with B's deck empty at request time → ability completes
   with no card movement (no error).

In single-player goldfish:

8. Load a deck with Delivered, play it, right-click. Menu item
   shows. Clicking is a silent no-op (consistent with
   `look_at_opponent_deck`).

## Out of scope

- The full `Delivered` ability text includes a separate GE/EE activation
  ("Activate an Artifact from deck or Reserve if you control an
  Egyptian"). That's not part of this change.
- "Each opponent" — the v1 multiplayer module is 2-player, so "each
  opponent" simplifies to "the opponent". No multi-target handling.
