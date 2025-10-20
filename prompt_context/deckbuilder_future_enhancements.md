# Deck Builder - Future Enhancements

This document contains features and improvements to be implemented **after** the MVP deck builder is complete.

## Mobile Support

### Could we add mobile support with just a toggle button?

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

**Implementation**:
- Toggle button for deck visibility
- Bottom sheet/drawer component
- Optimized touch interactions
- Possibly separate "My Decks" mobile view

---

## Card Data Migration to Supabase

### Current Approach
- Fetches `carddata.txt` from GitHub on client
- Parses ~2000+ cards in browser

### Benefits of Supabase Migration
1. ✅ **Faster queries** - Database indexing vs client-side filtering
2. ✅ **Server-side search** - Offload filtering logic, reduce client bundle
3. ✅ **Advanced queries** - Full-text search, complex joins
4. ✅ **Relational features** - "Decks using this card", card statistics
5. ✅ **Caching** - Browser caches API responses
6. ✅ **Reliability** - No dependency on external GitHub raw file
7. ✅ **Versioning** - Track card data changes, enable rollback

### Proposed Card Table Schema
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

### Migration Path
1. Create table in Supabase
2. Write script to parse carddata.txt and insert into table
3. Create API endpoint for card search (or use Supabase auto-generated)
4. Update client.tsx to fetch from Supabase instead of GitHub
5. Add periodic sync job to keep card data updated

---

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

### Database Schema (Already Prepared)
```sql
-- Deck folders/organization
CREATE TABLE deck_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  parent_folder_id UUID REFERENCES deck_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, parent_folder_id, name)
);

ALTER TABLE decks ADD COLUMN folder_id UUID REFERENCES deck_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_decks_folder_id ON decks(folder_id);
CREATE INDEX idx_deck_folders_user_id ON deck_folders(user_id);
CREATE INDEX idx_deck_folders_parent ON deck_folders(parent_folder_id);
```

---

## Advanced Features

### Deck Analysis & Statistics
- Brigade distribution pie chart
- Card type breakdown (Heroes, Evil Characters, Enhancements, etc.)
- Mana curve / ink cost distribution
- Testament balance (OT vs NT)
- Average card strength/toughness

### Social Features
- Public deck sharing via URL with embedded view
- Deck ratings and upvotes
- Comments on decks
- "Popular Decks" page with filtering
- Follow other users
- Deck of the week/month

### Deck Discovery
- "Decks using this card" feature on card detail view
- Similar deck recommendations
- Deck comparison tool (side-by-side)
- Meta snapshots (most played cards/decks)

### Format-Specific Features
- Format validation (Type 1, Type 2 rules)
- Reserved card checking
- Deck size validation
- Lost soul requirements

### Import/Export Enhancements
- Import from other formats (OCTGN, Lackey XML)
- Export to multiple formats
- Bulk import multiple decks
- Deck templates

### Versioning & History
- Track deck changes over time
- Revert to previous versions
- Compare versions side-by-side
- Fork/copy deck with history

### Integration Features
- Card price tracking (TCGPlayer, etc.)
- Print proxy generation (PDF export)
- Tournament deck submission
- Deck archiving/backup to external storage

### Collaborative Features
- Real-time collaborative deck building
- Shared decks with multiple editors
- Deck suggestions/recommendations from others
- Team/group deck collections

### Performance Optimization
- Virtual scrolling for large deck lists
- Lazy loading of card images
- Service worker for offline support
- Deck thumbnail generation

---

## Implementation Priority

These features should be considered **after** the MVP is complete and user feedback is gathered. Priority order:

1. **"My Decks" Library Page** - High demand, necessary for managing multiple decks
2. **Card Data to Supabase** - Performance improvement, enables advanced features
3. **Deck Statistics** - Popular request, relatively easy to implement
4. **Public Deck Sharing** - Community building, viral growth
5. **Mobile Support** - If users request it
6. Everything else based on user feedback and demand
