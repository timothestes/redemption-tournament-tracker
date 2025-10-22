# Deck Builder MVP - Implementation Plan

## Overview
Transform the existing card search page (`app/decklist/card-search/client.tsx`) into a deck builder by adding a deck panel on the right side. This is a **desktop/tablet-only feature** (md breakpoint and above).

**Scope**: MVP focused on core deck building functionality. See `deckbuilder_future_enhancements.md` for post-MVP features.

---

## Current State
- **File**: `app/decklist/card-search/client.tsx` (1110 lines)
- **Data Source**: Fetches `carddata.txt` from GitHub, parses client-side
- **Features**: Multi-query search, advanced filtering, URL sync, card modal, dark mode

---

## MVP Goals

### 1. Layout Restructuring
- [ ] Wrap existing content in responsive flex container
- [ ] Implement responsive breakpoints:
  - **Mobile**: Full width (deck panel hidden)
  - **md (768px+)**: 50/50 split
  - **xl (1280px+)**: 61.8/38.2 split (golden ratio)

### 2. Deck State Management  
- [ ] Create type definitions (`types/deck.ts`)
- [ ] Create custom hook (`hooks/useDeckState.ts`)
- [ ] Implement add/remove card functions
- [ ] LocalStorage persistence

### 3. Deck Builder Panel Component
- [ ] Create `DeckBuilderPanel.tsx` component
- [ ] Display deck name (editable input)
- [ ] Show total card count
- [ ] List deck cards with quantities
- [ ] Add/subtract quantity controls
- [ ] Basic tabs (Cards/Info)

### 4. Card Interaction
- [ ] Click card to add to deck
- [ ] Visual feedback on hover
- [ ] Show "in deck" indicator on cards
- [ ] Quantity validation (max 4 per card)

### 5. Import/Export
- [ ] Export deck to standard text format (copy & download)
- [ ] Import deck from text (parse & validate)
- [ ] Support "Reserve:" section

---

## Standard Deck Format

**Format specification**:
```
[quantity]\t[Card Name] ([Set Code/Description])
...
Reserve:
[quantity]\t[Card Name] ([Set Code/Description])
...
```

**Example**:
```
1	Son of God "Manger" (Promo)
2	Caleb, the Rewarded
1	Lost Soul "Darkness" [Job 30:26] [2019 - 1st Place]
Reserve:
1	Gibeonite Trickery (Roots)
```

---

## File Structure

```
app/decklist/card-search/
├── client.tsx                    # Main orchestrator (refactored)
├── components/
│   ├── FilterGrid.tsx           # (existing)
│   ├── CardImage.tsx            # (existing)
│   ├── ModalWithClose.tsx       # (existing)
│   ├── DeckBuilderPanel.tsx     # NEW - Right sidebar
│   └── DeckCardList.tsx         # NEW - Card list in deck
├── hooks/
│   └── useDeckState.ts          # NEW - Deck state management
└── types/
    └── deck.ts                  # NEW - Type definitions
```

---

## Type Definitions

```typescript
// types/deck.ts
export type DeckCard = {
  card: Card;           // Reference to full card object
  quantity: number;     // 1-4
  isReserve: boolean;   // Main deck vs reserve/sideboard
};

export type Deck = {
  name: string;
  cards: DeckCard[];
  createdAt: Date;
  updatedAt: Date;
};
```

---

## Layout Structure

```tsx
<main className="flex w-full h-full overflow-hidden">
  {/* Left Panel: Card Search */}
  <div className="flex h-full w-full flex-col 
                  md:w-1/2 xl:w-[61.8%] 
                  md:border-r border-gray-600">
    {/* Existing: Search bar, filters, card grid */}
  </div>
  
  {/* Right Panel: Deck Builder (hidden on mobile) */}
  <div className="hidden md:flex w-full 
                  md:w-1/2 xl:w-[38.2%] 
                  overflow-hidden">
    <DeckBuilderPanel 
      deck={deck}
      onAddCard={addCard}
      onRemoveCard={removeCard}
      onUpdateDeckName={setDeckName}
      onExportDeck={exportDeck}
      onImportDeck={importDeck}
    />
  </div>
</main>
```

---

## Implementation Steps

### Step 1: Type Definitions & Deck State Hook
**Files**: `types/deck.ts`, `hooks/useDeckState.ts`

Create type definitions and custom hook for deck management:
- Define `DeckCard` and `Deck` types
- Implement `useDeckState()` hook with:
  - `addCard(card: Card, isReserve?: boolean)`
  - `removeCard(cardName: string, isReserve?: boolean)`
  - `updateQuantity(cardName: string, quantity: number, isReserve?: boolean)`
  - `setDeckName(name: string)`
  - `exportDeck()` - Generate standard text format
  - `importDeck(text: string)` - Parse text format
  - LocalStorage sync

### Step 2: Deck Builder Panel Component
**File**: `components/DeckBuilderPanel.tsx`

Build the right sidebar UI:
- Deck name input (editable)
- Card count badge
- Tabs: "Cards" | "Info"
- Main deck card list
- Reserve deck card list (if any)
- Export/Import buttons
- Menu dropdown (future: save, load, etc.)

### Step 3: Deck Card List Component
**File**: `components/DeckCardList.tsx`

Reusable component for showing cards in deck:
- Card name
- Set info
- Quantity controls (+/-)
- Remove button
- Compact view for many cards

### Step 4: Integrate with Client
**File**: `client.tsx`

Refactor main component:
- Add `useDeckState()` hook
- Wrap content in responsive flex container
- Add `<DeckBuilderPanel />` to right side
- Update card click handlers to add to deck
- Add hover states for "add to deck" feedback
- Show badge on cards already in deck

### Step 5: Import/Export Utilities
**File**: `utils/deckImportExport.ts`

Utilities for parsing/generating deck text:
- `parseDeckText(text: string): Deck` - Handle tab-separated format
- `generateDeckText(deck: Deck): string` - Export to standard format
- Handle edge cases (quotes, brackets, Reserve section)

---

## Success Criteria

MVP is complete when:
- [ ] All existing card search features work unchanged
- [ ] Deck panel appears on desktop/tablet
- [ ] Can click cards to add to deck
- [ ] Can adjust quantities (1-4 max)
- [ ] Can remove cards from deck
- [ ] Can edit deck name
- [ ] Deck persists in localStorage
- [ ] Can export deck to text format (copy & download)
- [ ] Can import deck from text format
- [ ] Reserve section supported
- [ ] Dark mode styling consistent
- [ ] Responsive layout works correctly

---

## Out of Scope for MVP

See `deckbuilder_future_enhancements.md` for:
- Supabase database integration (save to cloud)
- "My Decks" library page
- Mobile support
- Card data migration to Supabase
- Deck statistics/analysis
- Public deck sharing
- Advanced features (ratings, comments, etc.)

**Decision**: Focus on core functionality first, validate with users, then add cloud features.

---

## Next Steps

1. ✅ Planning complete
2. ⏭️ Create type definitions
3. ⏭️ Build `useDeckState` hook
4. ⏭️ Create `DeckBuilderPanel` component
5. ⏭️ Integrate with main layout
6. ⏭️ Add import/export functionality
7. ⏭️ Test & polish
