# Resurrect Heroes — interactive card ability

**Date:** 2026-06-08
**Cards:** `Emptying the Tombs (GoC)`, `Redemption [2025 - National]`
**Scope:** Multiplayer (`/play`) + goldfish solo mode. Resurrect clause only — other
card clauses (Gospel Fortress fetch, draw X, paralyze, bounce, convert, banish) are
handled manually by players with existing controls.

## Summary

Add a right-click ability to both cards that opens an interactive modal showing each
player's discard pile (one page/tab per player, the source card's owner first), lets
the user multi-select Heroes across pages, and on confirm moves each selected Hero
from its owner's discard pile into **that same owner's** territory (battlefield).
A resurrected Hero's `ownerId` never changes.

This extends the existing interactive-ability precedent (`imitate_lost_soul` →
`beginTargeting`, `draw_bottom_of_deck_choose` → `beginCountPrompt`).

## Hero filter

A discard card is a valid target if its `type` field, lowercased, **contains** `"hero"`
(`card.type.toLowerCase().includes('hero')`). "Contains" rather than exact match so
dual-alignment / compound-type Heroes qualify. Re-validated server-side — never trust
the client's selection.

## Components & changes

### 1. Ability type / registry
New `CardAbility` variant in **both** registry copies
(`lib/cards/cardAbilities.ts`, `spacetimedb/src/cardAbilities.ts`):

```ts
| { type: 'resurrect_heroes'; label?: string }
```

- `abilityLabel()` → `"Resurrect Heroes"`.
- Register both cards: `[{ type: 'resurrect_heroes' }]`.
- Source-zone gating unchanged (territory / land-of-bondage / land-of-redemption).
- Parity tests stay green; extend to assert both registrations resolve via `findCard()`.

### 2. Client interactive flow
- New `ResurrectPromptRequest` in `app/shared/types/gameActions.ts`:
  ```ts
  interface ResurrectPromptRequest {
    cardName: string;
    pages: { ownerId: string; playerName: string; heroes: GameCard[] }[]; // source owner first
    onConfirm: (selectedInstanceIds: string[]) => void;
    onCancel: () => void;
  }
  ```
- New `GameActions` entries: `beginResurrectPrompt?(req)` and
  `resurrectHeroes?(sourceInstanceId, abilityIndex, ids)`.
- `CardContextMenu.tsx`: new branch routing `resurrect_heroes` →
  `beginResurrectPrompt` with pages built by a shared `buildDiscardHeroPages(sourceOwnerId)`
  helper (group all `discard` cards by `ownerId`, filter by the Hero rule, source owner first).

### 3. `ResurrectHeroesModal`
`app/shared/components/ResurrectHeroesModal.tsx`, built on the same `Dialog` primitive as
`CountPromptDialog`:
- Player tabs (source owner first, pre-selected); each tab shows player name + selected-count badge.
- Active page renders Hero card thumbnails; click toggles selection. Selection is one
  `Set<instanceId>` spanning all pages (switching tabs preserves picks).
- Empty page → "No Heroes in this discard pile."
- Footer: **Cancel** / **Resurrect (N)** where N = total selected. Confirm calls
  `onConfirm([...ids])` then closes.
- No selection cap ("any number").
- Heroes auto-stagger into the owner's territory on commit (no drop-targeting); player can reposition after.

Mounted in both canvases (each owns its prompt `useState`, matching the existing pattern):
- `MultiplayerCanvas.tsx`: `resurrectPrompt` state + `beginResurrectPrompt` impl + render modal near `CountPromptDialog`.
- GoldfishCanvas: same wiring (degenerates to one page).

### 4. Server reducer (multiplayer)
`resurrect_heroes(gameId: u64, cardInstanceId: u64, abilityIndex: u64, selectedIdsJson: string)`
in `spacetimedb/src/index.ts` (array passed as JSON string, per `move_cards_batch`):
1. Validate sender owns source, source in allowed zone, ability index resolves to `resurrect_heroes`.
2. `JSON.parse` ids. For each: find CardInstance, require `zone === 'discard'` and Hero rule;
   `update({ ...card, zone: 'territory', posX, posY })` with normalized stagger (`0.05 / 0.03`).
   `ownerId` unchanged.
3. `logAction(... 'RESURRECT_HEROES', JSON.stringify({ count, byOwner }), ...)`.

Client wrapper `resurrectHeroes(...)` in `useGameState.ts` JSON-stringifies ids and calls the reducer.

### 5. Goldfish reducer
`RESURRECT_HEROES` action in `app/goldfish/state/gameReducer.ts`: validate → for each selected
id that is a Hero in `discard`, move to `territory` with pixel stagger (`55 / 15`, base `200,200`)
via `cloneZones` + zone reassignment. Return original `state` reference on any precondition
failure (atomicity). `ownerId` unchanged.

### 6. Log rendering
`RESURRECT_HEROES` case in `ChatPanel.tsx` `formatActionType()`, mirroring `SPAWN_TOKEN`:
parse payload → `"{Player} resurrected N Hero(es)"`.

## Testing
- Parity test: new variant registered for both cards; resolves via `findCard()`.
- Goldfish reducer tests (`gameReducer.customAbilities.test.ts`): happy path (heroes move
  discard→territory, owner preserved), non-hero id rejected, empty selection no-op returns same state ref.
- Manual QA: goldfish single page; multiplayer 2-browser — per-player pages, cross-page
  selection, heroes land in correct owner's territory, sync to both clients.

## Deploy
`spacetimedb-deploy` (in-place, no schema change → no data loss), then hard-refresh.
