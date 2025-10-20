# Deck Builder Refactor Plan

## Overview
Transform the existing card search page into a dual-purpose deck builder interface, inspired by Lorcana's Dreamborn.ink design. The goal is to maintain all current card search functionality while adding a deck building panel on the right side.

**Important**: Since this is an MVP, Deck builder functionality will be **desktop/tablet only** (md breakpoint and above) for initial implementation. Mobile users will continue to have the full card search experience, but deck building features will be hidden on small screens.

### Mobile Support Consideration
**Could we add mobile support with just a toggle button?** 

**Short answer**: Yes, but with UX tradeoffs.

**Technical feasibility**: ✅ Easy
- Add a floating action button (FAB) to toggle deck panel
- Deck panel slides up as a bottom sheet or overlay
- User switches between "search mode" and "deck mode"

**UX challenges**: ⚠️ Moderate
- Small screen = can't see both search and deck simultaneously
- Constant mode switching breaks flow
- Less screen space for card images
- Bottom sheet might obscure content
- Touch targets need to be larger

**Decision**: Start desktop-only, gather feedback, then decide if mobile is needed. Many TCG deck builders (Moxfield, Archidekt, etc.) are also desktop-focused because deck building benefits from screen real estate.

**Future**: If mobile is requested, we can add it later with:
- Toggle button for deck visibility
- Bottom sheet/drawer component
- Optimized touch interactions
- Possibly separate "My Decks" mobile view

## Design Inspiration
Based on Lorcana Dreamborn.ink deck builder:
- Split-view layout with card search on left, deck panel on right
- Responsive breakpoints that adapt to screen size
- Golden ratio layout on larger screens (61.8% search / 38.2% deck)
- Mobile-first with collapsible deck panel

## Current State
- **File**: `app/decklist/card-search/client.tsx` (1110 lines)
- **Features**: 
  - Multi-query search system
  - Advanced filtering (icons, alignment, rarity, testament, etc.)
  - URL state synchronization
  - Card grid with modal view
  - Dark mode support
  - Responsive design

### Current Data Source
- **Data Loading & Parsing**: Fetches a raw, tab-delimited `carddata.txt` file from GitHub. Parses rows into structured `Card` objects with fields like name, type, strength, special ability, legality, etc.
- **Data Source**: Defined in `constants.ts`:
  ```ts
  export const CARD_DATA_URL =
    "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";
  ```
- **Parsing**: Happens client-side in `useEffect` on mount, processes ~2000+ cards

### Should We Move Card Data to Supabase?

**Short Answer**: Yes, eventually. But not required for MVP.

**Benefits of Moving to Supabase Table**:
1. ✅ **Faster queries** - Database indexing vs client-side filtering
2. ✅ **Server-side search** - Offload filtering logic, reduce client bundle
3. ✅ **Advanced queries** - Full-text search, complex joins
4. ✅ **Relational features** - "Decks using this card", card statistics
5. ✅ **Caching** - Browser caches API responses
6. ✅ **Reliability** - No dependency on external GitHub raw file
7. ✅ **Versioning** - Track card data changes, enable rollback

**MVP Strategy**:
- **Phase 1 (MVP)**: Keep current approach (fetch GitHub txt file)
  - Works today, no migration needed
  - Focus on deck builder features first
- **Phase 2 (Optimization)**: Migrate to Supabase
  - Import card data into `cards` table
  - Update queries to use Supabase API
  - Add periodic sync from upstream source

**Proposed Card Table Schema** (for future):
```sql
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  set_code TEXT,
  set_name TEXT,
  img_file TEXT,
  type TEXT,
  brigade TEXT,
  strength TEXT,
  toughness TEXT,
  class TEXT,
  identifier TEXT,
  special_ability TEXT,
  rarity TEXT,
  reference TEXT,
  alignment TEXT,
  legality TEXT,
  testament TEXT,
  is_gospel BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, set_code)
);

-- Indexes for search performance
CREATE INDEX idx_cards_name ON cards USING GIN (name gin_trgm_ops);
CREATE INDEX idx_cards_type ON cards(type);
CREATE INDEX idx_cards_brigade ON cards(brigade);
CREATE INDEX idx_cards_legality ON cards(legality);

-- Enable full-text search
ALTER TABLE cards ADD COLUMN search_vector tsvector;
CREATE INDEX idx_cards_search ON cards USING GIN (search_vector);
```

