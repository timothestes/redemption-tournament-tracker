-- Three-state deck visibility: private / unlisted / public.
--
-- `visibility` is the single source of truth. `is_public` is kept as a
-- trigger-mirrored column (true when visibility is 'unlisted' or 'public') so
-- existing RLS policies and "viewable by link" readers keep working unchanged.
--   private  -> owner only
--   unlisted -> anyone with the link can view; excluded from community/sitemap
--   public   -> viewable by link AND listed in community search

-- 1. Source-of-truth column.
ALTER TABLE decks
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'unlisted', 'public'));

-- 2. Backfill from existing is_public so current public decks stay listed.
UPDATE decks SET visibility = CASE WHEN is_public THEN 'public' ELSE 'private' END;

-- 3. Keep is_public mirrored from visibility (unlisted + public are viewable).
CREATE OR REPLACE FUNCTION sync_deck_is_public()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_public := (NEW.visibility IN ('unlisted', 'public'));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_deck_is_public
  BEFORE INSERT OR UPDATE OF visibility ON decks
  FOR EACH ROW EXECUTE FUNCTION sync_deck_is_public();

-- 4. Index for the community / sitemap filter (visibility = 'public').
CREATE INDEX idx_decks_visibility ON decks(visibility);
