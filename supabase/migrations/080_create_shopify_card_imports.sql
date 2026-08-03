-- 080_create_shopify_card_imports.sql
-- Ledger for the YTG Shopify set importer (docs/superpowers/specs/2026-07-25-ytg-shopify-set-import-design.md §7).
-- One row per card ever imported; keyed by the canonical card_key `${name}|${set}|${imgFile}`.
-- Accessed exclusively via the service-role client — no anon/authenticated policies on purpose.

CREATE TABLE public.shopify_card_imports (
  card_key           TEXT PRIMARY KEY,
  set_code           TEXT NOT NULL,
  shopify_product_id TEXT,
  shopify_variant_id TEXT,
  handle             TEXT,
  status             TEXT NOT NULL CHECK (status IN ('created', 'updated', 'skipped', 'error')),
  media_attached     BOOLEAN NOT NULL DEFAULT false,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopify_card_imports_set_code ON public.shopify_card_imports (set_code);

ALTER TABLE public.shopify_card_imports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shopify_card_imports FROM anon, authenticated;
