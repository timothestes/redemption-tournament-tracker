# Goldfish / Practice Mode — Requirements & Design

> **Status**: Core implementation complete (Phases 1-5, 8) — iterating based on user feedback
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
  deckId?: string            // DB-backed deck; omit for paste-in flow
  deckName={deck.name}       // for page title
  format={deck.format}       // pre-fills format in game; user can override in settings
  iconOnly={false}           // compact mode for tight UIs
/>
```

**Placement on community deck card** (fits into existing action button row):
```
[ View ]  [ Copy ]  [ ▶ ]  [ ↓ ]
                     ^         ^
                 Practice  Download
```
- "View" and "Copy" are text buttons with `flex-1` to fill available space
- "Practice" (▶) and "Download" (↓) are compact icon-only buttons to prevent crowding

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

### 3a. Zones

| Zone | Location in Layout | Default Visibility | Notes |
|------|-------------------|-------------------|-------|
| **Deck** | Out-of-Play sidebar | Face-down (count only) | Primary draw source |
| **Hand** | Bottom of screen | Face-up to owner only | Fan display |
| **Reserve** | Out-of-Play sidebar | Face-up, horizontal overlap | Starts loaded, cards displayed in a horizontal overlapping row (same style as Land of Redemption) |
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

### 3b. Card Object Model

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

### 3c. Game State Model (serializable for future multiplayer)

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
- **Phase bar** at the top: Draw → Upkeep → Preparation → Battle → Discard (click to advance), with turn counter integrated on the left side
- **Zone count badges** on all sidebar zones (Deck, Reserve, Discard, Banish, Land of Redemption) — souls rescued count is shown as the Land of Redemption badge
- **Floating action toolbar** for quick actions (draw card, shuffle, undo, new game, spread hand)

---

## 5. Rendering, Animation & Immersion Stack

The goldfish board should feel like a **polished video game**, not a styled web UI. Every card move, phase change, and game event should have a satisfying physical quality — the snap of a card being placed, the shimmer of a soul being rescued, the rumble of battle beginning. This section defines the full library stack that makes that possible.

---

### 5a. Game Board Renderer: `react-konva`

`react-konva` renders the entire game board as an HTML5 Canvas using Konva.js. Cards are positioned by `x`/`y` coordinates, zones are drawn regions, and drag-and-drop is first-class.

**Why react-konva fits:**
- Cards slide freely — no DOM layout fighting card placement
- `draggable={true}` on any canvas node; zone hit-testing is pure geometry
- `isMeek` (180° rotation) and `isFlipped` are simple canvas transforms
- State maps directly to `{ x, y, zone }` — clean serialization for future multiplayer
- Cards overlap, fan, and stack naturally without layout constraints

**Next.js integration (required):**

```ts
// next.config.ts
webpack: (config) => {
  config.externals = [...(config.externals || []), { canvas: 'canvas' }];
  return config;
}
```

```tsx
// GoldfishBoard.tsx
const GoldfishCanvas = dynamic(() => import('./GoldfishCanvas'), { ssr: false });
```

**Trade-offs:** No browser accessibility (acceptable for a game). Modals and context menus are DOM overlays positioned above the canvas.

---

### 5b. Canvas Animations: `gsap` + `@gsap/react`

GSAP (GreenSock Animation Platform) is the key library for making the board feel alive. Unlike DOM-based animation libraries (Framer Motion, React Spring), **GSAP can animate Konva node properties directly** — the same `x`, `y`, `scaleX`, `rotation` values that Konva uses for rendering.

**Core pattern:**

```ts
import { gsap } from 'gsap';

// Animate a card from its deck position to its fan position in hand
function animateCardDraw(cardNode: Konva.Image, targetX: number, targetY: number, layer: Konva.Layer) {
  gsap.to(cardNode, {
    x: targetX,
    y: targetY,
    duration: 0.35,
    ease: 'power2.out',
    onUpdate: () => layer.batchDraw(), // re-renders canvas on each GSAP tick
  });
}

// Flip a card face-down ↔ face-up (scaleX collapse-swap-expand trick)
function animateCardFlip(cardNode: Konva.Image, newImage: HTMLImageElement, layer: Konva.Layer) {
  const tl = gsap.timeline();
  tl.to(cardNode, { scaleX: 0, duration: 0.12, ease: 'power1.in', onUpdate: () => layer.batchDraw() });
  tl.call(() => cardNode.image(newImage));
  tl.to(cardNode, { scaleX: 1, duration: 0.12, ease: 'power1.out', onUpdate: () => layer.batchDraw() });
}

