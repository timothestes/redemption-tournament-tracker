# Goldfish / Practice Mode — Requirements & Design

> **Status**: Pre-planning / requirements gathering
> **Goal**: A solo sandbox for players to shuffle up a saved deck, simulate hands and turns, and practice lines of play — with architecture that could extend to multiplayer.

---

## 1. What Is "Goldfish" Mode?

"Goldfishing" is a term in CCG culture for playing a deck by yourself — no opponent — to test consistency, understand sequencing, and get reps with a strategy. The UI should simulate a physical table with all zones visible, cards movable between them, and useful shortcuts for common actions.

**This is NOT a rules engine.** No automatic enforcement of game rules. It is a sandbox where the player controls everything manually, like sitting at a table and manipulating cards by hand.

---

## 2. Entry Points

### 2a. All Entry Point Surfaces

The Goldfish button should appear **everywhere a deck is displayed or acted upon**, always as the same unified component. No login is required — any deck (yours, public, or pasted) can be goldfished.

| Surface | Location in UI | Notes |
|---------|---------------|-------|
| **Community Decks grid** (`/decklist/community`) | Action button row on each deck card, alongside View / Edit Copy / Download | No auth needed; loads the public deck directly |
| **Individual deck page** (`/decklist/[deckId]`) | Primary action bar at the top of the page | Works for both owner and non-owner views |
| **My Decks page** (`/decklist/my-decks`) | Action button in the deck row/card menu | Owner only, but same button |
| **Deck builder** (`/decklist/card-search`) | Toolbar/header of the deck panel when a deck is loaded | Quick "test this deck" flow from build mode |
| **Guest / paste-in** (`/goldfish`) | Standalone entry page with a text-area for pasting a deck list | No deck ID needed; useful for sharing a link with a list |

### 2b. Routing

```
/goldfish/[deckId]          # Saved deck (public or owned)
/goldfish?import=[base64]   # Paste-in / shareable deck list (base64-encoded standard format)
/goldfish                   # Blank entry page — paste a list or pick a saved deck
```

The `[deckId]` route works for **any public deck** — it loads the card list server-side and passes it to the client-side game engine. Ownership is not required.

### 2c. The Unified "Practice" Button

A single reusable component used on every surface above.

**Visual spec:**

```
┌─────────────────────────────┐
│  ▶  Practice                │   ← default / full label
└─────────────────────────────┘

┌──────┐
│  ▶   │                          ← icon-only variant (tight spaces, e.g. community card)
└──────┘
```

- **Icon**: A play triangle (▶) — universally understood as "start" and requires no CCG jargon
- **Label** (full variant): "Practice" — approachable for new players; goldfishers know what it means
- **Color**: Green (`bg-green-700 hover:bg-green-800`) to distinguish from neutral gray action buttons, matching the existing primary-action green used throughout the app
- **Icon-only variant**: Used on the community deck card where space is tight (same row as View / Edit Copy / Download); shows a tooltip "Practice this deck" on hover
- **Tooltip**: Always present — `title="Practice this deck"` on icon-only; on full button, the label is sufficient

**Component signature** (for future implementation reference):
```tsx
<GoldfishButton
  deckId={deck.id}           // if loading from DB
  deckName={deck.name}       // for page title
  format={deck.format}       // pre-fills format in game; user can override in settings
  iconOnly={false}           // compact mode for tight UIs
/>
```

**Placement on community deck card** (fits into existing action button row):
```
[ View ]  [ Edit Copy ]  [ ▶ ]  [ ↓ ]
                         ^           ^
                     Practice    Download
```

**Placement on individual deck page** (primary action bar):
```
[ Edit ]  [ ▶ Practice ]  [ Make Public ]  [ Download ]  [ Copy & Edit ]
```

**Placement on My Decks** (in the existing three-dot/action menu or inline buttons):
```
[ Edit ]  [ ▶ Practice ]  [ ··· more ]
```

