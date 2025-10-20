# Deck Builder - Overview & Database Schema

This document provides an overview of the deck builder feature and defines the Supabase database schema needed to support it.

**For implementation details, see**:
- 📋 **`deckbuilder_mvp.md`** - MVP implementation plan (localStorage only)
- 🚀 **`deckbuilder_future_enhancements.md`** - Post-MVP features (cloud sync, My Decks page, mobile, etc.)

---

## Vision

Transform the card search page into a dual-purpose deck builder, inspired by Lorcana's Dreamborn.ink:
- **Left panel**: Card search with all existing filters
- **Right panel**: Deck builder with card list, quantities, import/export
- **Desktop-focused**: Mobile shows search only (md breakpoint and above for deck builder)
- **Progressive enhancement**: Deck builder is an addition, not a replacement

---

## Design Inspiration

**Lorcana Dreamborn.ink deck builder**:
- Split-view layout (61.8% search / 38.2% deck on xl screens)
- Card search on left, deck panel on right
- Golden ratio responsive breakpoints
- Clean, intuitive deck management

---

## Supabase Database Schema

Define tables now even though MVP uses localStorage. This enables future cloud sync without breaking changes.

### Decks Table

```sql
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL DEFAULT 'Untitled Deck',
  description TEXT,
  format TEXT, -- 'Type 1', 'Type 2', 'Classic', etc.
  folder_id UUID REFERENCES deck_folders(id) ON DELETE SET NULL,
  is_public BOOLEAN DEFAULT false,
  view_count INTEGER DEFAULT 0,
  card_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decks_user_id ON decks(user_id);
CREATE INDEX idx_decks_is_public ON decks(is_public);
CREATE INDEX idx_decks_folder_id ON decks(folder_id);
```

### Deck Cards Table

```sql
CREATE TABLE deck_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,  -- Full name: 'Son of God "Manger"'
  card_set TEXT,            -- Set code: 'Promo', 'LoC', etc.
  card_img_file TEXT,       -- Image filename for display
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 4),
  is_reserve BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deck_id, card_name, card_set)
);

CREATE INDEX idx_deck_cards_deck_id ON deck_cards(deck_id);
CREATE INDEX idx_deck_cards_card_name ON deck_cards(card_name);
```

**Note**: `card_name` and `card_set` match the standard deck list format for seamless import/export.

### Deck Folders Table (for "My Decks" library)

```sql
CREATE TABLE deck_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  parent_folder_id UUID REFERENCES deck_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, parent_folder_id, name)
);

CREATE INDEX idx_deck_folders_user_id ON deck_folders(user_id);
CREATE INDEX idx_deck_folders_parent ON deck_folders(parent_folder_id);
```

### Deck Tags Table (optional)

```sql
CREATE TABLE deck_tags (
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (deck_id, tag)
);
```

---

## Row Level Security (RLS) Policies

```sql
-- Enable RLS
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_folders ENABLE ROW LEVEL SECURITY;

-- Decks: Users can view public decks or their own
CREATE POLICY "Users can view decks" ON decks
  FOR SELECT
  USING (is_public = true OR auth.uid() = user_id);

CREATE POLICY "Users can create own decks" ON decks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own decks" ON decks
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own decks" ON decks
  FOR DELETE
  USING (auth.uid() = user_id);

-- Deck cards: Inherit permissions from parent deck
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

-- Folders: Users can only manage their own
CREATE POLICY "Users can manage own folders" ON deck_folders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## Data Flow Strategy

**Phase 1 (MVP)**:
- Browser localStorage only
- No auth required
- Quick to implement
- Works offline

**Phase 2 (Post-MVP)**:
- Supabase sync
- "Save to Cloud" button
- Load from database
- Keep localStorage as cache

**Phase 3 (Future)**:
- Real-time subscriptions
- Cross-device sync
- Collaborative deck building

---

## Standard Deck Format

Community standard format for import/export (compatible with OCTGN, Lackey, etc.):

```
[quantity]\t[Card Name] ([Set Code])
[quantity]\t[Card Name] ([Set Code])
...
Reserve:
[quantity]\t[Card Name] ([Set Code])
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

## Key Design Decisions

1. **Desktop-only MVP** - Mobile support deferred (screen real estate needed)
2. **Database schema defined upfront** - Enables future cloud sync without breaking changes
3. **LocalStorage MVP** - Fast to implement, no auth required
4. **Standard format support** - Import/export must match community conventions
5. **Progressive enhancement** - Deck builder doesn't replace existing search

---

## Implementation Timeline

### MVP (Phase 1)
- ✅ Database schema defined (even if not used yet)
- 🔨 Build deck builder UI
- 🔨 LocalStorage persistence
- 🔨 Import/export functionality

### Post-MVP (Phase 2+)
- Supabase integration (save to cloud)
- "My Decks" library page
- Authentication integration
- See `deckbuilder_future_enhancements.md` for full list

---

## Next Steps

See **`deckbuilder_mvp.md`** for detailed implementation plan.
