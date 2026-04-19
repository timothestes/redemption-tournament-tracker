# Paragon Soul Deck — Design

**Date:** 2026-04-18
**Status:** Draft
**Scope:** Goldfish + Multiplayer, Paragon format only

## Problem

Paragon format uses a 21-card Soul Deck that does not belong to any player. At game start, 3 souls are revealed into a shared Land of Bondage. Souls refill from the Soul Deck whenever fewer than 3 are in play (both on each player's turn start and immediately upon rescue). Today the tracker has no concept of a shared deck, a shared Land of Bondage, or format-owned cards — both goldfish and multiplayer assume every card belongs to a player.

## Rules being implemented

From the official Paragon format rules (paraphrased):

1. The Soul Deck is 21 distinct Lost Souls designed for the format.
2. The Soul Deck is a deck, but doesn't belong to any player. Effects that "play a Lost Soul from a deck" can target it; effects that target "an opponent's deck" cannot.
3. At the start of each player's turn, if fewer than 3 Soul-Deck Lost Souls are in play, reveal from the top of the Soul Deck until 3 are in play.
4. If a Soul-Deck Lost Soul is rescued, immediately replace it with the top of the Soul Deck, unless 3 or more Soul-Deck souls are still in play.
5. All Lost Souls in play — including captured characters and LS tokens — are considered to be in every player's Land of Bondage.
6. **Captured characters and token Lost Souls do not count toward the rule of 3.** Only Soul-Deck-origin souls count.

## Approach

**Shared-owner sentinel** (Approach 1 of the brainstorm). One code path for shared state, minimal structural changes.

- Widen ownership enum/sentinel to include `'shared'` (goldfish) / `0n` (SpacetimeDB).
- Add a `'soul-deck'` zone; reuse the existing `'land-of-bondage'` zone id, but in Paragon mode it is shared (both players see/drag into it).
- Tag each Soul-Deck-origin card with `isSoulDeckOrigin: true` so refill logic can count correctly in a zone that may also contain captured humans and LS tokens.
- Gate every piece of new logic on `format === 'Paragon'`.

## Card entities

New file `app/shared/paragon/soulDeck.ts`:

```ts
export interface ParagonSoulDef {
  identifier: string;   // 'paragon-soul-01' .. 'paragon-soul-21'
  cardName: string;     // 'Lost Soul 01' .. 'Lost Soul 21' (display)
  cardImgFile: string;  // '/paragon-souls/Lost Soul 01.png' etc.
  cardSet: 'ParagonSoul';
  type: 'Lost Soul';
  alignment: 'Evil';
  brigade: '';
  strength: '';
  toughness: '';
  specialAbility: '';
  reference: '';
}
export const PARAGON_SOULS: readonly ParagonSoulDef[]; // length 21
export const SOUL_DECK_BACK_IMG = '/paragon-souls/Lost Soul Back.png';
```

- Images sourced from existing `public/paragon-souls/*.png` files.
- **NOT** added to `lib/cards/lookup.ts` or the global card-search index (per Q2 decision).
- These 21 defs are used only at game init and as the fallback image source when rendering soul cards.
- The existing card-image resolver must route paths starting with `/paragon-souls/` to the static public path (verify during implementation; likely already works).

## Data model changes

### Zone id

`app/shared/types/gameCard.ts`:

```ts
export type ZoneId =
  | 'deck'
  | 'hand'
  | 'reserve'
  | 'discard'
  | 'paragon'
  | 'land-of-bondage'   // shared in Paragon mode
  | 'soul-deck'         // NEW — shared, only exists in Paragon mode
  | 'territory'
  | 'land-of-redemption'
  | 'banish';

export const ALL_ZONES: ZoneId[] = [
  'deck', 'hand', 'reserve', 'discard', 'paragon',
  'land-of-bondage', 'soul-deck', 'territory',
  'land-of-redemption', 'banish',
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  // ...existing...
  'soul-deck': 'Soul Deck',
};
```

### Goldfish `GameCard`

```ts
export interface GameCard {
  // ...existing fields...
  ownerId: 'player1' | 'player2' | 'shared';  // widened
  isSoulDeckOrigin: boolean;                  // NEW — default false
}
```

### SpacetimeDB `CardInstance`

```ts
// schema.ts — add one field
isSoulDeckOrigin: t.bool().default(false),
```

- `ownerId: t.u64()` unchanged structurally; value `0n` used as the shared sentinel (safe because `Player.id` is auto-inc starting at `1n`).
- Requires `spacetime publish` + `spacetime generate` (invoke the `spacetimedb-deploy` skill).

### Server auth treatment for shared cards

Every reducer that currently authorizes on "does `ctx.sender` own this card" must gain a `owner === 0n` branch that allows either seat to act on the card, provided the card is currently in a shared zone (`land-of-bondage` or `soul-deck`) AND the game format is Paragon. This prevents a seat from interacting with format-owned cards outside the legal zones.

On rescue (move from `land-of-bondage` → a player's `land-of-redemption`): rewrite the card's `ownerId` to the rescuing player's id (seat). The `isSoulDeckOrigin` marker stays set, but ownership transfers — these cards are now in the rescuer's LoR and should behave like their own rescued souls for discard-pile / banish / search-zone behaviors.

## Initialization (gameInitializer.ts + server setup reducer)

Paragon-mode game setup adds two steps (runs BEFORE opening-hand draw so players see the starting LoB when they look at their hand):

1. **Build the Soul Deck.** Create 21 `GameCard` instances from `PARAGON_SOULS`, each with `ownerId: 'shared'`, `isSoulDeckOrigin: true`, `zone: 'soul-deck'`, `isFlipped: true` (face-down in the deck). Shuffle using the same PRNG as the player deck.
2. **Reveal 3 to the shared Land of Bondage.** Take the top 3 cards of the Soul Deck, set `zone: 'land-of-bondage'`, `isFlipped: false`, and place them.

Then proceed with normal opening-hand draw. Player Lost Souls from their own decks still auto-route into the shared LoB but retain `ownerId: 'player1'|'player2'` and `isSoulDeckOrigin: false`, so they do not count toward the rule of 3.

**Multiplayer:** a server reducer (`initialize_soul_deck`) runs at `startGame` time when `format === 'Paragon'`, using the deterministic seeded PRNG. Cards written as `CardInstance` rows with `ownerId = 0n`.

## Refill logic

Single helper function — same semantics on client (goldfish) and server (multiplayer):

```
refillSoulDeck(gameState):
  count = number of cards in 'land-of-bondage'
          where isSoulDeckOrigin === true
  needed = 3 - count
  while needed > 0 and soul-deck has cards:
    move top of soul-deck → land-of-bondage, face-up
    needed -= 1
```

**Triggers:**

1. **Turn start.** Server-authoritative. When the phase transitions into the turn-start phase (`'draw'`) for either seat, the phase-advance reducer calls `refillSoulDeck`. Goldfish does the same in its turn-start reducer case. Fires for both seats each round.
2. **On rescue.** When any card move reducer results in a Soul-Deck-origin card leaving `land-of-bondage` to a `land-of-redemption` zone, the reducer immediately calls `refillSoulDeck` after the move commits.

**Idempotent:** if 3+ soul-origin souls are already in the LoB, the function is a no-op. Captured humans and LS tokens in the shared LoB are ignored by the count because they have `isSoulDeckOrigin !== true`.

**PRNG:** server uses existing `rngCounter` pattern (same as deck shuffle / dice). Goldfish uses `Math.random()` like today's goldfish deck shuffle — acceptable because goldfish is single-player.

## Context menu

`DeckContextMenu` already supports `hideDrawActions`. Extend with two more props:

```ts
hideDrawActions?: boolean;     // existing
hideDiscardActions?: boolean;  // NEW
hideReserveActions?: boolean;  // NEW
```

Internal submenus conditionally render Draw / Discard / Reserve rows. For the Soul Deck, all three are hidden, leaving: **Search Soul Deck, Shuffle Soul Deck, Look (top/bottom/random N), Reveal (top/bottom/random N)**. Reveal into the shared LoB moves the card with `zone: 'land-of-bondage'`, `isFlipped: false` — same as the regular reveal-to-LoB affordance.

The shared LoB and the Soul Deck pile both register as right-click targets with the shared `ZoneContextMenu` / `DeckContextMenu` respectively. In Paragon mode, both seats see the same menu targeting the same zone.

## Drag and drop

- **Soul Deck pile → any zone:** only supported drop targets are `land-of-bondage` (reveal) — other targets (hand / discard / reserve) are illegal and the drop is rejected. Dragging just pops the top of the Soul Deck visually, calling the same `reveal_top` reducer under the hood.
- **Shared LoB card → my `land-of-redemption`:** standard rescue. Reducer transfers ownership (`ownerId: sender`), clears the `'shared'` flag, then calls `refillSoulDeck`.
- **Shared LoB card → my `discard`/`banish`/other:** allowed for both players (e.g., banish effects). `refillSoulDeck` still runs after any Soul-Deck-origin leaves the LoB.

## Zone layout (Paragon mode)

`app/goldfish/layout/zoneLayout.ts` and `app/play/layout/multiplayerLayout.ts` both get a format-aware branch.

- **Goldfish (Paragon):** the existing bottom-row "Land of Bondage" slot is shared (single zone, visually the same). A new Soul Deck pile is rendered as an additional tile inside the LoB zone — e.g. on the left edge, ~1 card width, showing `Lost Soul Back.png` plus card count. No other layout change.
- **Multiplayer (Paragon):** the per-seat LoBs are collapsed into one centered zone sitting between the two territories (same vertical band currently used by the seam between players). The Soul Deck pile sits at one end of this zone. Hand, Territory, sidebar zones unchanged. Exact dimensions TBD during implementation — aim for parity with the current LoB height per seat.

Non-Paragon formats use the existing per-seat-LoB layout unchanged.

## Visibility

- The Soul Deck's top card is always shown face-down to both seats (`Lost Soul Back.png` art).
- Revealed souls in the shared LoB are face-up to both seats.
- "Search Soul Deck" temporarily reveals the deck contents to the searcher (same modal UX as regular deck search) — does not reveal to opponent.
- Spectators see the same public state as a player would (no hidden-hand concerns here — nothing about the Soul Deck is seat-private).

## Goldfish vs multiplayer parity

Implementation lives in shared modules where possible:

- `app/shared/paragon/soulDeck.ts` — the 21 card defs, back image constant.
- `app/shared/paragon/refill.ts` — pure `refillSoulDeck(zones): zones` helper, importable by both goldfish reducer and SpacetimeDB reducer.
- Goldfish `gameReducer` and SpacetimeDB reducers each invoke the helper at the two trigger points (turn start + on rescue / Soul-Deck-origin leaves LoB).
- UI components (context menu flag, layout branches, soul-deck pile rendering) are shared via `app/shared/components/`.

## Out of scope

- **Deckbuilder integration.** Souls are not added to the global card database, card-search UI, or any deckbuilder flow. (Q2: A.)
- **Special-ability text for souls.** Soul cards have empty `specialAbility` and `reference`. They render as just art + name. Can be filled in later without schema changes.
- **Token Lost Soul / captured-character differentiation.** These already exist in today's code (`isToken`, regular captured characters routed to LoB). The design leaves their behavior unchanged — they just live in the shared LoB and are ignored by the refill counter.
- **Replay / game history rewind of Soul Deck actions.** Soul Deck actions go through the same `GameAction` log as any other move, so rewind should Just Work, but no special undo affordances are added.

## Open questions / nice-to-haves (not blockers)

1. Should the Soul Deck support "reorder top N" (like the regular deck's reorder modal)? Not in scope for v1 unless needed for a specific card ability.
2. Should rescued souls retain their `isSoulDeckOrigin` marker forever? Design says yes — it's harmless and could be useful for future abilities that care about card origin.
3. Do we want a distinct visual treatment for the shared LoB (different border / background) to reinforce "this is shared, not yours"? Worth trying during implementation; easy follow-up if not done up front.

## Files touched (checklist)

- `app/shared/types/gameCard.ts` — zone id, label, `GameCard` fields
- `app/shared/paragon/soulDeck.ts` — new, soul defs + back image
- `app/shared/paragon/refill.ts` — new, shared refill helper
- `app/goldfish/types.ts` — re-exports (automatic)
- `app/goldfish/state/gameInitializer.ts` — Paragon soul-deck init
- `app/goldfish/state/gameReducer.ts` — turn-start + post-move refill hook, shared-owner auth branches
- `app/goldfish/layout/zoneLayout.ts` — Soul Deck pile tile in LoB when Paragon
- `app/play/layout/multiplayerLayout.ts` — shared centered LoB + Soul Deck pile when Paragon
- `app/shared/components/DeckContextMenu.tsx` — `hideDiscardActions`, `hideReserveActions` flags
- Call sites of `DeckContextMenu` — (existing deck unaffected; new Soul Deck target passes the three hide flags)
- `spacetimedb/src/schema.ts` — add `isSoulDeckOrigin` field, republish
- `spacetimedb/src/index.ts` — `initialize_soul_deck` reducer, refill helper, auth branches, move-card hooks
- `spacetimedb/CLAUDE.md` — no changes; deploy via `spacetimedb-deploy` skill
- Module bindings regenerated
