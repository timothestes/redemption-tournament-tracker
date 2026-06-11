-- Per-user card collection tracker.
-- One row per owned printing, keyed by the app-wide card identity
-- (card_name, card_set, card_img_file) — matches CARD_BY_FULL_KEY and
-- card_price_mappings.card_key.

CREATE TABLE collection_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_name text NOT NULL,
  card_set text NOT NULL,
  card_img_file text NOT NULL DEFAULT '',
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, card_name, card_set, card_img_file)
);

CREATE INDEX idx_collection_cards_user_id ON collection_cards (user_id);

ALTER TABLE collection_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own collection" ON collection_cards
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can add to own collection" ON collection_cards
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own collection" ON collection_cards
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete from own collection" ON collection_cards
  FOR DELETE USING (auth.uid() = user_id);
