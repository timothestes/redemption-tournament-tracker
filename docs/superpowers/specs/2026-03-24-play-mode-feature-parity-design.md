# Play Mode Feature Parity with Goldfish Mode

**Date:** 2026-03-24
**Status:** Draft
**Branch:** spacetime-db-thoughts

## Overview

The multiplayer play mode is missing ~25 features that goldfish mode already has. This spec defines the work needed to achieve feature parity, with a strong emphasis on **DRY code** — extracting shared components, hooks, and types so that touching code in one place applies to both modes.

## Design Principles

1. **Shared-first**: Extract to `app/shared/` before building new multiplayer features
2. **Adapter pattern**: Both modes implement a common `GameActions` interface — goldfish via local reducer, multiplayer via SpacetimeDB reducers
3. **Client-side deck inspection**: Since multiplayer subscriptions give the client access to all their own cards (including deck), deck search/peek/browse can be implemented entirely client-side, no new server reducers needed
4. **Progressive enhancement**: Multiplayer gets features goldfish has; multiplayer-only features (consent-based zone search) are additive

---

## Architecture: The Shared GameActions Contract

The key to DRY is a complete `GameActions` interface that both modes implement. Goldfish wraps its reducer dispatch; multiplayer wraps SpacetimeDB reducer calls. All shared UI components program against this interface.

### Expanded GameActions Interface

```typescript
// app/shared/types/gameActions.ts
export interface GameActions {
  // Card operations
  moveCard(cardId: string, toZone: string, posX?: string, posY?: string): void;
  moveCardsBatch(cardIds: string[], toZone: string): void;
  moveCardToTopOfDeck(cardId: string): void;
  moveCardToBottomOfDeck(cardId: string): void;
  flipCard(cardId: string): void;
  meekCard(cardId: string): void;
  unmeekCard(cardId: string): void;
  addCounter(cardId: string, color: string): void;
  removeCounter(cardId: string, color: string): void;
  setNote(cardId: string, text: string): void;

  // Deck operations
  drawCard(): void;
  drawMultiple(count: number): void;
  shuffleDeck(): void;
  shuffleCardIntoDeck(cardId: string): void;
  exchangeCards(cardIds: string[]): void;

  // Token operations
  spawnLostSoul(testament: 'NT' | 'OT', posX?: string, posY?: string): void;
  removeLostSoul(cardId: string): void;

  // Phase/turn operations
  setPhase(phase: string): void;
  advancePhase(): void;
  endTurn(): void;

  // Utility
  rollDice(sides: number): void;

  // Mode-specific (optional)
  undo?(): void;
  searchDeck?(): void;
}
```

### Shared Card Data Interface

Both modes need a common card shape for shared UI components. Currently goldfish uses `GameCard` and multiplayer uses `CardInstanceRow` with an adapter. We formalize this:

```typescript
// app/shared/types/gameCard.ts
export interface SharedGameCard {
  instanceId: string;
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  specialAbility: string;
  identifier: string;
  alignment: string;
  isMeek: boolean;
  isFlipped: boolean;
  isToken: boolean;
  counters: { color: string; count: number }[];
  zone: string;
  ownerId: string;
  notes: string;
  posX?: string;
  posY?: string;
}
```

Both modes already adapt their data into similar shapes for `GameCardNode`. We standardize this so all shared components use one type.

---

## Feature Backfill Plan

### Phase 1: DRY Extraction (Foundation)

Extract shared infrastructure that both modes need. This unlocks all subsequent phases.

#### 1.1 Expand `GameActions` Interface
- **File**: `app/shared/types/gameActions.ts`
- Add `moveCardToTopOfDeck`, `moveCardToBottomOfDeck`, `spawnLostSoul`, `removeLostSoul`, `advancePhase`, `setPhase`, `endTurn`, `rollDice`
- Both goldfish and multiplayer adapters implement the full interface

#### 1.2 Extract Keyboard Shortcuts Hook
- **From**: `app/goldfish/hooks/useKeyboardShortcuts.ts`
- **To**: `app/shared/hooks/useGameHotkeys.ts`
- Takes `GameActions` + optional mode config (e.g. multiplayer disables undo)
- Keys: D (draw), S (shuffle), R (roll), H (fan hand), Tab (loupe), Enter (advance phase), Ctrl+Z (undo, goldfish only), Escape (clear selection)