**Migration Path**:
1. Create table in Supabase
2. Write script to parse carddata.txt and insert into table
3. Create API endpoint for card search (or use Supabase auto-generated)
4. Update client.tsx to fetch from Supabase instead of GitHub
5. Add periodic sync job to keep card data updated

**Decision**: Defer to Phase 2+. For MVP, GitHub file works fine and keeps scope manageable.

## Goals

### Phase 1: Layout Restructuring
- [ ] Wrap existing content in flex container
- [ ] Implement responsive width breakpoints:
  - Mobile: Full width (deck panel HIDDEN - no mobile support initially)
  - md (768px+): 50/50 split - deck builder appears
  - xl (1280px+): 61.8/38.2 split (golden ratio)
- [ ] (Optional/Future) Add toggle FAB button for mobile deck panel visibility
  - Would show deck as bottom sheet/drawer overlay
  - Deferred until we validate desktop experience first

### Phase 2: Deck State Management
- [ ] Create deck state structure:
  ```typescript
  type DeckCard = {
    card: Card;
    quantity: number;
  };
  
  type DeckState = {
    name: string;
    cards: DeckCard[];
  };
  ```
- [ ] Add state management (useState or Context)
- [ ] Implement add/remove card functions
- [ ] Track total card count and deck statistics

### Phase 3: Deck Builder Panel Component
- [ ] Create `DeckBuilderPanel.tsx` component
- [ ] Features to include:
  - Deck name input (editable)
  - Total card count display
  - Card list with quantities
  - Add/subtract quantity controls
  - Cards/Info tabs (similar to Lorcana)
  - Deck statistics (card type breakdown, etc.)
  - Menu dropdown with options

### Phase 4: Interaction Updates
- [ ] Modify card click behavior:
  - Left-click: Add to deck
  - Right-click or modifier key: Open modal (preserve existing behavior)
- [ ] Add visual feedback on hover
- [ ] Show "in deck" indicator on cards already added
- [ ] Update card grid to show deck quantities

### Phase 5: Persistence & Export
**Priority**: Import/export functionality should be implemented early for testing and user convenience.

#### Standard Deck Format
We need to support the **Redemption community's standard deck list format** for import/export. This format is widely used and should be preserved for compatibility with other tools (OCTGN, Lackey, tournament registration, etc.).

**Format specification**:
```
[quantity]	[Card Name] ([Set Code/Description])
[quantity]	[Card Name] ([Set Code/Description])
...
Reserve:
[quantity]	[Card Name] ([Set Code/Description])
...
```

**Example**:
```
1	Son of God "Manger" (Promo)
1	Angel of the Lord (2017 Promo)
2	Caleb, the Rewarded
1	Joshua, the Commander
1	Lost Soul "Darkness" [Job 30:26] [2019 - 1st Place]
1	Goliath (LoC)
Reserve:
1	Gibeonite Trickery (Roots)
1	Not Among You
```

**Key characteristics**:
- Tab-separated (quantity\t card name)
- Set information in parentheses or brackets (flexible parsing)
- "Reserve:" section separator for sideboard/reserve cards
- Quantity first, then full card name with set info
- Special characters in card names (quotes, brackets, commas)

**Important**: Our internal storage format doesn't need to match this exactly, but we MUST be able to:
- ✅ **Import** from this format (parse and validate)
- ✅ **Export** to this format (generate compliant text)

#### Implementation Tasks
- [ ] **Export deck to standard text format**
  - Generate tab-separated format with set info
  - Separate main deck and reserve sections
  - Copy to clipboard button
  - Download as .txt file
- [ ] **Import deck from standard text**
  - Parse tab-separated or space-separated quantities
  - Extract card names and set info
  - Handle "Reserve:" section
  - Validate against card database
  - Show warnings for unrecognized cards
- [ ] Local storage for deck state (MVP)
- [ ] Supabase integration for deck storage
- [ ] URL parameter for deck sharing (shareable link)
- [ ] Save/load multiple decks from database

## Backend: Supabase Database Schema

