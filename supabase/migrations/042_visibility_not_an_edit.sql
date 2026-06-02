-- Toggling a deck's visibility (and the cover/preview cards auto-set when a
-- deck first becomes shareable) is metadata, not an edit of the deck's
-- contents. It should NOT move the deck's "last edited / last active"
-- timestamp (updated_at, which feeds the generated last_active_at column).
--
-- update_updated_at_column already ignores a set of metadata-only fields
-- (last_played_at, view_count, is_legal, deckcheck_issues, folder_id). Add
-- visibility, is_public, and the preview/cover cards to that ignore list.

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
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
       - 'visibility' - 'is_public'
       - 'preview_card_1' - 'preview_card_2'
   = to_jsonb(OLD)
       - 'last_played_at' - 'view_count'
       - 'is_legal' - 'deckcheck_issues'
       - 'last_active_at'
       - 'updated_at'
       - 'folder_id'
       - 'visibility' - 'is_public'
       - 'preview_card_1' - 'preview_card_2' THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$;
