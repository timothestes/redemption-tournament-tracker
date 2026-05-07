-- Moving a deck between folders should not bump updated_at, otherwise it
-- resorts the deck to the top of "newest" lists (Community Decks, My Decks)
-- as if it had been edited. folder_id is organizational metadata, not a deck
-- edit, so strip it from the diff alongside the other auto-maintained columns.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF to_jsonb(NEW)
       - 'last_played_at' - 'view_count'
       - 'is_legal' - 'deckcheck_issues'
       - 'last_active_at'
       - 'updated_at'
       - 'folder_id'
   = to_jsonb(OLD)
       - 'last_played_at' - 'view_count'
       - 'is_legal' - 'deckcheck_issues'
       - 'last_active_at'
       - 'updated_at'
       - 'folder_id' THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$;
