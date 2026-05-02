-- Add a generated column representing the most recent activity on a deck
-- (whichever is later: last played or last edited). Used by the "All" sort
-- in the deck picker to mix recently-played and recently-edited decks.
ALTER TABLE decks
  ADD COLUMN last_active_at TIMESTAMPTZ
  GENERATED ALWAYS AS (GREATEST(last_played_at, updated_at)) STORED;

CREATE INDEX idx_decks_last_active_at ON decks(last_active_at DESC NULLS LAST);
