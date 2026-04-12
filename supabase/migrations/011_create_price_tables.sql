-- Card Price Matching System tables
-- Enables matching cards from carddata.txt to Shopify products,
-- storing resolved mappings, and syncing prices automatically.

-- Enable fuzzy matching extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Raw Shopify product cache
CREATE TABLE shopify_products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT NOT NULL,
  tags TEXT,
  product_type TEXT,
  price NUMERIC(10,2),
  inventory_quantity INTEGER,
  raw_json JSONB,
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shopify_products_title_trgm ON shopify_products USING GIN (title gin_trgm_ops);
CREATE INDEX idx_shopify_products_type ON shopify_products (product_type);

-- Set alias lookup table (replaces hard-coded mapping)
CREATE TABLE set_aliases (
  id SERIAL PRIMARY KEY,
  carddata_code TEXT NOT NULL,
  shopify_abbrev TEXT NOT NULL,
  notes TEXT
);

CREATE UNIQUE INDEX idx_set_aliases_carddata ON set_aliases (carddata_code);

-- Resolved card → Shopify product mappings
CREATE TABLE card_price_mappings (
  id SERIAL PRIMARY KEY,
  card_key TEXT NOT NULL UNIQUE,
  card_name TEXT NOT NULL,
  set_code TEXT NOT NULL,
  shopify_product_id TEXT REFERENCES shopify_products(id),
  confidence NUMERIC(3,2),
  match_method TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',
  claude_reasoning TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_card_price_mappings_status ON card_price_mappings (status);
CREATE INDEX idx_card_price_mappings_set_code ON card_price_mappings (set_code);

-- Final denormalized output (what the deck builder reads)
CREATE TABLE card_prices (
  card_key TEXT PRIMARY KEY,
  price NUMERIC(10,2),
  shopify_handle TEXT,
  shopify_title TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed set aliases
INSERT INTO set_aliases (carddata_code, shopify_abbrev, notes) VALUES
  ('Ki', 'Ki', 'Direct match'),
  ('Pri', 'Pi', null),
  ('Pat', 'Pa', null),
  ('RR', 'Roots', null),
  ('T2C', 'TtC', null),
  ('War', 'Wa', null),
  ('Wom', 'Wo', null),
  ('FoOF', 'FooF', null),
  ('TEC', 'EC', null),
  ('TPC', 'PC', null),
  ('Prp', 'Pr', null),
  ('Pmo-P1', 'Promo', null),
  ('Pmo-P2', 'Promo', null),
  ('Pmo-P3', 'Promo', null),
  ('I/J+', 'I & J+', null),
  ('K', 'K Deck', null),
  ('K1P', 'K Deck', null),
  ('L', 'L Deck', null),
  ('L1P', 'L Deck', null),
  ('A', 'A Deck', null),
  ('B', 'B Deck', null),
  ('C', 'C Deck', null),
  ('D', 'D Deck', null),
  ('E', 'E Deck', null),
  ('F', 'F Deck', null),
  ('G', 'G Deck', null),
  ('H', 'H Deck', null),
  ('I', 'I Deck', null),
  ('J', 'J Deck', null),
  ('CoW (AB)', 'CoW AB', null),
  ('RoJ (AB)', 'RoJ AB', null),
  ('Ap', 'Ap', 'Direct match'),
  ('GoC', 'GoC', 'Direct match'),
  ('FoM', 'FoM', 'Direct match'),
  ('LoC', 'LoC', 'Direct match'),
  ('Di', 'Di', 'Direct match'),
  ('Wo', 'Wo', 'Direct match'),
  ('AW', 'AW', 'Direct match'),
  ('CoW', 'CoW', 'Direct match'),
  ('II', 'II', 'Direct match'),
  ('IR', 'IR', 'Direct match'),
  ('PoC', 'PoC', 'Direct match'),
  ('RoA', 'RoA', 'Direct match'),
  ('RoA 3', 'RoA', null),
  ('RoJ', 'RoJ', 'Direct match'),
  ('TxP', 'TxP', 'Direct match');

-- RPC function for fuzzy trigram matching
CREATE OR REPLACE FUNCTION fuzzy_match_shopify_product(
  search_term TEXT,
  min_similarity FLOAT DEFAULT 0.7,
  max_results INT DEFAULT 5
)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  tags TEXT,
  score FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    sp.id,
    sp.title,
    sp.tags,
    similarity(sp.title, search_term)::FLOAT AS score
  FROM shopify_products sp
  WHERE sp.product_type = 'Single'
    AND similarity(sp.title, search_term) > min_similarity
  ORDER BY score DESC
  LIMIT max_results;
$$;