#### 1.3 Extract Phase Button Group
- **From**: Phase rendering logic in `PhaseBar.tsx` (goldfish) and `TurnIndicator.tsx` (multiplayer)
- **To**: `app/shared/components/PhaseButtonStrip.tsx`
- Props: `currentPhase`, `phases`, `onSelectPhase`, `disabled`, `variant` (top-bar vs bottom-bar styling)
- Both parent components compose this strip with their own layout wrappers

#### 1.4 Extract Card Image Utility
- **From**: 4+ duplicate definitions of `sanitizeImgFile()` and `getCardImageUrl()`
- **To**: `app/shared/utils/cardImageUrl.ts`
- Single source of truth for building card image URLs

#### 1.5 Extract Quick Menu / Toolbar
- **From**: `app/goldfish/components/GameToolbar.tsx`
- **To**: `app/shared/components/GameToolbar.tsx`
- Props: `actions: GameActions`, `mode: 'goldfish' | 'multiplayer'`, `isMyTurn?: boolean`, `isSpreadHand`, `onToggleSpreadHand`
- Multiplayer hides undo and new game buttons; disables draw/end-turn when not your turn
- Both modes render this above the hand zone

#### 1.6 Extract Dice Animation
- **From**: `app/goldfish/components/DiceRollOverlay.tsx` + `app/play/components/DiceOverlay.tsx`
- **To**: `app/shared/components/DiceOverlay.tsx`
- Unified component that handles any die (d6, d20, etc.)
- Props: `result`, `sides`, `rollerName?`, `onDismiss`
- Goldfish triggers via event emitter; multiplayer triggers via state change — both just pass props

### Phase 2: Modals & Deck Operations

These are the biggest feature gaps. The key insight: **deck search, peek, and browse are client-side operations**. The multiplayer client already subscribes to all of the player's own cards (including deck cards). These modals just need to filter the subscription data and call existing reducers to move cards.

#### 2.1 Extract Deck Search Modal
- **From**: `app/goldfish/components/DeckSearchModal.tsx`
- **To**: `app/shared/components/DeckSearchModal.tsx`
- Props: `deckCards: SharedGameCard[]`, `actions: GameActions`, `onClose`
- Both modes pass their deck cards (goldfish from local state, multiplayer from subscription)
- Search, filter, drag-to-zone all work through `GameActions`

#### 2.2 Extract Zone Browse Modal
- **From**: `app/goldfish/components/ZoneBrowseModal.tsx`
- **To**: `app/shared/components/ZoneBrowseModal.tsx`
- Props: `zone: string`, `cards: SharedGameCard[]`, `actions: GameActions`, `onClose`
- Used for: Discard, Reserve, Banish, Land of Redemption
- Both modes pass zone-filtered cards

#### 2.3 Extract Deck Peek Modal
- **From**: `app/goldfish/components/DeckPeekModal.tsx`
- **To**: `app/shared/components/DeckPeekModal.tsx`
- Props: `cards: SharedGameCard[]`, `source: 'top' | 'bottom' | 'random'`, `actions: GameActions`, `onClose`

#### 2.4 Extract Deck Exchange Modal
- **From**: `app/goldfish/components/DeckExchangeModal.tsx`
- **To**: `app/shared/components/DeckExchangeModal.tsx`
- Props: `cardsToExchange: SharedGameCard[]`, `deckCards: SharedGameCard[]`, `actions: GameActions`, `onClose`

#### 2.5 Extract Deck Drop Popup
- **From**: `app/goldfish/components/DeckDropPopup.tsx`
- **To**: `app/shared/components/DeckDropPopup.tsx`
- Props: `cardId: string`, `position: {x, y}`, `actions: GameActions`, `onClose`
- Shows on card drop onto deck zone: "Shuffle In / Top / Bottom / Exchange"

#### 2.6 Wire Deck Context Menu for Multiplayer
- Already shared at `app/shared/components/DeckContextMenu.tsx`
- Needs: sidebar pile click handler in MultiplayerCanvas to trigger it
- Needs: modal state management in the play client to open search/peek/browse modals

### Phase 3: Context Menus & Zone Interactions

#### 3.1 Wire Multi-Card Context Menu
- Already shared at `app/shared/components/MultiCardContextMenu.tsx`
- Needs: right-click handler for multi-selection in MultiplayerCanvas
- Actions: Move All to Zone, Meek All, Flip All, Deselect

#### 3.2 Extract Zone Context Menu (LOB Token Spawning)
- Already shared at `app/shared/components/ZoneContextMenu.tsx`
- Needs: right-click handler on LOB zone in MultiplayerCanvas
- Actions: Spawn NT Lost Soul, Spawn OT Lost Soul