### 2d. Guest / No-Login Flow

- The goldfish page requires **no authentication**
- For public/community decks, the deck data is fetched server-side before the page renders (standard Next.js `page.tsx` data fetch)
- For pasted decks, card image lookups happen the same way as the deck builder (Vercel Blob + GitHub fallback)
- Guest users can goldfish any public deck; they just can't save progress or access private decks

---

## 3. Game Zones & State Model

All zones are modeled as ordered arrays of card objects. State lives client-side (no server calls during play).

**Zones should feel loose and forgiving.** Once a card is dropped into a zone it simply joins that zone's card collection — there are no rigid sub-slots, fixed grid positions, or snap points within a zone that the card gets "locked" to. Cards within a zone can be freely reordered by dragging, but the zone itself should never feel like it's fighting the player over exactly where a card lands.

### Zones

| Zone | Location in Layout | Default Visibility | Notes |
|------|-------------------|-------------------|-------|
| **Deck** | Out-of-Play sidebar | Face-down (count only) | Primary draw source |
| **Hand** | Bottom of screen | Face-up to owner only | Fan display |
| **Reserve** | Out-of-Play sidebar | Face-down (count only) | Starts loaded, can't remove in round 1 |
| **Discard Pile** | Out-of-Play sidebar | Face-up, browsable | Click to view full pile |
| **Paragon** | Territory (top-right corner) | Face-up | Paragon format only. Shows cropped card art like a deck preview thumbnail; click or hover reveals full card. Placed automatically on game start when format = Paragon. Not part of the deck. |
| **Land of Bondage** | Bottom of Territory | Face-up | Lost Souls drawn go here automatically |
| **Heroes** | Territory (mid-left) | Face-up | Characters in territory |
| **Evil Characters** | Territory (mid-left below heroes) | Face-up | Evil characters in territory |
| **Fortresses** | Territory (right) | Face-up | |
| **Artifact Pile** | Territory (right, below Fortresses) | Face-up | Active + face-down |
| **Field of Battle** | Top gray area | Face-up | Split: Attacker's Forces / Defender's Forces |
| **Land of Redemption** | Out-of-Play sidebar | Face-up | Rescued souls |
| **Banish Zone** | Out-of-Play sidebar | Face-up, browsable | Cards removed from the game entirely (equivalent to MTG exile); cards here do not return unless a card ability explicitly retrieves them |

### Card Object Model

```typescript
interface GameCard {
  instanceId: string;      // Unique per copy in this game session (uuid)
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  type: string;            // 'Hero', 'Evil Character', 'Enhancement', etc.
  brigade: string;
  strength: number | null;
  toughness: number | null;
  specialAbility: string;
  isMeek: boolean;         // flipped 180° (card is "meek" / inactive)
  counters: number;        // generic counter number displayed as badge
  isFlipped: boolean;      // face-down state
  zone: ZoneId;
  x: number;               // canvas x position within zone (react-konva)
  y: number;               // canvas y position within zone (react-konva)
  ownerId: 'player1' | 'player2';  // future multiplayer
  notes: string;           // free-text annotation on card
}

type ZoneId =
  | 'deck' | 'hand' | 'reserve' | 'discard'
  | 'paragon'                                    // Paragon format only; single card slot
  | 'land-of-bondage' | 'heroes' | 'evil-characters'
  | 'fortresses' | 'artifact-pile'
  | 'field-of-battle-attacker' | 'field-of-battle-defender'
  | 'land-of-redemption' | 'banish';
```

### Game State Model (serializable for future multiplayer)

```typescript
interface GameState {
  sessionId: string;
  deckId: string;
  format: 'T1' | 'T2' | 'Paragon';
  turn: number;
  phase: GamePhase;
  zones: Record<ZoneId, GameCard[]>;
  history: GameAction[];   // undo stack
  options: GoldfishOptions;
}

type GamePhase = 'draw' | 'upkeep' | 'preparation' | 'battle' | 'discard' | 'setup';
```