// Meek/unmeek: rotate 180°
gsap.to(cardNode, { rotation: 180, duration: 0.25, ease: 'power2.inOut', onUpdate: () => layer.batchDraw() });
```

**Animations to implement with GSAP:**

| Event | Animation |
|-------|-----------|
| Draw card | Card slides from deck pile (right sidebar) to hand fan position with ease-out arc |
| Zone-to-zone move | Card lifts (scale 1.1, slight y-up), travels to destination (power2.inOut), settles (scale 1.0 with bounce) |
| Card flip | scaleX collapse → image swap → scaleX expand (150ms total) |
| Make meek | 180° rotation with smooth ease |
| Shuffle | Rapid staggered x/y jitter tween on deck pile cards, then snap back |
| Lost Soul routed | Card slides toward Land of Bondage with a golden glow flash (`Konva.Rect` overlay fading out) |
| New Game | All cards converge back to deck pile with a stagger tween before resetting |
| Phase advance | Phase bar DOM element handled by Framer Motion (see below) |

Use `useGSAP()` (from `@gsap/react`) instead of `useEffect` for animation registration — it handles cleanup automatically and is the recommended pattern for React 19.

---

### 5c. DOM Overlay Animations: `framer-motion`

Already in the project. Handles everything **above** the canvas layer:

- Phase bar highlight sliding between phases (`layout` prop for smooth tab indicator)
- Modal open/close transitions (card zoom, browse, settings)
- Toast notifications ("Lost Soul routed", "Hand is full")
- Toolbar button hover/press states
- Zone count badge pop when a card enters or leaves a zone (`AnimatePresence` + scale spring)
- Settings panel slide-in from the right

Framer Motion stays entirely in the DOM — no conflict with GSAP or Konva.

---

### 5d. Sound Effects: `use-sound` (wraps `howler.js`)

Sound design is what separates a game from a UI. Every significant interaction gets a sound.

```tsx
// 'use client'
import useSound from 'use-sound';

const [play] = useSound('/sounds/game-sounds.mp3', {
  sprite: {
    // NOTE: timestamps below are illustrative placeholders.
    // Real values must be measured once the sprite file is assembled in an audio editor.
    draw:       [0,   300],
    place:      [400, 220],
    shuffle:    [700, 850],
    soulRoute:  [1600, 400],
    soulRescue: [2100, 800],
    battleStart:[3000, 600],
    phaseClick: [3700, 150],
    newGame:    [3900, 900],
    counter:    [4900, 120],
    undo:       [5100, 200],
  },
});

// On draw: play({ id: 'draw' });
```

All sounds live in a single sprite file to minimize HTTP requests. A global mute toggle (speaker icon in the toolbar) silences everything.

**Sound design direction — ancient and sacred, not modern:**
Every sound should feel like it belongs in a cave, a scroll chamber, or a desert — papyrus rustling, stone surfaces, resonant wood, hollow pottery, and moments of holy stillness broken by something divine. No plastic card snaps, no digital SFX.

**Planned sounds:**

| Sound | Trigger | Character |
|-------|---------|-----------|
| `draw` | Card drawn from deck | Dry papyrus unfurling — a soft, airy rustle |
| `place` | Card dropped onto a stone zone | Soft stone surface landing — a quiet, slightly hollow thud |
| `shuffle` | Deck shuffled | Papyrus leaves shuffling together — papery, layered |
| `soulRoute` | Lost Soul auto-routed to Land of Bondage | A low resonant tone — like a clay bowl being tapped, somber |
| `soulRescue` | Card moved to Land of Redemption | A brief sacred choir chord — pure, ascending, resolving |
| `battleStart` | Player enters Battle phase | A shofar (ram's horn) blast — short, ancient, commanding |
| `phaseClick` | Phase bar advanced | A dry wood knock or stone tap — deliberate, grounded |
| `newGame` | New Game reset | Deep stone grind fading into silence — the table is cleared |
| `counter` | Counter added or removed | A small clay bead placed on stone — quiet, tactile |
| `undo` | Undo triggered | A papyrus rustle in reverse — brief, slightly disorienting |

---

### 5e. Celebration Effects: Ancient Light Burst

When a soul is rescued, the moment should feel sacred — not like modern confetti. Use `canvas-confetti` configured to emit only warm golds and creams, shaped like small circles with slow upward drift, mimicking motes of light rising from an ancient manuscript. It should read as **radiant dust ascending**, not a birthday party.

```tsx
import confetti from 'canvas-confetti';

function onSoulRescued() {
  confetti({
    particleCount: 60,
    spread: 45,
    origin: { y: 0.65 },
    colors: ['#f5e4b8', '#d4a867', '#fffbe6', '#c9a84c'], // parchment, sand, cream, aged gold
    shapes: ['circle'],
    scalar: 0.7,       // smaller particles — dust, not streamers
    gravity: 0.25,     // float upward slowly
    drift: 0.05,
    ticks: 350,        // linger longer — dust hangs in the air
  });
}
```

**Card placed dust puff** — a smaller micro-burst on every card drop, using the same palette at very low particle count (~8 particles, spread 20) to suggest disturbing centuries-old dust. This fires on every `onDragEnd` that results in a zone change, not just rescues.

```tsx
function onCardPlaced(originX: number, originY: number) {
  confetti({
    particleCount: 8,
    spread: 20,
    origin: { x: originX / window.innerWidth, y: originY / window.innerHeight },
    colors: ['#d4a867', '#c4955a', '#e8d5a3'],
    shapes: ['circle'],
    scalar: 0.5,
    gravity: 0.6,
    ticks: 120,
  });
}
```

`canvas-confetti` renders its own fixed `<canvas>` overlay — no conflict with Konva. 14 KB gzipped.

---

### 5f. Ambient Dust Particles (Konva background layer)

The board always has **slowly drifting dust motes** — subtle, not distracting. These are implemented directly in Konva on a dedicated bottom layer (below all cards), so no additional library is needed.

```ts
// ~20 dust motes created at game start on a backgroundLayer
function createDustMotes(backgroundLayer: Konva.Layer, stageWidth: number, stageHeight: number) {
  for (let i = 0; i < 20; i++) {
    const mote = new Konva.Circle({
      x: Math.random() * stageWidth,
      y: Math.random() * stageHeight,
      radius: Math.random() * 1.5 + 0.5,   // 0.5–2px
      fill: '#d4a867',
      opacity: Math.random() * 0.18 + 0.04, // 4–22% — barely visible
    });
    backgroundLayer.add(mote);
    animateDustMote(mote, stageWidth, stageHeight, backgroundLayer);
  }
}