#### 3.3 Extract LOR Context Menu
- **From**: `app/goldfish/components/LorContextMenu.tsx`
- **To**: `app/shared/components/LorContextMenu.tsx`
- Needs: click handler on LOR zone in MultiplayerCanvas

#### 3.4 Wire Sidebar Pile Click-Through
- Clicking deck pile → opens DeckContextMenu
- Clicking discard/reserve/banish/LOR → opens ZoneBrowseModal
- These are click handlers on the sidebar pile `<Group>` elements in MultiplayerCanvas

#### 3.5 Wire Double-Click Actions
- Double-click on card → toggle meek (call `actions.meekCard` / `unmeekCard`)
- Double-click on deck pile → draw card (call `actions.drawCard`)
- Already exists in goldfish; needs wiring in MultiplayerCanvas

### Phase 4: SpacetimeDB Backend Additions

New reducers needed for features that don't exist yet server-side:

#### 4.1 `move_card_to_top_of_deck` Reducer
- Moves card to deck zone with `zoneIndex = 0`, shifts other deck cards up by 1
- Validates ownership

#### 4.2 `move_card_to_bottom_of_deck` Reducer
- Moves card to deck zone with `zoneIndex = max + 1`
- Validates ownership

#### 4.3 `spawn_lost_soul` Reducer
- Creates a new `CardInstance` row with token data (NT or OT lost soul)
- `isToken = true`, owner = calling player, zone = land-of-bondage
- Stores position (posX, posY) for free-form placement

#### 4.4 `remove_token` Reducer
- Deletes a `CardInstance` row where `isToken = true`
- Validates ownership

### Phase 5: Layout & UX Polish

#### 5.1 Move Phase/Turn Bar to Top
- Currently: `TurnIndicator` is at the bottom (below canvas, 56px)
- Change: Move it to the top of the canvas area
- The `GameToolbar` (quick menu) takes its place at the bottom, near the hand
- Layout becomes: `[TurnBar 48px] [Canvas flex-1] [Toolbar 48px]`

