-- Add legality tracking columns to decks table
-- is_legal: set on every save by the deckcheck engine
-- deckcheck_issues: stores the full issues array for display without re-running

ALTER TABLE decks ADD COLUMN IF NOT EXISTS is_legal BOOLEAN DEFAULT NULL;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS deckcheck_issues JSONB DEFAULT NULL;