function animateDustMote(mote: Konva.Circle, w: number, h: number, layer: Konva.Layer) {
  gsap.to(mote, {
    x: mote.x() + (Math.random() - 0.5) * 120,
    y: mote.y() - Math.random() * 60 - 10, // drift upward with slight horizontal wander
    opacity: Math.random() * 0.15 + 0.03,
    duration: Math.random() * 8 + 6,        // 6–14 seconds per drift
    ease: 'sine.inOut',
    onUpdate: () => layer.batchDraw(),
    onComplete: () => {
      // Wrap: if drifted off top, reset to bottom
      if (mote.y() < 0) mote.y(h + 10);
      animateDustMote(mote, w, h, layer); // loop
    },
  });
}
```

This gives the board a living, breathing quality — like being in a cave or archive where old dust moves with the air. Performance impact is negligible (20 tiny circles, all GSAP-driven via `batchDraw`).

---

### 5g. Card Hover Glow (Konva `Filters`)

On hover, cards receive a warm parchment glow rather than a cold white shine — as if candlelight is falling on them:

```ts
cardNode.on('mouseenter', () => {
  cardNode.filters([Konva.Filters.Brighten]);
  cardNode.brightness(0.12);
  cardNode.shadowColor('#d4a867');   // warm amber — candlelight, not spotlight
  cardNode.shadowBlur(14);
  cardNode.shadowOpacity(0.5);
  layer.batchDraw();
});
cardNode.on('mouseleave', () => {
  cardNode.filters([]);
  cardNode.shadowOpacity(0);
  layer.batchDraw();
});
```

Valid drop zones glow with a `Konva.Rect` overlay using a warm amber fill (`#d4a867`, opacity ~0.15) rather than green — it reads as a torch illuminating the zone, not a modern drag-and-drop highlight.

---

### 5h. Board Environment & Aesthetics

**The world**: You are in a torchlit cave — perhaps Qumran, where the Dead Sea Scrolls were found. The cards are ancient scrolls laid out on a rough stone surface. The air is old. Dust moves slowly in the light.

---

**Color palette:**

| Role | Color | Hex |
|------|-------|-----|
| Background (deep cave) | Near-black warm brown | `#0d0905` |
| Stone surface | Rough dark stone | `#1e1610` |
| Zone fills | Aged stone ledge | `#2a1f12` |
| Zone borders | Worn ochre/sand | `#8b6532` |
| Zone border (active) | Warm amber torch glow | `#c4955a` |
| Dust particles | Sandy gold | `#d4a867` |
| UI accent | Aged parchment | `#e8d5a3` |
| UI text | Faded ink | `#c9b99a` |
| Highlight/selected | Candlelight gold | `#f0c060` |

---

**Background:**
- Background image asset: `/public/gameplay/cave_background.png` (1536×1024, 3:2 aspect ratio). See Section 14 for full responsive rendering strategy.
- `background-color: #0d0905` is always set as a CSS fallback for the instant the image hasn't painted yet
- A soft radial gradient overlay centered slightly above-middle to suggest a torch or shaft of light from above: `radial-gradient(ellipse 60% 50% at 50% 30%, rgba(180,120,40,0.06) 0%, transparent 70%)`
- Strong vignette at all four edges to focus the eye toward the center board: `radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.75) 100%)`

---

**Zone delineation (Konva):**
- Each zone is a `Konva.Rect` with:
  - `fill: '#1e1610'` (slightly lighter than background — carved into the stone)
  - `stroke: '#6b4e27'`, `strokeWidth: 1`, `cornerRadius: 3` — worn stone edge
  - `opacity: 0.7`
- Zone labels in a small serif font (Cinzel, loaded via Google Fonts) — all-caps, `#8b6532`, very low opacity so they read as carved lettering, not bright UI labels
- No glowing neon zone borders — the zones feel sunken and ancient

---

