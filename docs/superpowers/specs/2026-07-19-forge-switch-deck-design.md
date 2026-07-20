# Forge switch-deck (gear menu + pregame) — design

**Date:** 2026-07-19
**Status:** approved

## Problem

Forge playtest games have no way to switch decks once you're in a game. The gear
menu's "Load Deck" entry is withheld (`onLoadDeck={isForge ? undefined : ...}`
in `app/play/[code]/client.tsx`), the pregame "Change deck" button is hidden for
forge, and the SpacetimeDB reducers hard-reject forge games
(`reload_deck` / `pregame_change_deck`: "disabled in playtest games").

These were scoping guards from the original forge-multiplayer build, not a
leak-spine necessity: forge games already accept client-supplied `deckData` at
create/join, sourced from the sanitized `loadForgeDeckForGame` server action
(forge cards leave as `forge:<uuid>` stubs, paragon sanitized).

Additionally, the plain waiting room (host alone, opponent not yet joined) has
no deck-change control even in normal games — only the practice-mode gear menu
offers one, even though the `pregame_change_deck` reducer already accepts swaps
in `waiting` status.

## Scope (user-approved)

1. **Mid-game gear menu** in forge games → forge switch-deck dialog → confirm →
   `reload_deck`.
2. **Practice-mode gear menu** (waiting room goldfish) in forge games → forge
   switch-deck dialog → confirm → `pregame_change_deck`.
3. **Pregame deck-select "Change deck" button** shown for forge too, opening the
   forge picker.
4. **Plain waiting room**: add a "Change deck" control for BOTH normal and forge
   games (normal → `DeckPickerModal`, forge → forge picker).

## Server changes (`spacetimedb/src/index.ts`)

- `reload_deck`: remove the `isForgeGame` guard. Everything else is shared with
  the normal path (`insertCardsShuffleDraw`, Player.deckId/paragon update).
- `pregame_change_deck`: remove the `isForgeGame` guard AND add a
  `paragon: t.string()` param written to the Player row. This also fixes a
  pre-existing gap where a pregame swap left `Player.paragon` stale in normal
  games (only `reload_deck` updated it).
- Republish module + regen TypeScript bindings (spacetimedb-deploy skill).

## Client changes

### New `ForgeDeckPickerModal`

In `app/forge/play/games/ForgeDeckPicker.tsx`, export a standalone modal
(`open` / `onOpenChange` / `onSelect(deckId)`) reusing the existing
`PickerBody` (search + "Your decks" / "Shared by others"). The modal fetches
`listForgeDecks()` + `listSharedForgeDecks()` (both `"use server"` actions) on
first open — no prop threading into the game client.

### `app/play/[code]/client.tsx`

- Mid-game gear (4 `MultiplayerCanvas` call sites): forge passes an
  `onLoadDeck` that opens the forge picker. On select:
  `loadForgeDeckForGame(id)` → on `ok:false` show the error → on success feed
  the existing amber "Clear all cards and load a new deck?" confirm →
  `gameState.reloadDeck(id, JSON.stringify(deckData), deck.paragon)`.
- Practice-mode gear (`WaitingRoomGoldfish`): forge branch feeds the existing
  `practiceDeckConfirm` flow (updates sessionStorage/gameParams so refresh
  keeps the swap), calling `pregameChangeDeck(id, deckData, paragon)`.
- `useGameState.pregameChangeDeck` gains the `paragon` arg; normal-game callers
  pass `deck.paragon || ''`.

### `app/play/components/PregameScreen.tsx`

- Deck-select phase: show "Change deck" for forge too; forge opens
  `ForgeDeckPickerModal`, normal keeps `DeckPickerModal`. Forge select path
  goes through `loadForgeDeckForGame`.
- Waiting state (`isWaiting`): render the same small "Change deck" text button
  in the player card for both normal and forge.

### No resolver refresh needed

`getForgePlayResolver` returns ALL cards granted to the member (not per-deck),
so the already-fetched in-game `forgeResolver` covers any deck they can load.

## Known limitation (pre-existing, kept for parity)

Swapping to a deck of a different format while waiting does not update the Game
row's `format`, so the lobby listing still shows the original format. Normal
games behave this way today; unchanged here.

## Verification

- `tsc --noEmit` type gate.
- Manual/e2e: forge game → gear → switch deck mid-game re-deals the new deck;
  waiting-room swap persists across refresh; normal-game waiting room gains the
  "Change deck" button; pregame swap to a paragon deck updates the
  ParagonDrawer (paragon fix).
