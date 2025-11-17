-- Add paragon column to decks table
ALTER TABLE decks ADD COLUMN IF NOT EXISTS paragon TEXT;

-- Create index for paragon lookups
CREATE INDEX IF NOT EXISTS idx_decks_paragon ON decks(paragon) WHERE paragon IS NOT NULL;

-- Add comment
COMMENT ON COLUMN decks.paragon IS 'Paragon name for Paragon format decks (e.g., "Abraham", "Moses", etc.)';
