-- WS-0 (YTG Store): mirror deterministic identity + description text on the
-- Shopify product cache. `sku` feeds matching pass 0 (WS-2); `body_html`
-- feeds the ability-text disambiguator (WS-2) and the deck-contents wizard
-- (WS-3). Both fields are already present in the REST payload the sync
-- fetches — backfill happens on the first sync run after deploy.
-- Applied to prod by the primary session via Supabase MCP only; this file
-- ships in the WS-0 PR unapplied.

ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE shopify_products ADD COLUMN IF NOT EXISTS body_html TEXT;
CREATE INDEX IF NOT EXISTS idx_shopify_products_sku ON shopify_products(sku) WHERE sku IS NOT NULL;
