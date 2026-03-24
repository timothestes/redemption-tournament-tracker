# Practice While You Wait — Goldfish in Multiplayer Waiting Room

**Date:** 2026-03-23
**Status:** Draft
**Scope:** Mount goldfish practice mode in the multiplayer waiting room while waiting for an opponent

---

## Problem Statement

After creating a multiplayer game, players stare at a static "Waiting for opponent..." screen with nothing to do. They could be practicing their deck. The goldfish components are already built — this feature wires them into the waiting room.

---

## Design

### Overview

When `lifecycle === 'waiting'` in the game room (`/play/{code}`), add a "Practice with your deck" button. Clicking it mounts a fullscreen goldfish session using the same deck the player selected in the lobby. A floating banner shows the game code and waiting status. When an opponent joins via SpacetimeDB, goldfish unmounts and the multiplayer game takes over.

### Prerequisite: Extend GameParams in SessionStorage

The current `GameParams` stored in sessionStorage is missing fields the conversion function needs. `GameLobby.tsx` must be updated to also store `deckName` and `paragon` in both the create and join paths:

```typescript
// Both handleCreateGame and handleJoinGame:
sessionStorage.setItem(`stdb_game_params_${code}`, JSON.stringify({
  ...existingFields,
  deckName: selectedDeck.name,       // NEW
  paragon: selectedDeck.paragon,     // NEW
  format: selectedDeck.format || 'Type 1',  // Already stored for create, ADD for join
}));
```

The `GameParams` interface in `[code]/client.tsx` must also be extended with these fields.

### Data Flow

```
sessionStorage (stdb_game_params_{code})
  └─ deckData: JSON string of GameCardData[]
  └─ deckName, deckId, format, paragon
       └─ convertToGoldfishDeck(gameCards, deckId, deckName, format, paragon?)
            └─ DeckDataForGoldfish
                 └─ CardPreviewProvider
                      └─ GameProvider deck={...}
                           └─ dynamic(() => GoldfishCanvas) width={w} height={h}
```