---

## 4. UI Layout

Based on the official Player's Card Arrangement diagram.

```
┌─────────────────────────────────────────────┬─────────────────┐
│ FIELD OF PLAY                               │  OUT OF PLAY    │
│ ┌─────────────────────────────────────────┐ │                 │
│ │  FIELD OF BATTLE                        │ │  Land of        │
│ │  [Defender's Forces]  [Attacker's]      │ │  Redemption     │
│ │                                         │ │                 │
│ └─────────────────────────────────────────┘ │  [Deck]         │
│ ┌─────────────────────────────────────────┐ │                 │
│ │  TERRITORY                              │ │  [Discard]      │
│ │  [Heroes...]   [Fortresses] [Paragon*]  │ │                 │
│ │  [Evil Chars...]    [Artifact Pile]     │ │  [Reserve]      │
│ │  [Land of Bondage (Lost Souls)]         │ │                 │
│ └─────────────────────────────────────────┘ │  [Banish Zone]  │
└─────────────────────────────────────────────┴─────────────────┘
 [HAND: cards spread across bottom of screen                    ]
```

- **Full-viewport layout** — no page scroll; the board fills the browser window
- **Phase bar** at the top: Draw → Upkeep → Prep → Battle → Discard (click to advance)
- **Turn counter** and **Souls rescued** counter always visible
- **Floating action toolbar** for quick actions (draw card, reset, undo)

---

## 5. Drag & Drop Library Recommendation

### Recommended: `react-konva`

`react-konva` renders the entire game board as an HTML5 Canvas using Konva.js, with React components for each element. This is the right choice for this project because it matches the "loose and forgiving" zone feel described above — cards are positioned by x/y coordinates on the canvas, not locked into DOM slots.

**Why react-konva fits:**
- Cards can be dragged freely anywhere on the board, exactly like sliding a card across a real table
- No rigid DOM structure — zones are drawn regions, not grid containers that fight card placement
- Smooth pointer and touch handling built in
- `isMeek` (180° rotation) and `isFlipped` states are trivial CSS/canvas transforms on the card sprite
- The canvas model maps naturally to a serializable `{x, y, zone}` game state, keeping multiplayer extension clean
- Cards can overlap, fan, or stack naturally without layout constraints