We'll use **Supabase (PostgreSQL)** to store decks, not blob storage. This enables:
- Queryability (search decks by card, user, format)
- Relational data (join with users, enable comments/ratings)
- Row-level security for public/private decks
- Real-time subscriptions
- Analytics (most popular cards, deck stats)

### Database Tables

```sql
-- Main decks table
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL DEFAULT 'Untitled Deck',
  description TEXT,
  format TEXT, -- e.g., 'Type 1', 'Type 2', 'Classic', etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_public BOOLEAN DEFAULT false,
  view_count INTEGER DEFAULT 0,
  card_count INTEGER DEFAULT 0 -- Denormalized for quick display
);

-- Deck cards junction table (many-to-many)
CREATE TABLE deck_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,  -- Full card name for export matching
  card_set TEXT,            -- Set code/description for export (e.g., "Promo", "LoC")
  card_img_file TEXT,       -- Store for quick display
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 4),
  is_reserve BOOLEAN DEFAULT false,  -- Track reserve/sideboard cards
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deck_id, card_name, card_set) -- Prevent duplicates
);

-- Note: card_name and card_set should match the format used in the standard
-- deck list format to enable seamless import/export.
-- Example: card_name = 'Son of God "Manger"', card_set = 'Promo'

-- Deck folders/organization (for "My Decks" library view)
CREATE TABLE deck_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  parent_folder_id UUID REFERENCES deck_folders(id) ON DELETE CASCADE, -- NULL for root folders
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, parent_folder_id, name) -- Prevent duplicate names in same folder
);

-- Update decks table to support folder organization
ALTER TABLE decks ADD COLUMN folder_id UUID REFERENCES deck_folders(id) ON DELETE SET NULL;

-- Optional: Deck tags/categories (for filtering/search)
CREATE TABLE deck_tags (
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (deck_id, tag)
);

-- Indexes for performance
CREATE INDEX idx_decks_user_id ON decks(user_id);
CREATE INDEX idx_decks_is_public ON decks(is_public);
CREATE INDEX idx_decks_folder_id ON decks(folder_id);
CREATE INDEX idx_deck_cards_deck_id ON deck_cards(deck_id);
CREATE INDEX idx_deck_cards_card_name ON deck_cards(card_name);
CREATE INDEX idx_deck_folders_user_id ON deck_folders(user_id);
CREATE INDEX idx_deck_folders_parent ON deck_folders(parent_folder_id);
```

### Row Level Security (RLS) Policies

```sql
-- Enable RLS
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_cards ENABLE ROW LEVEL SECURITY;

-- Users can view public decks or their own decks
CREATE POLICY "Users can view decks" ON decks
  FOR SELECT
  USING (is_public = true OR auth.uid() = user_id);

-- Users can only create their own decks
CREATE POLICY "Users can create decks" ON decks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own decks
CREATE POLICY "Users can update own decks" ON decks
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can only delete their own decks
CREATE POLICY "Users can delete own decks" ON decks
  FOR DELETE
  USING (auth.uid() = user_id);

-- Deck cards inherit permissions from parent deck
CREATE POLICY "Users can view deck cards" ON deck_cards
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM decks 
      WHERE decks.id = deck_cards.deck_id 
      AND (decks.is_public = true OR decks.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage own deck cards" ON deck_cards
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM decks 
      WHERE decks.id = deck_cards.deck_id 
      AND decks.user_id = auth.uid()
    )
  );

-- Deck folders policies (users can only manage their own folders)
CREATE POLICY "Users can view own folders" ON deck_folders
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own folders" ON deck_folders
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own folders" ON deck_folders
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own folders" ON deck_folders
  FOR DELETE
  USING (auth.uid() = user_id);
```

### Data Flow Strategy

**Phase 1 (MVP)**: Browser localStorage only
- Quick to implement
- No auth required
- Works offline
- Lost if user clears data

**Phase 2**: Supabase sync
- Save button → saves to database
- Load from database on page load
- Keep localStorage as backup/cache

**Phase 3**: Real-time (future)
- Use Supabase realtime subscriptions
- Sync across devices
- Collaborative deck building

## Technical Approach

### File Structure
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

