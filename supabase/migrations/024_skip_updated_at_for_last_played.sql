-- Don't bump updated_at when only last_played_at (or view_count) changes,
-- so playing a deck doesn't make it appear "recently edited" in community sorting.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip if the only changes are last_played_at and/or view_count
  IF (NEW.last_played_at IS DISTINCT FROM OLD.last_played_at
      OR NEW.view_count IS DISTINCT FROM OLD.view_count)
    AND NEW.name IS NOT DISTINCT FROM OLD.name
    AND NEW.description IS NOT DISTINCT FROM OLD.description
    AND NEW.format IS NOT DISTINCT FROM OLD.format
    AND NEW.folder_id IS NOT DISTINCT FROM OLD.folder_id
    AND NEW.is_public IS NOT DISTINCT FROM OLD.is_public
    AND NEW.card_count IS NOT DISTINCT FROM OLD.card_count
  THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
