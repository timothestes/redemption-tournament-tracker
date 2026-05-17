-- Expand-phase: add `zone` column alongside `is_reserve`, with a bidirectional
-- sync trigger so deployed code (writes/reads is_reserve) and the add-maybeboard
-- branch (writes/reads zone) can both run against this schema at the same time.
-- Phase 2 (029_drop_is_reserve.sql) drops the legacy column after the new code
-- is merged and deployed to production.

BEGIN;

-- 1. Add zone, backfill from is_reserve, lock down with NOT NULL + CHECK.
ALTER TABLE deck_cards ADD COLUMN zone TEXT DEFAULT 'main';
UPDATE deck_cards SET zone = CASE WHEN is_reserve THEN 'reserve' ELSE 'main' END;
ALTER TABLE deck_cards ALTER COLUMN zone SET NOT NULL;
ALTER TABLE deck_cards
  ADD CONSTRAINT deck_cards_zone_check CHECK (zone IN ('main','reserve','maybeboard'));

-- 2. Swap the unique constraint from (..., is_reserve) to (..., zone).
--    Required so the same card can live in both 'main' and 'maybeboard' at once
--    (both rows would otherwise collide on is_reserve=false). Old code only ever
--    writes zone in {'main','reserve'}, so it's still unique under the new key.
ALTER TABLE deck_cards
  DROP CONSTRAINT IF EXISTS deck_cards_deck_id_card_name_card_set_is_reserve_key;
ALTER TABLE deck_cards
  ADD CONSTRAINT deck_cards_deck_id_card_name_card_set_zone_key
  UNIQUE (deck_id, card_name, card_set, zone);

-- 3. Index for the common (deck + zone) access pattern.
CREATE INDEX IF NOT EXISTS idx_deck_cards_zone ON deck_cards (deck_id, zone);

-- 4. Bidirectional sync trigger. Removed in Phase 2 when is_reserve is dropped.
CREATE OR REPLACE FUNCTION deck_cards_sync_zone_is_reserve()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Old code sets is_reserve only; the column default leaves NEW.zone='main'.
    -- If is_reserve was set true, promote zone to 'reserve' before final sync.
    IF NEW.zone IS NULL OR NEW.zone = 'main' THEN
      IF NEW.is_reserve THEN NEW.zone := 'reserve'; END IF;
    END IF;
    NEW.is_reserve := (NEW.zone = 'reserve');
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.zone IS DISTINCT FROM OLD.zone THEN
      NEW.is_reserve := (NEW.zone = 'reserve');
    ELSIF NEW.is_reserve IS DISTINCT FROM OLD.is_reserve THEN
      NEW.zone := CASE WHEN NEW.is_reserve THEN 'reserve' ELSE 'main' END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deck_cards_sync_zone_is_reserve_trg
BEFORE INSERT OR UPDATE ON deck_cards
FOR EACH ROW EXECUTE FUNCTION deck_cards_sync_zone_is_reserve();

-- 5. replace_deck_cards accepts EITHER {zone} (new code) or {is_reserve} (old
--    code) in the JSONB payload. card_set / card_img_file casts intentionally
--    match the existing prod function (no NULLIF) to avoid silently changing
--    empty-string -> NULL behavior. SECURITY DEFINER preserved from prod.
CREATE OR REPLACE FUNCTION replace_deck_cards(p_deck_id UUID, p_cards JSONB)
RETURNS void
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM deck_cards WHERE deck_id = p_deck_id;
  IF p_cards IS NULL OR jsonb_array_length(p_cards) = 0 THEN RETURN; END IF;

  INSERT INTO deck_cards (deck_id, card_name, card_set, card_img_file, quantity, zone, is_reserve)
  SELECT
    p_deck_id,
    (c->>'card_name')::TEXT,
    (c->>'card_set')::TEXT,
    (c->>'card_img_file')::TEXT,
    (c->>'quantity')::INTEGER,
    COALESCE(
      c->>'zone',
      CASE WHEN (c->>'is_reserve')::BOOLEAN THEN 'reserve' ELSE 'main' END
    )::TEXT,
    COALESCE((c->>'is_reserve')::BOOLEAN, (c->>'zone') = 'reserve', false)
  FROM jsonb_array_elements(p_cards) AS c;
END;
$$ LANGUAGE plpgsql;

-- 6. Price aggregations exclude maybeboard so it doesn't inflate deck totals.
CREATE OR REPLACE FUNCTION get_deck_total_prices(deck_ids UUID[])
RETURNS TABLE(deck_id UUID, total_price NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.deck_id,
    COALESCE(SUM(cp.price * dc.quantity), 0) AS total_price
  FROM deck_cards dc
  JOIN card_prices cp
    ON cp.card_key = dc.card_name || '|' || dc.card_set || '|' || dc.card_img_file
  WHERE dc.deck_id = ANY(deck_ids)
    AND dc.zone <> 'maybeboard'
  GROUP BY dc.deck_id;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_deck_budget_prices(deck_ids UUID[])
RETURNS TABLE(deck_id UUID, budget_price NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.deck_id,
    COALESCE(SUM(LEAST(cp.price, COALESCE(cp.cheapest_price, cp.price)) * dc.quantity), 0) AS budget_price
  FROM deck_cards dc
  JOIN card_prices cp
    ON cp.card_key = dc.card_name || '|' || dc.card_set || '|' || dc.card_img_file
  WHERE dc.deck_id = ANY(deck_ids)
    AND dc.zone <> 'maybeboard'
  GROUP BY dc.deck_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;