### Key Design Decisions
1. **Backwards Compatibility**: Keep all existing card search functionality
2. **Progressive Enhancement**: Deck builder is an addition, not a replacement
3. **Desktop Only**: No mobile support for deck building (md breakpoint and above only)
4. **Database First**: Use Supabase tables, not blob storage, for queryability
5. **State Management**: Use hooks for now, can migrate to Context if needed
6. **URL Strategy**: Separate URL params for search vs deck state
7. **Auth Optional (MVP)**: Start with localStorage, add user accounts later

## Layout Structure
```html
<main className="flex w-full h-full overflow-hidden">
  <!-- Left Panel: Card Search (existing content) -->
  <div className="flex h-full w-full flex-col 
                  md:w-1/2 xl:w-[61.8%] 
                  md:border-r border-gray-600">
    {/* Existing: Search bar, filters, card grid */}
  </div>
  
  <!-- Right Panel: Deck Builder (NEW) -->
  <div className="hidden md:flex w-full 
                  md:w-1/2 xl:w-[38.2%] 
                  overflow-hidden">
    <DeckBuilderPanel 
      deck={deck}
      onAddCard={addCard}
      onRemoveCard={removeCard}
      onUpdateDeckName={setDeckName}
    />
  </div>
</main>
```

## Implementation Order

### Step 1: Create DeckBuilderPanel Component
Build the right sidebar with basic structure and styling.

### Step 2: Add Deck State Management
Set up state and functions for managing deck cards.

### Step 3: Modify Main Layout
Refactor client.tsx to implement split-view layout.

### Step 4: Add Click Handlers
Connect card clicks to deck actions.

### Step 5: Persistence & Polish
Add save/load functionality and final touches.

## Success Criteria
- [ ] All existing card search features work unchanged
- [ ] Deck panel displays on tablet and desktop (hidden on mobile)
- [ ] Can add/remove cards from deck
- [ ] Deck persists in local storage (MVP)
- [ ] Can save deck to Supabase database
- [ ] Can load decks from database
- [ ] Responsive layout works (mobile = search only, desktop = split view)
- [ ] Can export deck list to text format
- [ ] Dark mode styling consistent
- [ ] Card quantity validation (max 4 per card)

## Deck Library / "My Decks" View

Users need a way to browse and manage their collection of saved decks. This should be a separate page from the deck builder.

### Proposed Route
`/decklist/my-decks` - Protected route (requires authentication)

### Features

#### Folder/Subfolder Organization
- Hierarchical folder structure (like file explorer)
- Drag-and-drop to move decks between folders
- Create/rename/delete folders
- Root level for uncategorized decks
- Example structure:
  ```
  My Decks/
  ├── Tournament Ready/
  │   ├── Type 1 Defense/
  │   ├── Type 2 Offense/
  │   └── Sealed Deck/
  ├── Testing/
  │   ├── Experimental/
  │   └── Work in Progress/
  └── Archive/
      └── Old Metas/
  ```

#### Deck List View
- Grid or list view toggle
- Sort by: Name, Date Modified, Date Created, Card Count
- Filter by: Format, Tags, Folder
- Search decks by name or card contents
- Bulk actions (move, delete, export)
- Quick stats (card count, format badge)

#### Deck Card Preview
- Hover to see first few cards
- Click to open in deck builder
- Quick actions: Edit, Duplicate, Export, Delete, Share

#### Integration with Deck Builder
- "Save As..." creates new deck or overwrites existing
- "Open Deck" loads from library into builder
- Auto-save option (save on every change)
- Unsaved changes warning when navigating away

### UI Inspiration
Similar to:
- Google Drive folder structure
- VS Code file explorer
- Moxfield's "My Decks" page
- Archidekt's deck library

### Implementation Priority
This is a **Phase 6 / Post-MVP** feature, but we should design the database schema now to support it.

## Future Enhancements (Post-MVP)
- **"My Decks" Library Page** (folder/subfolder organization, described above)
- Format-specific deck validation (Type 1, Type 2 rules)
- Deck statistics dashboard (brigade distribution, card type breakdown)
- Public deck sharing via URL with embedded view
- Deck ratings, comments, and favorites
- "Popular Decks" page with filtering
- "Decks using this card" feature on card detail view
- Deck comparison tool (side-by-side)
- Card price tracking integration
- Print proxy generation (PDF export)
- Mobile deck builder support (if demand exists)
- Deck versioning/history
- Import from other formats (OCTGN, Lackey, etc.)