**Trade-offs to be aware of:**
- No native browser accessibility (screen readers can't see canvas content) — acceptable for a game board
- Card text / tooltips need custom implementation (can overlay DOM elements on top of the canvas for modals and context menus)
- Initial learning curve higher than a DOM-based DnD library

**Hybrid approach (recommended):** Use `react-konva` for the game board itself (card sprites, zones, drag interactions). Layer standard DOM elements on top for the context menu, modals (card zoom, deck search), and the phase bar — these are well-supported by the existing Radix/shadcn components in the project.

### Context Menu for Card Actions

Use **`@radix-ui/react-context-menu`** — already available via shadcn/ui in this project. Right-click (or long-press mobile) any card to get the action menu.

---

## 6. Card Interaction Model

### 6a. Drag and Drop

- Drag any card from any zone to any valid zone
- Visual feedback: card lifts, source zone dims, valid drop targets highlight
- Snap-to-zone on drop (not free-form in MVP)
- Shift+drag to move multiple selected cards at once (Phase 2)

### 6b. Right-Click / Long-Press Context Menu

Every card should have a context menu with actions appropriate to its current zone:

**Universal actions** (always available):
- View card (zoom modal)
- Add counter / Remove counter
- Add note / annotation
- Make Meek / Unmeek (flip 180°)
- Flip face-down / face-up

**Move actions** (destination list):
- Send to top of deck
- Send to bottom of deck
- Shuffle into deck
- Send to discard
- Send to hand
- Send to Land of Bondage
- Send to Land of Redemption
- Send to Banish Zone
- Send to Field of Battle (attacker or defender)
- Send to territory (heroes / evil chars / fortresses / artifact pile)
- Send to reserve

### 6c. Zone-Specific Click Actions

| Zone | Single Click | Right-Click |
|------|-------------|------------|
| Deck | Draw 1 card to hand | Search deck / Look at top N / Draw N |
| Discard Pile | Open browse modal | — |
| Reserve | Open browse modal | — |
| Land of Bondage | — | — |
| Field of Battle | — | — |
| Land of Redemption | — | — |
| Banish Zone | Open browse modal | — |

### 6d. Deck Actions (from right-click on deck pile)

- Draw 1 card
- Draw N cards (prompt for number)
- Look at top N cards (private peek — see below)
- Reveal top N cards (public reveal — see below)
- Search deck (full searchable list, select cards to pull to hand)
- Shuffle
- Put bottom card on top
- View entire deck list

#### Look vs. Reveal modes

Both modes open a card-viewer modal showing the selected cards face-up in a scrollable grid. The distinction is intent (private vs. public), not mechanics — in a solo goldfish session they behave identically.

**In both Look and Reveal modes, every card shown is actionable:**
- Click a card to zoom it (full-size image + text)
- Right-click (or long-press) a card to get a condensed move menu:
  - Send to hand
  - Send to top of deck
  - Send to bottom of deck
  - Shuffle into deck
  - Send to discard
  - Send to Banish Zone
  - Send to Land of Bondage
  - Send to Field of Battle
  - Send to territory
- Cards that are moved are removed from the modal view immediately
- Any cards still in the modal when it is closed return to the top of the deck in their original order (unless the player explicitly shuffled)

### 6e. Card Zoom

- Click any face-up card to open a full-size zoom modal
- Modal shows card image + card text panel (name, type, brigade, str/tough, ability)
- Keyboard: Escape to close

---

## 7. Game Setup Flow

### 7a. Start Game Flow

The game starts **automatically** when the goldfish page loads — no modal, no confirmation step. The deck's format is read from its metadata and passed in directly so the player lands on a ready board.

For entry points that carry deck metadata (My Decks, Community, individual deck page, deck builder), the `GoldfishButton` passes `deckId` and `format` to the route. The page uses these to initialize immediately.

If the player wants to **change the format** before or during a session, a small format selector is available in the settings panel (accessible via a gear icon in the toolbar) — but it is not shown upfront.

### 7b. Initialization Sequence

1. Separate Reserve cards → Reserve zone
2. Shuffle remaining cards → Deck zone
3. Apply "always start with" options (tutor specific cards to hand before drawing)
4. Draw opening hand: draw cards one at a time, auto-routing Lost Souls to Land of Bondage and replacing with another draw until 8 non-soul cards are in hand
5. First turn reminder displayed inline (small, dismissible): "First player skips the Draw phase on turn 1"

### 7c. Mulligan (optional for goldfishing)

- Use **New Game** to scoop everything and redraw a fresh opening hand
- Partial mulligan: drag individual hand cards back to the deck pile (which shuffles them in), then draw replacements manually

---

## 8. Goldfish Options & Settings

All settings are accessible from the gear icon in the toolbar during a session. There is no pre-game settings screen — the game starts immediately.

### Basic Options

| Option | Description |
|--------|-------------|
| Format | Pre-filled from deck metadata; can be overridden in the settings panel mid-session |
| Starting hand size | Default 8, adjustable 1–15 (hard cap of 16 enforced during play) |
| Auto-route Lost Souls | Auto-detect Lost Soul type and send to Land of Bondage on draw (on by default) |
| Show phase reminder | Display what actions are legal each phase |
| Show turn counter | Toggle turn/round counter display |

### Advanced Options

| Option | Description |
|--------|-------------|
| Always start with [card] | Choose up to 3 cards to always have in opening hand (tutored before initial draw). Useful for testing specific setups. |
| Always start with [card] in Reserve | Pre-populate reserve with specific cards regardless of deck shuffle |
| Opening hand size override | Draw N cards instead of 8 |
| Extra initial draw | Draw N bonus cards at the start (for testing late-game scenarios) |
| Scenario mode | Skip to a specific turn / game state (Phase 2) |

### Session Utilities

- **Undo** (Ctrl+Z): Revert last card movement. History stack of last 20 actions.
- **New Game**: Prominent button in the toolbar. Resets everything — all cards back to deck, all zones cleared, re-runs the full initialization sequence. No confirmation dialog needed since undo covers accidental clicks.
- **Pause / Resume**: Freeze state (useful if mid-session in a browser tab)

---

## 9. Phase Tracker

A clickable phase bar displayed prominently:

```
[Draw] → [Upkeep] → [Preparation] → [Battle] → [Discard] → [End Turn]
```

- Clicking **Draw** triggers an animated "draw 3" action (with auto-routing Lost Souls)
- Each phase shows a tooltip with what actions are legal
- **End Turn** advances the turn counter and resets to Draw phase
- Phase is cosmetic only — no rules enforcement. Players can deviate freely.

---

## 10. Opponent Simulation

Two lightweight tools to make solo goldfish sessions more realistic without requiring a real opponent.

### 10a. Add Opponent Lost Soul

A button in the toolbar (or right-click on the opponent's Land of Bondage area) that adds a generic face-down Lost Soul token to the opponent's Land of Bondage. This gives you a soul to rescue so you can practice full battle sequences, not just setup.

- Uses a generic Lost Soul card back image (no specific card data needed)
- Each press adds one soul
- Souls can be moved to Land of Redemption via the normal card context menu once rescued
- No limit — add as many as the scenario requires

### 10b. Simulate Opponent's Attack

A toolbar button — **"Simulate Attack"** — that places a generic Hero card face-up on the Attacker's Forces side of the Field of Battle. The goldfisher then selects a **battle style preset** that describes the threat they are practicing against. This is purely a label/context — no rules are enforced — but it helps the player stay focused on what they are trying to solve.

**Battle style presets** (select one when triggering the attack):

| Preset | What it represents | How goldfisher should respond |
|--------|--------------------|-------------------------------|
| **Fight by the Numbers** | Opponent's hero is attacking purely on raw strength/toughness — no tricks | Beat it with superior stats or a well-timed enhancement |
| **Toss the Next** | Opponent will discard your first enhancement played this battle | Play a disposable card first, or find an alternative win condition |
| **Protect Decks** | Opponent is playing defensively — focused on blocking to prevent counter-attacks on their Lost Souls | Look for ways to band out of danger or create a rescue path anyway |
| **Choose the Blocker** | Opponent gets to select which of your Evil Characters steps up to block their Hero | Account for your weakest blocker being chosen; position accordingly |
| **Big Banding Chain** | Opponent is bringing multiple Heroes into battle via banding — overwhelming by numbers | Find a broad block, a discard effect, or a dominant to break the chain |

**UI flow:**
1. Player clicks "Simulate Attack" in the toolbar
2. A small popover appears with the 5 preset buttons
3. Player picks a preset — a generic Hero card tile appears in the Attacker's Forces zone with the preset name displayed as a label on the card
4. Player proceeds to respond with their own cards normally
5. "End Battle" button returns the simulated Hero to a cleared state (it disappears — it is a token, not a real card from any deck)

The simulated hero has no stats, no image beyond a generic card back or placeholder, and no special ability text. Its only purpose is to occupy the Field of Battle slot and carry the preset label so the goldfisher has a concrete thing to play against.

---

## 11. Multiplayer-Readiness Architecture

The goldfish mode is designed so that adding a second player (online or local) requires minimal refactoring.

### Design Principles

1. **All state is serializable JSON** — no DOM state. `GameState` can be sent over a WebSocket.
2. **Actions are data** — every card move is a `GameAction` object dispatched to a reducer. In multiplayer, actions come from either the local player or the server.
3. **Zones are namespaced by owner** — `ownerId: 'player1' | 'player2'` on every card and zone.
4. **Perspective toggle** — the board can be "flipped" to show opponent's side at the top, matching how you'd sit across a table.
5. **Hidden information** — cards in Hand and Deck zones are face-down to the opponent. The state model tracks `isFlipped` and the rendering layer respects it.

### Future Multiplayer Extension Path

- **Phase 2: Local 2-player ("pass and play")** — one screen, two hands. Player 1 sees their hand, clicks "Pass Device", Player 2 sees their hand.
- **Phase 3: Online multiplayer** — Supabase Realtime (Postgres changes) broadcasts `GameAction` objects to both clients. One player hosts, state is authoritative server-side.
- **Phase 4: Spectator mode** — read-only view of a live game. Useful for streaming/tournaments.

```typescript
interface GameAction {
  id: string;
  type: ActionType;
  playerId: 'player1' | 'player2';
  timestamp: number;
  payload: {
    cardInstanceId?: string;
    fromZone?: ZoneId;
    toZone?: ZoneId;
    toIndex?: number;    // position in target zone
    quantity?: number;
    value?: number | string;
  };
}

type ActionType =
  | 'MOVE_CARD' | 'DRAW_CARD' | 'SHUFFLE_DECK'
  | 'ADD_COUNTER' | 'REMOVE_COUNTER' | 'MEEK_CARD' | 'UNMEEK_CARD'
  | 'FLIP_CARD' | 'RESET_GAME' | 'START_GAME'
  | 'ADVANCE_PHASE' | 'END_TURN' | 'ADD_NOTE';
```

---

## 11. Drawing Cards & Searching Zones UX

### Drawing

- Click the Deck pile → draws 1 card, animates card sliding to hand
- Phase bar "Draw" button → draws 3 cards in sequence (with animation delay between each)
- Lost Soul auto-routing: when a Lost Soul is drawn, it slides to Land of Bondage and a replacement card is drawn automatically (with a brief visual callout "Lost Soul routed to bondage, drawing replacement")
- **Hand limit: 16 cards.** Drawing is blocked once 16 non-Lost-Soul cards are in hand — the draw action is a no-op with a brief toast "Hand is full (16 cards)". Exception: if the 16th card drawn is a Lost Soul, it routes to Land of Bondage as normal and the replacement draw still fires — because the soul never occupied a hand slot.

### Searching Deck

A modal with a scrollable list of all cards in the deck, showing card image thumbnails and names. Player can:
- Search/filter by name or type
- Select one or more cards
- Action: "Pull to hand", "Move to top", "Move to bottom", "Remove from deck"
- Remaining deck is automatically shuffled after a search (with option to skip shuffle)

### Browsing Discard / Reserve / Banish Zone

Similar browse modal — all cards shown face-up in a grid, no shuffle triggered.

---

## 12. Mobile Considerations

The full goldfish board is complex for small screens. Options:

- **Mobile:** Show a simplified view — hand at bottom, zone list on side as icon buttons that open modals for each zone. Drag-and-drop replaced by tap-to-select → tap-target-zone.
- **Tablet/iPad:** Full board layout may work in landscape mode.
- **Desktop:** Full drag-and-drop board is the primary target.

Flag the feature as "best experienced on desktop" for MVP.

---

## 13. Technical Architecture

### Routing

- `app/goldfish/page.tsx` — blank entry page (paste-in / pick a deck)
- `app/goldfish/[deckId]/page.tsx` — loads deck data server-side by deckId, passes to client component
- `app/goldfish/[deckId]/GoldfishBoard.tsx` — pure client component, no server calls during play
- Query param `?import=[base64]` handled in `app/goldfish/page.tsx` for paste-in decks

### State Management

- `useReducer` + `useContext` for the game state (no external state lib needed)
- Local session state only — no Supabase writes during play
- Optional: `localStorage` autosave every N seconds (restore if tab is accidentally closed)

### Card Images

- Same image pipeline as the deck builder — Vercel Blob or the GitHub image URL fallback
- Images preloaded at session start for smooth drag-and-drop

### Libraries to Add

| Library | Purpose |
|---------|---------|
| `react-konva` | Canvas-based game board — card sprites, zones, drag interactions |
| `konva` | Peer dependency of react-konva |
| `@radix-ui/react-context-menu` | Right-click card menus (likely already available via shadcn) |

---

## 14. Scope: MVP vs. Future

### MVP (Goldfish v1)

- [ ] Full board layout with all zones
- [ ] Load a saved deck and shuffle
- [ ] Auto-separate Reserve; auto-route Lost Souls on draw
- [ ] Canvas game board with drag-and-drop between all zones (`react-konva`)
- [ ] Right-click context menu with all move actions
- [ ] Zone click actions (draw, browse discard, search deck)
- [ ] Make Meek/Unmeek, add/remove counters
- [ ] Phase bar (cosmetic) + turn counter
- [ ] Undo (20-action history)
- [ ] New Game button (toolbar, resets everything)
- [ ] Paragon zone (art thumbnail + click/hover for full card, Paragon format only)
- [ ] Opponent simulation: Add Opponent Lost Soul button
- [ ] Opponent simulation: Simulate Attack with battle style presets
- [ ] "Always start with [card]" option
- [ ] Card zoom modal
- [ ] Desktop-optimized layout

### Future / Phase 2

- [ ] Free-form card placement anywhere on the board (x/y within zones)
- [ ] Multi-card selection and bulk move
- [ ] Scenario mode (start at a specific game state)
- [ ] Local 2-player (pass-and-play)
- [ ] Session autosave / restore
- [ ] Mobile simplified view
- [ ] Export session replay

### Future / Phase 3 (Multiplayer)

- [ ] Online real-time multiplayer via Supabase Realtime
- [ ] Spectator mode
- [ ] Chat / emote system
- [ ] Deck privacy (hand hidden from opponent)

---

## 15. Open Questions

### Resolved
- **Card back asset**: User is providing a card-back image for face-down cards. ✅

### Resolved

- **Card back asset**: User is providing a card-back image for face-down cards. ✅
- **Empty deck behavior**: Silent no-op — nothing happens when drawing from an empty deck. ✅
- **Hand display**: Fan display, cards overlap more tightly as count grows toward the 16-card cap. Fan is recommended over a flat row — it's more immersive and mimics holding a real hand of cards. ✅
- **Zone card count indicators**: All sidebar zones (Deck, Discard, Reserve, Banish Zone, Land of Redemption, Land of Bondage) show a live count badge. ✅
- **Route location**: Top-level `/goldfish/[deckId]` and `/goldfish`. Cleaner for sharing, easier for guests, and avoids nesting the game board under `/decklist/`. Technical Architecture section updated accordingly. ✅
- **Animation fidelity**: Instant for MVP, CSS transitions added in Phase 2. ✅
- **Paragon format setup**: Paragon zone auto-placed in Territory on game start when format = Paragon. Displays cropped card art (like deck preview thumbnail); click or hover shows full card. Paragon images already exist at `/public/paragons/`. ✅
- **Keyboard shortcuts**: Small set — `D` draw a card, `Enter` advance phase / end turn, `N` new game, `S` shuffle deck, `Ctrl+Z` undo. ✅
- **New hand vs. New Game**: Simplified to a single **New Game** button that resets everything. No separate "new hand" utility. ✅
- **Canvas performance**: Not a concern for this project's expected deck sizes. ✅
- **Opponent simulation**: "Add Opponent Lost Soul" and "Simulate Attack" both included in MVP. See Section 10. ✅

---

## 16. Reference

- Deck data format: see `prompt_context/deckbuilder_overview.md` and `card_search.md`
- Existing deck state management: `app/decklist/card-search/hooks/useDeckState.ts`