**Card design on canvas:**
- Drop shadow using dark warm shadow: `shadowBlur: 10, shadowOpacity: 0.7, shadowColor: '#000'`
- Slight warm shadow offset (2px down-right) so cards look like they're resting on an uneven stone surface
- Face-down cards show the card back — treated like the back of a papyrus scroll
- Counter badges: `Konva.Circle` in deep red (`#8b1a1a`), white `Konva.Text` — like a wax seal

---

**Typography & HUD:**
- **Font**: Load [Cinzel](https://fonts.google.com/specimen/Cinzel) (Google Fonts) for all HUD text — Roman capitals with ancient weight. Falls back to Georgia serif.
- **Phase bar**: Styled like a worn parchment scroll strip at the top — `background: #2a1f12`, `border-bottom: 1px solid #6b4e27`, text in Cinzel `#c9b99a`. The active phase has a warm amber underline glow (framer-motion `layoutId` animated indicator), not a colored pill. The **turn counter** is integrated on the left side of the phase bar ("Turn N") rather than as a separate floating HUD element.
- **Zone count badges**: All sidebar zones (Deck, Reserve, Discard, Banish, Land of Redemption) display a small circular count badge showing the number of cards in that zone. Souls rescued is simply the Land of Redemption badge count — no separate "Souls Rescued" counter.
- **Toolbar**: Floating bar at the bottom-center — `background: rgba(30,22,16,0.92)`, `border: 1px solid #6b4e27`, `border-radius: 8px`. Feels like a carved stone tablet edge, not a glass pill. Icon buttons use warm `#c9b99a` color. Contains: Draw (D), Shuffle (S), Undo (⌘Z), New Game (N), Spread Hand (H).
- **Toasts / callouts**: Dark parchment background (`#2a1f12`), aged ink text, a faint scroll-curl border-radius — no rounded pill modern look

---

### 5i. Context Menu for Card Actions

Use **`@radix-ui/react-context-menu`** — already available via shadcn/ui. Right-click (or long-press mobile) any card. The context menu is a DOM overlay and does not interfere with the canvas.

---

## 6. Card Interaction Model

### 6a. Drag and Drop

- Drag any card from any zone to any valid zone
- Visual feedback: card lifts, source zone dims, valid drop targets highlight
- Snap-to-zone on drop (not free-form in MVP)
- **Hit-testing uses the card's center point** (not top-left corner) for determining which zone a dropped card lands in — this feels much more intuitive
- **Zone hit-test priority ordering**: Sidebar zones (deck, reserve, discard, banish, land-of-redemption) are checked before larger main-area zones (territory, field of battle, land of bondage). This prevents large zones from "swallowing" drops intended for nearby smaller zones.
- **Meek card dragging**: Uses an inner/outer Konva Group pattern — the outer Group handles drag positioning with no offsets, while an inner Group handles the 180° visual rotation. This prevents positional drift during drag.
- Shift+drag to move multiple selected cards at once (Phase 2)

### 6b. Right-Click / Long-Press Context Menu

Every card should have a context menu with actions appropriate to its current zone:

**Universal actions** (always available):
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

### 6e. Double-Click to Meekify

Double-clicking any card toggles its meek/unmeek state (180° rotation). This is a quick shortcut for the most common card state change, avoiding the need to right-click and navigate a context menu.

- Works on cards in any zone (hand, territory, field of battle, etc.)
- If the card is not meek, it becomes meek; if already meek, it unmeeks
- The card stays in place visually — uses an inner/outer Group pattern in Konva where the outer Group handles drag positioning and the inner Group handles the 180° visual rotation, so there's no positional drift

### 6f. Card Zoom

- Click any face-up card to open a full-size zoom modal
- Modal shows card image + card text panel (name, type, brigade, str/tough, ability)
- Keyboard: Escape to close

### 6g. Hand Display & Interaction

The hand is the zone players interact with most — it must always be easy to see and act on every card, even at maximum hand size.

**Layout:**
- Cards are displayed in a loose **fan arc** along the bottom of the screen, centered horizontally
- Each card is barely overlapping its neighbors; the visible portion is enough to show most of the card art and name. Prioritize readability vs compactness here.
- As hand size grows toward 16, cards compress (tighter overlap) but never become unreadable — a hard minimum of ~30% of the card width stays visible per card
- The hand area is tall enough that a hovered card can lift fully into view without leaving the screen

**Hover to spotlight:**
- Hovering any card in the hand **lifts it up** (GSAP: y-translate up ~40px, scale 1.08, z-order raised) so it is fully uncovered — no neighboring card overlaps it
- Adjacent cards subtly slide apart (GSAP stagger) to open space for the hovered card
- The card's **name appears as a text label below it** while hovered — useful when art alone isn't enough to identify a card at a glance
- On mouse-leave, the card and neighbors animate back to resting fan positions

**Interaction:**
- **Left-click**: open the Card Zoom modal for a full-size read
- **Right-click**: context menu with all move actions (play to territory, send to discard, etc.)
- **Drag**: drag a card from hand directly to any zone on the board — the fan reflows smoothly as the card is removed

**Spread Hand button:**
- A small **"Spread"** button (or `H` keyboard shortcut) temporarily fans the entire hand into a flat horizontal row at the bottom, fully showing every card side-by-side with no overlap
- Useful when you need to survey everything at once and pick a line of play
- Clicking any card or pressing `H` again returns to the normal fan
- While spread, cards can still be clicked (zoom) or right-clicked (context menu) but drag-from-hand is disabled to keep the layout stable

**Empty hand:**
- When hand is empty, the hand zone shows a faint placeholder text: "Hand is empty"

### 6h. Hover Card Preview

Any face-up card anywhere on the board (hand, territory, field of battle, sideboard zones) shows a large preview image when the mouse lingers over it. This is distinct from the Card Zoom modal (Section 6e) — it requires no click and dismisses automatically. It exists purely so the player can read a card without interrupting their flow.

**Trigger:**
- Mouse must rest on the card for **700ms** before the preview appears — long enough not to flash while the player scans the board, but still responsive when deliberately lingering
- Implemented with a `setTimeout` cleared on `mouseleave`; if a drag starts, clear the timer and suppress the preview for that interaction
- No preview on face-down cards

**Rendering:**
- The preview is a **DOM overlay** `<div>` absolutely positioned above the Konva canvas — not drawn on the canvas itself. This keeps it crisp at any resolution and outside the canvas hit-detection system.
- Displays the card's full image at **~280px wide** (roughly 3× the in-game card size) — large enough to read brigade, strength/toughness, and ability text
- If the card is **meek** (rotated 180°), the preview image is also rendered rotated 180° — the preview always matches the card's current orientation
- Fade in over **120ms** (Framer Motion `AnimatePresence`, opacity 0→1) — snappy, not sluggish
- Dismisses **immediately** (no delay) on `mouseleave`, with a 80ms fade-out so it doesn't feel jarring

**Positioning logic:**
- Default position: **above and slightly to the right** of the cursor
- If the preview would overflow the **right edge**: shift it left so it stays within the viewport
- If the preview would overflow the **top edge** (e.g. card is near the top of the board): flip it to appear **below** the card instead
- In the **hand fan**: always appears above the fan regardless of other rules, so it doesn't overlap the board
- A 12px gap between the card edge and the preview so it doesn't feel glued to the cursor

**Implementation sketch:**

```tsx
// DOM overlay component — rendered in a portal above the canvas
function CardHoverPreview({ card, anchorRect }: { card: GameCard; anchorRect: DOMRect }) {
  const previewWidth = 280;
  const previewHeight = previewWidth * 1.4; // standard card aspect ratio

  const left = Math.min(anchorRect.right + 12, window.innerWidth - previewWidth - 8);
  const top = anchorRect.top - previewHeight - 12 < 0
    ? anchorRect.bottom + 12           // flip below if near top edge
    : anchorRect.top - previewHeight - 12;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{ position: 'fixed', left, top, width: previewWidth, zIndex: 1000,
               pointerEvents: 'none', borderRadius: 6,
               boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 12px rgba(212,168,103,0.3)' }}
    >
      <img src={getCardImageUrl(card)} width={previewWidth} style={{ display: 'block', borderRadius: 6, transform: card.isMeek ? 'rotate(180deg)' : undefined }} />
    </motion.div>
  );
}
```

- `pointerEvents: 'none'` ensures the preview never accidentally intercepts mouse events
- The golden box-shadow ties it into the cave/torchlight aesthetic — the card appears to glow warmly as if held up to the light
- Konva fires `mouseenter`/`mouseleave` events on canvas nodes; convert the Konva stage coordinates to DOM `DOMRect` using `stage.container().getBoundingClientRect()` and the node's `x`/`y` + `scale`

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

> **Note**: The "Add Opponent Lost Soul" button was removed from the toolbar after user feedback. Players can simulate opponent souls by dragging any card to the Land of Bondage zone via the context menu or drag-and-drop. This keeps the toolbar clean and avoids cluttering the UI with a rarely-used action.

### 10a. Simulate Opponent's Attack

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

## 12. Drawing Cards & Searching Zones UX

This section covers the **mechanics** of drawing and searching. For animation details see Section 5b (GSAP canvas animations). For hand display and hover behavior see Sections 6f and 6g.

### Drawing — Mechanics

- **Click deck pile** → draw 1 card to hand
- **Phase bar "Draw" button** → draw 3 cards in sequence
- **Lost Soul auto-routing**: a drawn Lost Soul is sent to Land of Bondage and a replacement card is drawn automatically; a brief toast confirms the reroute ("Lost Soul routed — drawing replacement")
- **Hand limit: 16 cards.** Drawing is blocked once 16 non-Lost-Soul cards are in hand — brief toast "Hand is full". Exception: a Lost Soul drawn as the 16th card still routes to Land of Bondage and still fires the replacement draw, because it never occupied a hand slot.
- **Empty deck**: silent no-op — nothing happens.

### Searching Deck

A fixed-height modal (80vh) anchored to the top of the viewport with a scrollable grid of all cards currently in the deck, showing thumbnails and names:
- Search/filter by name or card type — the modal maintains its position and size regardless of how many results are returned (prevents jarring layout shifts). An X button appears in the search input to quickly clear the search.
- Light backdrop dimming (`rgba(0,0,0,0.35)`) so the board remains visible during search
- Each card has two rows of action buttons:
  - **Row 1 — Zone targets**: Hand, Territory, Discard, Banish, Reserve
  - **Row 2 — Deck positioning**: Top of Deck, Bottom of Deck
- Deck is automatically shuffled after closing (with a toggle checkbox to skip the shuffle)

### Browsing Discard / Reserve / Banish Zone

Same browse modal — all cards shown face-up in a grid. No shuffle triggered on close.

---

## 13. Mobile Considerations

The full goldfish board is complex for small screens. Options:

- **Mobile:** Show a simplified view — hand at bottom, zone list on side as icon buttons that open modals for each zone. Drag-and-drop replaced by tap-to-select → tap-target-zone.
- **Tablet/iPad:** Full board layout may work in landscape mode.
- **Desktop:** Full drag-and-drop board is the primary target.

Flag the feature as "best experienced on desktop" for MVP.

---

## 14. Technical Architecture

### Routing

- `app/goldfish/page.tsx` — blank entry page (paste-in / pick a deck)
- `app/goldfish/[deckId]/page.tsx` — loads deck data server-side by deckId, passes to client component
- `app/goldfish/[deckId]/GoldfishBoard.tsx` — pure client component, no server calls during play
- Query param `?import=[base64]` handled in `app/goldfish/page.tsx` for paste-in decks

### State Management

- `useReducer` + `useContext` for the game state (no external state lib needed)
- Local session state only — no Supabase writes during play
- Optional: `localStorage` autosave every N seconds (restore if tab is accidentally closed)

### Card Images & Preloading

All card images are preloaded before the board becomes interactive. This prevents any flickering, blank card backs, or pop-in during the first few draws — especially important given the hover preview feature (Section 6h) where images must appear instantly on linger.

**What gets preloaded:**
- Every card image in the deck (all cards, before any are drawn)
- Every card image in the Reserve
- The card back image (used for all face-down cards)
- The Paragon image (if format = Paragon)

**How it works:**

```ts
// useImagePreloader.ts
export function useImagePreloader(urls: string[]): {
  imageMap: Map<string, HTMLImageElement>;
  isReady: boolean;
  progress: number; // 0–1
} {
  const [imageMap] = useState(() => new Map<string, HTMLImageElement>());
  const [loaded, setLoaded] = useState(0);
  const total = urls.length;

  useEffect(() => {
    let mounted = true;
    urls.forEach((url) => {
      if (imageMap.has(url)) { setLoaded((n) => n + 1); return; } // already cached
      const img = new Image();
      img.onload = () => {
        imageMap.set(url, img);
        if (mounted) setLoaded((n) => n + 1);
      };
      img.onerror = () => {
        // On error, still mark as done — Konva will show nothing for that card rather than blocking
        if (mounted) setLoaded((n) => n + 1);
      };
      img.src = url;
    });
    return () => { mounted = false; };
  }, [urls]);

  return { imageMap, isReady: loaded >= total, progress: total > 0 ? loaded / total : 1 };
}
```

- The `imageMap` is a stable `useState`-initialized `Map` passed directly into Konva `<KonvaImage image={imageMap.get(url)} />` — no URL lookups at render time
- Duplicate URLs (same card in multiple copies) are deduplicated naturally by the `Map`
- Same URL pipeline as the deck builder: Vercel Blob first, GitHub image URL fallback

**Loading screen:**

While `isReady` is false, the board renders a full-viewport loading state instead of the game canvas:

```
┌────────────────────────────────────────────┐
│                                            │
│         [cave background image]            │
│                                            │
│          ✦  Unfurling the Scrolls…        │
│                                            │
│    ████████████████░░░░░░░  68%            │
│                                            │
└────────────────────────────────────────────┘
```

- Text in Cinzel font, `#c9b99a`, centered
- Progress bar: `#8b6532` fill on `#2a1f12` track — flat, aged-stone look, no rounded pill
- Dust motes animate during loading too — the world feels alive even before the board appears
- Typical load time is under 1 second on a normal connection; the screen is rarely seen but graceful when it is

### Background Image — Responsive Rendering

The cave background (`/public/gameplay/cave_background.png`, 1536×1024, 3:2 aspect ratio) is displayed behind the Konva canvas. The strategy is CSS `cover` with a floor-biased vertical position — the stone floor (game surface) is always preserved; only the cave ceiling and entrance can be cropped.

**How the image behaves at different screen aspect ratios:**

| Viewport ratio | Example | Behavior with `cover` | Verdict |
|----------------|---------|----------------------|---------|
| 16:10 | 1440×900, MacBook 13" | ~2% top/bottom crop | Near-perfect fit — minimal loss |
| 16:9 | 1920×1080, most monitors | ~18% top/bottom crop | Good — floor-bias keeps game surface intact |
| 4:3 | older laptops | ~12% left/right crop | Fine — center content stays visible |
| 21:9 ultrawide | 2560×1080 | ~37% top/bottom crop | Significant — aggressive floor-bias critical |
| Portrait | tablets upright | Very heavy crop | Not the target; desktop-first (Section 13) |

**Implementation:**

The background is a CSS `background-image` `<div>` positioned behind the Konva `<Stage>`. Using CSS (not Next.js `<Image>`) avoids hydration priority issues and keeps the layer model clean:

```tsx
<div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#0d0905' }}>

  {/* 1. Background image */}
  <div style={{
    position: 'absolute', inset: 0,
    backgroundImage: 'url(/gameplay/cave_background.png)',
    backgroundSize: 'cover',
    backgroundPosition: 'center 70%', // bias toward floor — cave ceiling can be cropped
    backgroundRepeat: 'no-repeat',
  }} />

  {/* 2. Torch glow + vignette overlays (see Section 5h) */}
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: `
      radial-gradient(ellipse 60% 50% at 50% 30%, rgba(180,120,40,0.06) 0%, transparent 70%),
      radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.75) 100%)
    `,
  }} />

  {/* 3. Konva canvas — stage has no fill, background shows through */}
  <GoldfishCanvas width={windowWidth} height={windowHeight} />

  {/* 4. DOM overlays: phase bar, toolbar, modals, hover preview */}
  ...
</div>
```

