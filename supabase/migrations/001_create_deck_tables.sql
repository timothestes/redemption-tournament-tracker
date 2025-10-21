-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Deck Folders Table (for "My Decks" library)
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

-- Decks Table
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

-- Deck Cards Table
CREATE or replace TABLE deck_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,  -- Full name: 'Son of God "Manger"'
  card_set TEXT,            -- Set code: 'Promo', 'LoC', etc.
  card_img_file TEXT,       -- Image filename for display
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  is_reserve BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deck_id, card_name, card_set, is_reserve)
);

CREATE INDEX idx_deck_cards_deck_id ON deck_cards(deck_id);
CREATE INDEX idx_deck_cards_card_name ON deck_cards(card_name);

-- Deck Tags Table (optional)
CREATE TABLE deck_tags (
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (deck_id, tag)
);

-- Enable Row Level Security
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE deck_tags ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Decks
-- Users can view public decks or their own
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

-- RLS Policies for Deck Cards
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

-- RLS Policies for Folders
-- Users can only manage their own folders
CREATE POLICY "Users can manage own folders" ON deck_folders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for Tags
CREATE POLICY "Users can view deck tags" ON deck_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM decks 
      WHERE decks.id = deck_tags.deck_id 
      AND (decks.is_public = true OR decks.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage own deck tags" ON deck_tags
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM decks 
      WHERE decks.id = deck_tags.deck_id 
      AND decks.user_id = auth.uid()
    )
  );

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on decks table
CREATE TRIGGER update_decks_updated_at
  BEFORE UPDATE ON decks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
