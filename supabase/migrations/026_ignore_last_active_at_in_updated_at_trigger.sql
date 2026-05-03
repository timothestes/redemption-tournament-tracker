-- last_active_at is a generated column = GREATEST(last_played_at, updated_at).
-- It auto-recomputes whenever last_played_at changes, which would otherwise make
-- the JSONB-diff in this trigger see a "real" edit and bump updated_at — defeating
-- the whole point of the no-bump-on-play behavior. Strip it out alongside the
-- other internal/auto-maintained columns.
--
-- Also captures the current live function (the JSONB-diff form was applied directly
-- to the DB without a migration; this file serves as the source of truth going forward).
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
   = to_jsonb(OLD)
       - 'last_played_at' - 'view_count'
       - 'is_legal' - 'deckcheck_issues'
       - 'last_active_at'
       - 'updated_at' THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$;