**Floor-bias rationale:** `backgroundPosition: 'center 70%'` places the vertical focal point 70% down from the image top (the stone floor). On 16:9 screens this keeps the game surface intact while cropping the less-critical upper cave area. For 21:9 ultrawide where ~37% is cropped, shift even further down via a CSS media query:

```css
/* globals.css or Tailwind @layer */
@media (min-aspect-ratio: 2/1) {
  .cave-bg { background-position: center 82%; }
}
```

**Window resize — Konva stage dimensions:**

The Konva `<Stage>` must match the viewport on every resize. Store dimensions in state and re-render the stage when they change:

```tsx
const [dimensions, setDimensions] = useState({
  width: typeof window !== 'undefined' ? window.innerWidth : 1280,
  height: typeof window !== 'undefined' ? window.innerHeight : 800,
});

useEffect(() => {
  const onResize = () =>
    setDimensions({ width: window.innerWidth, height: window.innerHeight });
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, []);

// <Stage width={dimensions.width} height={dimensions.height} />
```

Zone layout positions are stored as **proportional multipliers** of `stageWidth` / `stageHeight` (e.g., `heroZoneX = 0.06 * stageWidth`) rather than fixed pixel values, so the board reflows cleanly when the window is resized or opened on a different screen size.

**Resolution note:** 1536×1024 is adequate for 1080p monitors (upscaled ~25%). On 4K displays the image may look slightly soft. If you regenerate, target **3072×2048** (2× current size) for crisp 4K rendering — same composition and filename, just higher resolution.