**Card enrichment caveat:** The `GameCardData[]` stored in sessionStorage has empty `cardType` fields (the multiplayer lobby doesn't enrich from the GitHub CSV). This means `buildInitialGameState()` in goldfish won't auto-route Lost Souls to Land of Bondage during opening hand — they'll just go to hand like all other cards. This is acceptable for a practice session. Full enrichment can be added later if desired.

### Waiting Room State Machine

The `lifecycle === 'waiting'` branch in `[code]/client.tsx` gets a sub-state:

```
waiting (default)
  ├─ isPracticing = false → Static placeholder + "Practice with your deck" button
  └─ isPracticing = true  → Fullscreen goldfish + floating banner
```

When `lifecycle` transitions to `'playing'` (SpacetimeDB subscription update), React re-renders the component tree. The goldfish components unmount automatically — no explicit cleanup needed since GameProvider uses `useReducer` with no side effects.

### Floating Banner (during practice)

```
┌─────────────────────────────────────────────────────────┐
│  Game ABCD  ·  Waiting for opponent · · ·      [Exit]   │
└─────────────────────────────────────────────────────────┘
```

- `fixed top-0 inset-x-0 z-50`
- Semi-transparent background (`bg-background/90 backdrop-blur-sm`)
- Game code in mono font, "Waiting for opponent" with animated dots
- "Exit" button returns to the static waiting screen (`setIsPracticing(false)`)
- Height: compact (~48px) to maximize goldfish canvas space

### WaitingRoomGoldfish Component

Wraps the goldfish provider stack and handles viewport sizing.

```typescript
interface WaitingRoomGoldfishProps {
  deck: DeckDataForGoldfish;
}
```

**Viewport calculation:**
- Uses `useState` + `useEffect` with `window.innerWidth` / `window.innerHeight`
- Subtracts banner height (~48px) from available height
- Passes computed `width` and `height` to GoldfishCanvas
- Listens for `resize` events

**SSR safety:** GoldfishCanvas uses Konva (requires browser APIs). Must use `next/dynamic` with `ssr: false`, same pattern as `MultiplayerCanvas` in the existing `client.tsx`.

**Provider stack:**
```tsx
const DynamicGoldfishCanvas = dynamic(
  () => import('@/app/goldfish/components/GoldfishCanvas'),
  { ssr: false }
);

<CardPreviewProvider>
  <GameProvider deck={deck}>
    <DynamicGoldfishCanvas width={width} height={height - BANNER_HEIGHT} />
  </GameProvider>
</CardPreviewProvider>
```

**Intentionally excluded from goldfish wrapper:**
- **Image preloader / LoadingScreen** — The existing goldfish client preloads all card images before mounting the canvas. For practice-while-you-wait, we skip this — images will load progressively as the player interacts. This avoids a loading screen within the waiting room.
- **CardLoupePanel** — The zoomed card preview sidebar. Excluded to keep the waiting room simple and maximize canvas space. CardPreviewProvider still mounts (needed by canvas internals) but the loupe UI is not rendered.
- **Cave background / vignette overlays** — The themed background from goldfish mode. The waiting room goldfish renders over the standard `bg-background` instead. Keeps it visually distinct from standalone goldfish.

### Conversion Function

Maps `GameCardData[]` (multiplayer format) to `DeckDataForGoldfish` (goldfish format).

```typescript
function convertToGoldfishDeck(
  cards: GameCardData[],
  deckId: string,
  deckName: string,
  format: string,
  paragon?: string | null
): DeckDataForGoldfish
```

**Top-level fields:**
| Source | DeckDataForGoldfish field |
|---|---|
| `deckId` param | `id` |
| `deckName` param | `name` |
| `format` param | `format` |
| `paragon` param | `paragon` |
| hardcoded `true` | `isOwner` (practice mode, always true) |

**Card field mapping:**
| GameCardData (camelCase) | DeckDataForGoldfish.cards (snake_case) |
|---|---|
| `cardName` | `card_name` |
| `cardSet` | `card_set` |
| `cardImgFile` | `card_img_file` |
| `cardType` | `card_type` |
| `brigade` | `card_brigade` |
| `strength` | `card_strength` |
| `toughness` | `card_toughness` |
| `specialAbility` | `card_special_ability` |
| `identifier` | `card_identifier` |
| `alignment` | `card_alignment` |
| `isReserve` | `is_reserve` |

**Quantity handling:** `GameCardData[]` has already been expanded by quantity (each card is a separate entry). Goldfish expects `quantity: number` per card. The conversion function must **re-aggregate** identical cards back into single entries with quantity counts. Cards are identical if they share the same `cardName` + `cardSet` + `cardImgFile` + `isReserve` tuple (includes `cardImgFile` to avoid merging alternate art printings).

**Error handling:** If `cards` is empty or `deckData` JSON fails to parse, return a deck with an empty `cards` array. The "Practice" button should only be shown when `gameParams?.deckData` is truthy and parses to a non-empty array.

---

## Files Affected

| File | Change |
|---|---|
| `app/play/components/WaitingRoomGoldfish.tsx` | **New** — ~80 lines. Provider stack wrapper + viewport sizing + dynamic import |
| `app/play/utils/convertToGoldfishDeck.ts` | **New** — ~50 lines. GameCardData[] → DeckDataForGoldfish adapter with re-aggregation |
| `app/play/[code]/client.tsx` | Add `isPracticing` state, "Practice" button in waiting UI, conditional render of WaitingRoomGoldfish + floating banner. Extend `GameParams` interface with `deckName`, `paragon` |
| `app/play/components/GameLobby.tsx` | Add `deckName` and `paragon` to sessionStorage writes in both `handleCreateGame` and `handleJoinGame`. Add `format` to the join path |

## Components Used As-Is (No Changes)

- `app/goldfish/components/GoldfishCanvas.tsx` — accepts width/height props
- `app/goldfish/state/GameContext.tsx` — GameProvider, accepts deck prop
- `app/goldfish/state/CardPreviewContext.tsx` — CardPreviewProvider, no props needed
- `app/goldfish/state/gameInitializer.ts` — buildInitialGameState, called by GameProvider

---

## Out of Scope

- Card enrichment from GitHub CSV (Lost Soul auto-routing in practice)
- Persisting goldfish state across page reloads
- "Opponent joined!" flash notification before transition
- Goldfish action bar customization for waiting room context
- Mobile-specific layout adjustments beyond standard GoldfishCanvas responsive behavior
