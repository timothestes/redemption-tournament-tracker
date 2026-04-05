-- Add last_played_at column to track when a deck was last used in goldfish or multiplayer
ALTER TABLE decks ADD COLUMN last_played_at TIMESTAMPTZ;

-- Index for sorting by last played
CREATE INDEX idx_decks_last_played_at ON decks(last_played_at DESC NULLS LAST);