### Libraries to Add

| Library | Size (gzip) | Purpose |
|---------|-------------|---------|
| `react-konva` | ~300 KB | Canvas-based game board — card sprites, zones, drag-and-drop |
| `konva` | (included above) | Peer dependency of react-konva |
| `gsap` | ~23 KB | Canvas animation engine — card draw arcs, flips, zone-to-zone travel, meek rotation |
| `@gsap/react` | ~1 KB | `useGSAP()` hook for React 19-safe animation registration and cleanup |
| `use-sound` | ~1 KB | React hook for triggering audio sprites (wraps Howler.js lazily) |
| `howler` | ~10 KB (lazy) | Web Audio engine loaded lazily by use-sound; handles sprite maps |
| `canvas-confetti` | ~14 KB | Confetti burst for soul-rescued and other celebration moments |
| `@number-flow/react` | ~8 KB | Animated number transitions for the Souls Rescued counter |
| `@radix-ui/react-context-menu` | (in project) | Right-click card menus — already available via shadcn/ui |
| Cinzel (Google Font) | 0 KB JS | Ancient Roman serif for all HUD text; loaded via `next/font/google` |

**Total new bundle impact:** ~57 KB gzipped (excluding react-konva/konva which are game-board specific).
All canvas libraries are loaded within `dynamic(() => import(...), { ssr: false })` — zero impact on server-rendered pages.