#### 5.2 Add Hand Fan/Spread Toggle
- The shared `GameToolbar` includes the H button for fan/spread
- MultiplayerCanvas needs local state for `isSpreadHand`
- `calculateHandPositions` already supports both layouts (it's in the shared hand layout code)

#### 5.3 Add Card Hover Preview (Floating Tooltip)
- **From**: `app/goldfish/components/CardHoverPreview.tsx`
- **To**: `app/shared/components/CardHoverPreview.tsx`
- Shows near cursor when hovering a card on canvas (250ms delay)
- Props: `card: SharedGameCard | null`, `position: {x, y}`, `getImageUrl: (card) => string`

#### 5.4 Fix Multi-Card Drag
- User reported that dragging multiple selected cards doesn't work properly
- Debug and fix the ghost layer logic in MultiplayerCanvas (follower offsets, visibility toggling)

### Phase 6: Multiplayer-Only Features

#### 6.1 View Opponent's Public Zones
- Opponent's Discard, Banish, and Land of Redemption should be browseable
- Click on opponent sidebar pile → opens ZoneBrowseModal in read-only mode
- Props addition: `readOnly?: boolean` (hides move/action buttons)

#### 6.2 Consent-Based Zone Search (Future)
- Player A requests to search Player B's deck/hand/reserve
- Player B gets a prompt: "Player A wants to search your [zone]. Allow?"
- On consent, a temporary ZoneBrowseModal opens for Player A showing the cards
- **Implementation**: New SpacetimeDB table `ZoneSearchRequest` with fields: `requesterId`, `targetPlayerId`, `zone`, `status` (pending/approved/denied)
- New reducers: `request_zone_search`, `approve_zone_search`, `deny_zone_search`
- Client shows a consent dialog when a pending request targets them
- **Deferred**: This is complex and can be a follow-up PR

---

## File Movement Summary

### New Shared Files (extracted from goldfish)
| New Location | Source |
|---|---|
| `app/shared/types/gameActions.ts` | Expanded from existing |
| `app/shared/types/gameCard.ts` | New (standardized card interface) |
| `app/shared/hooks/useGameHotkeys.ts` | From `goldfish/hooks/useKeyboardShortcuts.ts` |
| `app/shared/components/GameToolbar.tsx` | From `goldfish/components/GameToolbar.tsx` |
| `app/shared/components/PhaseButtonStrip.tsx` | Extracted from PhaseBar + TurnIndicator |
| `app/shared/components/DiceOverlay.tsx` | Merged from both modes |
| `app/shared/components/CardHoverPreview.tsx` | From `goldfish/components/CardHoverPreview.tsx` |
| `app/shared/components/DeckSearchModal.tsx` | From `goldfish/components/DeckSearchModal.tsx` |
| `app/shared/components/ZoneBrowseModal.tsx` | From `goldfish/components/ZoneBrowseModal.tsx` |
| `app/shared/components/DeckPeekModal.tsx` | From `goldfish/components/DeckPeekModal.tsx` |
| `app/shared/components/DeckExchangeModal.tsx` | From `goldfish/components/DeckExchangeModal.tsx` |
| `app/shared/components/DeckDropPopup.tsx` | From `goldfish/components/DeckDropPopup.tsx` |
| `app/shared/components/LorContextMenu.tsx` | From `goldfish/components/LorContextMenu.tsx` |
| `app/shared/utils/cardImageUrl.ts` | Consolidated from 4+ locations |

### Goldfish Files That Become Thin Wrappers
After extraction, the original goldfish files become thin wrappers or get deleted:
- `goldfish/hooks/useKeyboardShortcuts.ts` → imports from shared, passes goldfish actions
- `goldfish/components/GameToolbar.tsx` → replaced by shared version
- `goldfish/components/DeckSearchModal.tsx` → replaced by shared version
- etc.

### New SpacetimeDB Reducers
| Reducer | Purpose |
|---|---|
| `move_card_to_top_of_deck` | Position-aware deck placement |
| `move_card_to_bottom_of_deck` | Position-aware deck placement |
| `spawn_lost_soul` | Create token card instance |
| `remove_token` | Delete token card instance |

---

## Implementation Order & Dependencies

```
Phase 1 (Foundation) ──────────────────────────
  1.1 GameActions interface expansion
  1.2 useGameHotkeys extraction
  1.3 PhaseButtonStrip extraction
  1.4 cardImageUrl utility extraction
  1.5 GameToolbar extraction
  1.6 DiceOverlay unification

Phase 2 (Modals) ──────── depends on Phase 1 ──
  2.1 DeckSearchModal extraction
  2.2 ZoneBrowseModal extraction
  2.3 DeckPeekModal extraction
  2.4 DeckExchangeModal extraction
  2.5 DeckDropPopup extraction
  2.6 Wire modals into multiplayer client

Phase 3 (Interactions) ── depends on Phase 1 ──
  3.1 Multi-card context menu wiring
  3.2 Zone context menu (LOB tokens)
  3.3 LOR context menu extraction
  3.4 Sidebar pile click-through
  3.5 Double-click actions

Phase 4 (Backend) ──────── independent ─────────
  4.1 move_card_to_top_of_deck reducer
  4.2 move_card_to_bottom_of_deck reducer
  4.3 spawn_lost_soul reducer
  4.4 remove_token reducer

Phase 5 (Layout/UX) ──── depends on Phase 1 ───
  5.1 Move TurnBar to top, Toolbar to bottom
  5.2 Hand fan/spread toggle
  5.3 Card hover preview extraction
  5.4 Fix multi-card drag

Phase 6 (Multiplayer-only) ── depends on P2,P4 ─
  6.1 Browse opponent public zones
  6.2 Consent-based zone search (deferred)
```

Phases 2, 3, 4, and 5 can largely proceed in parallel after Phase 1 completes.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Moving modals breaks goldfish | Extract, update goldfish imports, verify goldfish still works before wiring multiplayer |
| GameActions interface too big | Keep optional methods with `?` — modes only implement what they support |
| Deck search reveals hidden info in multiplayer | Client already subscribes to own deck cards — this is intentional (goldfish-like practice). Future: consent-based search for opponent zones |
| SpacetimeDB reducer additions break existing games | New reducers are additive — no schema migrations needed, just new code paths |
| Multi-card drag fix is complex | Isolate as independent task; debug Konva ghost layer logic separately |

---

## Success Criteria

- All 25 features from the gap matrix are addressed (either implemented or explicitly deferred with rationale)
- Goldfish mode continues to work identically after extractions (regression test: run through a full goldfish game)
- No duplicate component implementations between `app/goldfish/` and `app/play/`
- `app/shared/` contains all reusable game UI components
- TypeScript compiles cleanly with no errors
