-- Contract-phase: drop the legacy is_reserve column and its sync trigger.
-- DO NOT APPLY until the add-maybeboard branch is merged to main AND a Vercel
-- production deploy of that code is live. Prior to deploy, prod code still
-- depends on is_reserve and will 42703 once this runs.

BEGIN;

DROP TRIGGER IF EXISTS deck_cards_sync_zone_is_reserve_trg ON deck_cards;
DROP FUNCTION IF EXISTS deck_cards_sync_zone_is_reserve();

ALTER TABLE deck_cards DROP COLUMN is_reserve;

-- Re-create replace_deck_cards without the is_reserve fallback / insert column.
CREATE OR REPLACE FUNCTION replace_deck_cards(p_deck_id UUID, p_cards JSONB)
RETURNS void
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM deck_cards WHERE deck_id = p_deck_id;
  IF p_cards IS NULL OR jsonb_array_length(p_cards) = 0 THEN RETURN; END IF;

  INSERT INTO deck_cards (deck_id, card_name, card_set, card_img_file, quantity, zone)
  SELECT
    p_deck_id,
    (c->>'card_name')::TEXT,
    (c->>'card_set')::TEXT,
    (c->>'card_img_file')::TEXT,
    (c->>'quantity')::INTEGER,
    COALESCE(c->>'zone', 'main')::TEXT
  FROM jsonb_array_elements(p_cards) AS c;
END;
$$ LANGUAGE plpgsql;

COMMIT;