**next.config.ts change required:**
```ts
webpack: (config) => {
  config.externals = [...(config.externals || []), { canvas: 'canvas' }];
  return config;
}
```

---

## 15. Scope: MVP vs. Future

### MVP (Goldfish v1)

**Core mechanics:**
- [ ] Full board layout with all zones — cave/Qumran torchlight environment
- [ ] Load a saved deck and shuffle (with shuffle animation + sound)
- [ ] Auto-separate Reserve; auto-route Lost Souls on draw
- [ ] Canvas game board with drag-and-drop between all zones (`react-konva`)
- [ ] Right-click context menu with all move actions
- [ ] Zone click actions (draw, browse discard, search deck)
- [ ] Make Meek/Unmeek (animated 180° rotation), add/remove counters
- [ ] Phase bar (cosmetic) + turn counter
- [ ] Undo (20-action history)
- [ ] New Game button (toolbar, resets everything)
- [ ] Paragon zone (art thumbnail + click/hover for full card, Paragon format only)
- [ ] Opponent simulation: Simulate Attack with battle style presets
- [ ] "Always start with [card]" option
- [ ] Card zoom modal (click to open full-size)
- [ ] Hover card preview: 700ms linger → large preview image in DOM overlay (meek cards show rotated), smart viewport-edge repositioning, dismisses instantly on mouse-leave (Section 6h)
- [ ] Double-click to meekify/unmeekify any card (Section 6e)
- [ ] Image preloader: all deck + reserve images loaded before board is interactive; cave-aesthetic loading screen with progress bar (Section 14)
- [ ] Desktop-optimized layout

