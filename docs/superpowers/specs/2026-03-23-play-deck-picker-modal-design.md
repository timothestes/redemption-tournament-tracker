# Play Deck Picker Modal — Searchable Visual Deck Selection

**Date:** 2026-03-23
**Status:** Draft
**Scope:** Replace inline deck picker on `/play` with a searchable modal showing visual deck previews

---

## Problem Statement

The current play lobby deck picker is a text-only searchable list. Decks show only name, format badge, and card count — no visual context. Players must know their deck names to find them. Meanwhile, the my-decks and community-decks pages already display rich deck cards with two preview card images. The play lobby should offer the same visual experience.

---

## Design

### Overview

Replace the inline deck picker section in `GameLobby` with:
1. A compact "Select Deck" trigger area showing the selected deck (or a prompt to pick one)
2. A `Dialog` modal that opens with full search + visual grid of deck cards

### Modal Structure

```
┌─────────────────────────────────────────────────────┐
│  Select a Deck                                   ✕  │
├─────────────────────────────────────────────────────┤
│  🔍 Search decks...                                 │
│  [My Decks]  [Community]                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ ┌────┐┌────┐ │  │ ┌────┐┌────┐ │                 │
│  │ │img1││img2│ │  │ │img1││img2│ │                 │
│  │ └────┘└────┘ │  │ └────┘└────┘ │                 │
│  │ Deck Name    │  │ Deck Name    │                 │
│  │ T1 · 50 cards│  │ T2 · 56 cards│                 │
│  └──────────────┘  └──────────────┘                 │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ ┌────┐┌────┐ │  │ ┌────┐┌────┐ │                 │
│  │ │img1││img2│ │  │ │img1││img2│ │                 │
│  │ └────┘└────┘ │  │ └────┘└────┘ │                 │
│  │ Deck Name    │  │ Deck Name    │                 │
│  │ Paragon·50   │  │ T1 · 52 cards│                 │
│  └──────────────┘  └──────────────┘                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Deck Card in Modal

Each deck card in the grid shows:
- **Header**: Two preview card images side-by-side (reuse existing `getCardImageUrl()` pattern from my-decks)
  - If no preview cards set: show a subtle placeholder with deck format icon
  - If Paragon format: show paragon image instead (same logic as my-decks DeckCard)
- **Body**: Deck name (truncated), format badge, card count
- **Community tab extra**: Username ("by username")
- **Hover/focus**: Subtle border highlight
- **Click**: Selects deck, closes modal

Card dimensions: Compact — roughly 180-200px wide in the grid. Preview images are small but recognizable enough to identify a deck at a glance.

### Selected Deck Display (Lobby)

Once selected, the lobby shows a richer summary than the current text-only row:

```
┌───────────────────────────────────────────────┐
│  ┌────┐┌────┐  Deck Name                     │
│  │img1││img2│  Type 1 · 50 cards              │
│  └────┘└────┘                        [Change] │
└───────────────────────────────────────────────┘
```

- Small preview thumbnails (40-48px tall) inline with the deck info
- "Change" button re-opens the modal (the currently selected deck is preserved and highlighted in the grid with a ring/border so the user can see what they have selected)

### Search Behavior

Same logic as current implementation, with adjustments:

- **My Decks tab** (default): Client-side filter by name. Pre-loaded at page level. Show all decks when search is empty (no minimum chars).
- **Community tab**: Server-side search via `searchCommunityDecks()` with 300ms debounce. Requires 2+ characters. Shows loading skeleton cards while searching.
- Search input auto-focuses when modal opens.
- Search clears when switching tabs (handled via `useEffect` on `activeTab` that resets `searchQuery` and `communityResults`).

### Data Changes

The server-side page query needs to also fetch `preview_card_1` and `preview_card_2` for the user's decks. The community search action also needs to return these fields.

**Updated `DeckOption` type:**
```typescript
type DeckOption = {
  id: string;
  name: string;
  format: string | null;
  card_count: number | null;
  username?: string | null;
  preview_card_1?: string | null;
  preview_card_2?: string | null;
  paragon?: string | null;
};
```

### Empty States

- **No decks (my tab)**: "No saved decks yet. Build a deck or try the Community tab."
- **No results (my tab search)**: "No decks matching '{query}'"
- **No results (community search)**: "No community decks found for '{query}'"
- **Type prompt (community, < 2 chars)**: "Type at least 2 characters to search"

### Responsive Behavior

The codebase uses a custom `Dialog` component (`components/ui/dialog.tsx`) and a separate `MobileDrawer` component (`components/ui/mobile-drawer.tsx`) — not shadcn's radix-based Dialog or Sheet. The `MobileDrawer` has framer-motion slide-up animation and drag-to-dismiss.

- **Mobile (< md breakpoint)**: Render `MobileDrawer` (slide-up from bottom, drag-to-dismiss, nearly full screen). Grid: 2 columns.
- **Desktop (>= md breakpoint)**: Render `Dialog` with `DialogContent` using a custom `className="max-w-2xl max-h-[85vh] flex flex-col"` (the built-in `size` prop only goes up to `max-w-lg`, so we override). Grid: 3 columns.

Use a `useMediaQuery` hook (or `window.matchMedia`) to conditionally render `Dialog` vs `MobileDrawer`. Both share the same inner content (search, tabs, grid) via a shared `DeckPickerContent` component.

### Accessibility

- Modal traps focus
- Search input auto-focuses on open
- Deck cards are keyboard navigable via tab (simple tab-through, no arrow-key grid navigation needed)
- Escape closes modal
- Selected deck announced via aria-label

---

## Component Architecture

### New Component: `DeckPickerModal`

**Location:** `app/play/components/DeckPickerModal.tsx`

Responsible for the responsive shell — renders `Dialog` on desktop, `MobileDrawer` on mobile. Delegates inner content to `DeckPickerContent`.

**Props:**
```typescript
interface DeckPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (deck: DeckOption) => void;
  myDecks: DeckOption[];
}
```

### New Component: `DeckPickerContent`

**Location:** inline within `DeckPickerModal.tsx` (not exported separately)

Shared inner content rendered inside both Dialog and MobileDrawer — search input, tabs, and deck grid.

**Internal state:**
- `searchQuery: string`
- `activeTab: 'my' | 'community'`
- `communityResults: DeckOption[]`
- `isSearching: boolean`

### New Component: `DeckPickerCard`

**Location:** `app/play/components/DeckPickerCard.tsx`

A compact visual deck card for the modal grid. Simpler than the full DeckCard in my-decks — no actions, no tags, no price.

**Props:**
```typescript
interface DeckPickerCardProps {
  deck: DeckOption;
  onClick: () => void;
}
```

### Changes to Existing Components

**`GameLobby.tsx`:**
- Remove inline picker UI (search, tabs, results list)
- Add `DeckPickerModal` with open/close state
- Update selected deck display to include preview images
- Update `GameLobbyProps.decks` inline type to include `preview_card_1`, `preview_card_2`, `paragon` (or better: reference `DeckOption` type directly to avoid duplication)
- Keep all game logic (create, join, spectate) unchanged

**`app/play/page.tsx`:**
- Add `preview_card_1`, `preview_card_2`, `paragon` to the deck query SELECT

**`app/play/actions.ts`:**
- Add `preview_card_1`, `preview_card_2`, `paragon` to `searchCommunityDecks` SELECT and return type

---

## Image Handling

**Important:** The codebase has two divergent `getCardImageUrl` implementations:
- **my-decks/client.tsx:** Takes a card name, replaces `/` with `_`, appends `.jpg`
- **community/client.tsx:** Takes a `card_img_file` value, strips `.jpg`/`.jpeg` extension, appends `.jpg`

The `preview_card_1`/`preview_card_2` columns store **card names** (set via `updateDeckPreviewCardsAction`). Therefore the my-decks version (card name → sanitize `/` → `.jpg`) is the correct one for this use case.

Extract into `lib/card-images.ts`:

```typescript
export function getCardImageUrl(cardName: string | null | undefined): string | null {
  if (!cardName) return null;
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) return null;
  const sanitized = cardName.replace(/\//g, '_');
  return `${blobBase}/card-images/${sanitized}.jpg`;
}
```

**Image error handling:** Use an `onError` handler on `<img>` tags to hide the broken image and show a placeholder (muted background with a card icon). This prevents broken image icons in the picker grid.

**Follow-up (out of scope):** Update existing consumers in my-decks/client.tsx and community/client.tsx to import from `lib/card-images.ts` instead of their local copies.

---

## Files Affected

| File | Change |
|---|---|
| `app/play/components/DeckPickerModal.tsx` | **New** — Modal with search, tabs, deck grid |
| `app/play/components/DeckPickerCard.tsx` | **New** — Compact visual deck card for grid |
| `app/play/components/GameLobby.tsx` | Replace inline picker with modal trigger + richer selected deck display |
| `app/play/page.tsx` | Add preview_card_1, preview_card_2, paragon to deck query |
| `app/play/actions.ts` | Add preview fields to searchCommunityDecks return |
| `lib/card-images.ts` | **New** — Extract shared `getCardImageUrl()` utility |
| `hooks/useMediaQuery.ts` | **New** — Simple `useMediaQuery('(min-width: 768px)')` hook for Dialog vs MobileDrawer switching |

---

## Out of Scope

- Deck legality indicators
- Sorting/filtering beyond text search (format filter, tag filter, etc.)
- Editing deck preview cards from the play lobby
- Goldfish mode integration
- Folder navigation within the modal
