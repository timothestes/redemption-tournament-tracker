# Card Sound Effects — Design

**Date:** 2026-05-30
**Status:** Approved for implementation

## Summary

A joke/easter-egg feature: play a sound bite the first time a specific card enters
the territory in a game. The first card is **Roaring Lion [2025 - Seasonal]**, which
plays `public/gameplay/rawr.wav`.

Built as a small **card → sound registry** so adding a future sound bite for any
card is a one-line config change — no new code paths.

Works in both game modes:

- **Goldfish** (single-player practice) — plays for the local player.
- **Multiplayer** (SpacetimeDB-backed) — fires on each client independently, so
  **both players hear it**, regardless of who placed the card.

## Behavior

- The **first time** a card in the registry is present in the **territory** during a
  game, its sound plays **once**.
- "Once per game, per sound": if the card leaves and re-enters, or a second copy is
  played, the sound does **not** replay that game.
- Tracking resets automatically when a new game starts (keyed on the game's unique id).
- Card matching is **exact** on `cardName` (e.g. `"Roaring Lion [2025 - Seasonal]"`).

## Architecture

Purely client-side, reacting to existing game state. **No SpacetimeDB schema change,
no reducer, no migration.**

### 1. Registry — `app/shared/config/cardSounds.ts` (new)

```ts
export type CardSound = {
  /** Unique key used for once-per-game tracking. */
  id: string;
  /** Exact cardName to match (compared with ===). */
  cardName: string;
  /** Path under /public, e.g. "/gameplay/rawr.wav". */
  src: string;
  /** Playback volume 0..1. Defaults to 0.5. */
  volume?: number;
};

export const CARD_SOUNDS: CardSound[] = [
  {
    id: "roaring-lion",
    cardName: "Roaring Lion [2025 - Seasonal]",
    src: "/gameplay/rawr.wav",
  },
];
```

Adding a future sound = append one entry. Nothing else changes.

### 2. Hook — `app/shared/hooks/useCardSounds.ts` (new)

```ts
useCardSounds(
  territoryCards: ReadonlyArray<{ cardName: string }>,
  gameKey: string,
): void
```

Behavior:

- Holds a ref: the `gameKey` it is currently tracking, plus a `Set<string>` of sound
  `id`s already fired for that game.
- When `gameKey` changes, reset the fired set (new game).
- On every change to `territoryCards` (or `gameKey`): for each `CARD_SOUNDS` entry
  whose `id` is **not** already in the fired set, check whether any territory card has
  `cardName === entry.cardName`. If so, play the sound and add `id` to the fired set.
- Playback uses the existing pattern from
  [`components/ui/CountdownTimer.tsx:35-43`](../../../components/ui/CountdownTimer.tsx):
  ```ts
  const audio = new Audio(entry.src);
  audio.volume = entry.volume ?? 0.5;
  audio.play().catch((e) => console.warn("Could not play card sound:", e));
  ```

The `gameKey`-based ref is what guarantees "once per game" and the reset-on-new-game
behavior. Both game keys are guaranteed unique and stable per game.

### 3. Call sites (one line each)

**Goldfish** — `app/goldfish/components/GoldfishCanvas.tsx`
(state comes from `useGame()`; territory is `state.zones['territory']`, game id is
`state.sessionId`):

```ts
useCardSounds(state.zones['territory'] ?? [], state.sessionId);
```

**Multiplayer** — `app/play/components/MultiplayerCanvas.tsx`
(`gameId: bigint` is a prop; `myCards` / `opponentCards` are destructured from
`useGameState(gameId)`, each a `Record<zone, CardInstanceRow[]>`). Combine both
players' territory cards so it fires for either player:

```ts
const territorySoundCards = useMemo(
  () => [...(myCards['territory'] ?? []), ...(opponentCards['territory'] ?? [])],
  [myCards, opponentCards],
);
useCardSounds(territorySoundCards, String(gameId));
```

Both `GameCard` (goldfish) and `CardInstanceRow` (multiplayer) expose `cardName: string`,
so the hook's input type `{ cardName: string }` covers both with no adapter.

## Out of scope (YAGNI)

- The trigger zone is fixed to **territory**. If a future sound needs a different zone,
  add an optional `zone` field to `CardSound` then.
- No server-side coordination / dedupe across clients. Each client plays locally; for a
  sound effect this is the desired behavior and avoids a schema change.
- No per-card-instance tracking — the rule is once per game per sound `id`.

## Verification

- **Goldfish:** start a game, move a Roaring Lion [2025 - Seasonal] into territory →
  rawr plays once. Move it out and back → no replay. Start a new game → plays again.
- **Multiplayer:** with two clients, either player moves Roaring Lion into territory →
  both clients play the rawr once. No replay on re-entry within the same game.
- **Generality:** temporarily add a second `CARD_SOUNDS` entry for another card and
  confirm it triggers independently (then remove).