**Immersion & polish (part of MVP — not deferred):**
- [ ] GSAP card animations: draw arc, zone-to-zone travel with lift, card flip, meek rotation
- [ ] Card hover: warm amber glow (candlelight, not spotlight) via Konva Filters.Brighten + shadow
- [ ] Valid drop zone warm amber highlight overlay (ancient torch-on-stone feel)
- [ ] Ambient dust motes: 20 slow-drifting Konva circles on background layer, animated via GSAP
- [ ] Card-placed dust puff: small canvas-confetti micro-burst (8 particles, sand colors) on every zone drop
- [ ] Soul rescued: rising light motes via canvas-confetti (gold/cream, small circular, slow upward drift)
- [ ] Sound effects: papyrus draw, stone-landing place, papyrus shuffle, shofar battle-start, choir soul-rescue, clay-bead counter, stone-grind new-game
- [ ] Global mute toggle (speaker icon in toolbar)
- [ ] Zone count badges on all sidebar zones (unified circular style, always visible)
- [ ] Turn counter integrated into phase bar (left side)
- [ ] Stone tablet-style toolbar at bottom-center: Draw, Shuffle, Undo, New Game, Spread Hand
- [ ] Cave/torchlight board: near-black warm background + radial torch glow + strong vignette
- [ ] Zone delineation: sunken stone ledge style (dark fill, worn ochre stroke, Cinzel labels)
- [ ] Cinzel serif font loaded for all HUD text (Google Fonts)
- [ ] Zone count badges animate on change (Framer Motion scale spring)

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

## 16. Resolved Questions

- **Card back asset**: User is providing a card-back image for face-down cards. ✅
- **Empty deck behavior**: Silent no-op — nothing happens when drawing from an empty deck. ✅
- **Hand display**: Fan arc at the bottom; hover lifts and spotlights any card (neighbors slide apart); card name label appears on hover; "Spread" button / `H` key toggles a flat fully-visible layout. Full spec in Section 6f. ✅
- **Zone card count indicators**: All sidebar zones (Deck, Reserve, Discard, Banish, Land of Redemption) show a unified circular count badge (always visible, including 0). ✅
- **Route location**: Top-level `/goldfish/[deckId]` and `/goldfish`. Cleaner for sharing, easier for guests, and avoids nesting the game board under `/decklist/`. ✅
- **Animation fidelity**: Full GSAP animations in MVP — card draw arcs, zone-to-zone travel, flip, meek rotation, shuffle jitter. Not deferred. Sound effects and dust effects also in MVP. See Section 5. ✅
- **Paragon format setup**: Paragon zone auto-placed in Territory on game start when format = Paragon. Displays cropped card art; click or hover shows full card. Paragon images already exist at `/public/paragons/`. ✅
- **Keyboard shortcuts**: `D` draw a card, `Enter` advance phase / end turn, `N` new game, `S` shuffle deck, `H` spread/collapse hand, `Ctrl+Z` undo, **double-click** to meekify/unmeekify. ✅
- **New hand vs. New Game**: Single **New Game** button resets everything. No separate "new hand" utility. ✅
- **Add Opponent Lost Soul button**: Removed from toolbar — too niche for prime toolbar space. Players can simulate opponent souls by dragging cards to Land of Bondage via context menu or drag-and-drop. ✅
- **Canvas performance**: Not a concern for this project's expected deck sizes. ✅
- **Opponent simulation**: "Add Opponent Lost Soul" button removed; "Simulate Attack" retained. See Section 10. ✅
- **Board aesthetic**: Cave/Qumran torchlight environment — generated cave floor image as background, ambient dust motes, warm amber palette, Cinzel font. No green felt. ✅
- **Image preloading**: All deck and reserve images preloaded before board is interactive. Cave-aesthetic loading screen shown during load. See Section 14. ✅
- **Hover card preview**: 700ms linger on any face-up card shows a 280px DOM overlay preview (meek cards show rotated preview). Suppressed during drags. Smart viewport-edge repositioning. See Section 6h. ✅
- **GoldfishButton paste-in flow**: `deckId` is optional — omitted when launching from the paste-in entry point at `/goldfish`. ✅

---

## 17. Reference

- Deck data format: see `prompt_context/deckbuilder_overview.md` and `card_search.md`
- Existing deck state management: `app/decklist/card-search/hooks/useDeckState.ts`

## TODOS:

- add animations
- add sounds
- add music
- add options to disable sounds/music, etc.
- unify the play buttons