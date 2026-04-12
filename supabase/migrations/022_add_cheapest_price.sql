-- Add cheapest_price column to card_prices for budget deck pricing
ALTER TABLE card_prices ADD COLUMN IF NOT EXISTS cheapest_price NUMERIC(10,2);

-- Function to compute budget (cheapest-version) prices for a batch of decks.
-- Uses LEAST(price, cheapest_price) so if a cheaper equivalent exists, it's used.
-- Falls back to price when cheapest_price is NULL (not yet computed or no cheaper version).
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
  GROUP BY dc.deck_id;
END;
$$ LANGUAGE plpgsql STABLE;
