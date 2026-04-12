-- Function to compute total prices for a batch of decks
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
  GROUP BY dc.deck_id;
END;
$$ LANGUAGE plpgsql STABLE;
