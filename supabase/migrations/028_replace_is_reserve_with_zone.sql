-- Replace deck_cards.is_reserve (BOOLEAN) with deck_cards.zone (TEXT enum).
-- Adds 'maybeboard' as a third zone alongside 'main' and 'reserve'.
-- Maybeboard is a scratchpad: excluded from legality, copy limits, paragon rules,
-- tournament submissions, play/goldfish/multiplayer game state, and deck totals.

BEGIN;

-- 1. Add the new column, backfill from is_reserve, lock it down
ALTER TABLE deck_cards ADD COLUMN zone TEXT;
UPDATE deck_cards SET zone = CASE WHEN is_reserve THEN 'reserve' ELSE 'main' END;
ALTER TABLE deck_cards ALTER COLUMN zone SET NOT NULL;
ALTER TABLE deck_cards ALTER COLUMN zone SET DEFAULT 'main';
ALTER TABLE deck_cards
  ADD CONSTRAINT deck_cards_zone_check CHECK (zone IN ('main', 'reserve', 'maybeboard'));

-- 2. Swap the unique constraint from (..., is_reserve) to (..., zone)
ALTER TABLE deck_cards
  DROP CONSTRAINT IF EXISTS deck_cards_deck_id_card_name_card_set_is_reserve_key;
ALTER TABLE deck_cards
  ADD CONSTRAINT deck_cards_deck_id_card_name_card_set_zone_key
  UNIQUE (deck_id, card_name, card_set, zone);

-- 3. Index for the most common access pattern (deck + zone filter)
CREATE INDEX IF NOT EXISTS idx_deck_cards_zone ON deck_cards (deck_id, zone);

-- 4. Drop the legacy column
ALTER TABLE deck_cards DROP COLUMN is_reserve;

-- 5. Update price aggregation functions to exclude maybeboard from totals.
-- (Maybeboard is a "considering" list — it must not inflate deck cost displays.)
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

-- 6. Replace the atomic delete-and-insert RPC so it speaks `zone` instead of `is_reserve`.
-- Called from saveDeckAction with p_cards = jsonb[{card_name, card_set, card_img_file, quantity, zone}, ...].
CREATE OR REPLACE FUNCTION replace_deck_cards(p_deck_id UUID, p_cards JSONB)
RETURNS void AS $$
BEGIN
  DELETE FROM deck_cards WHERE deck_id = p_deck_id;

  IF p_cards IS NULL OR jsonb_array_length(p_cards) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO deck_cards (deck_id, card_name, card_set, card_img_file, quantity, zone)
  SELECT
    p_deck_id,
    (c->>'card_name')::TEXT,
    NULLIF(c->>'card_set', '')::TEXT,
    NULLIF(c->>'card_img_file', '')::TEXT,
    (c->>'quantity')::INTEGER,
    COALESCE(c->>'zone', 'main')::TEXT
  FROM jsonb_array_elements(p_cards) AS c;
END;
$$ LANGUAGE plpgsql;

COMMIT;
