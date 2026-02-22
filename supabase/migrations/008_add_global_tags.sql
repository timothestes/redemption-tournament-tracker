-- Global tags table — superuser-managed predefined list of tags
CREATE TABLE global_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE global_tags ENABLE ROW LEVEL SECURITY;

-- Anyone can read the tag list (needed to populate the picker for deck owners)
CREATE POLICY "Anyone can view global tags" ON global_tags
  FOR SELECT USING (true);

-- Only admins can create/update/delete global tags
CREATE POLICY "Admins can manage global tags" ON global_tags
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- Drop and recreate deck_tags to reference global_tags by ID
-- (the original table was unused, only had deck_id + tag TEXT)
DROP TABLE IF EXISTS deck_tags;

CREATE TABLE deck_tags (
  deck_id UUID REFERENCES decks(id) ON DELETE CASCADE,
  tag_id  UUID REFERENCES global_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (deck_id, tag_id)
);

ALTER TABLE deck_tags ENABLE ROW LEVEL SECURITY;

-- Anyone can view tags on public decks; owners can view their own private deck tags
CREATE POLICY "Users can view deck tags" ON deck_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = deck_tags.deck_id
      AND (decks.is_public = true OR decks.user_id = auth.uid())
    )
  );

-- Deck owners can add/remove tags on their own decks
CREATE POLICY "Deck owners can manage deck tags" ON deck_tags
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = deck_tags.deck_id
      AND decks.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = deck_tags.deck_id
      AND decks.user_id = auth.uid()
    )
  );
