-- 089_ytg_deck_links_and_sales.sql
-- WS-3: deck-product ↔ decklist links. WS-4's sales ledger ships here too
-- (shared migration per docs/superpowers/specs/2026-08-03-ytg-store-admin-design.md).
-- Service-role access only — RLS enabled with NO policies, grants revoked,
-- same posture as shopify_card_imports (080).
--
-- DO NOT APPLY from a workstream agent. The primary session applies this via
-- Supabase MCP after the WS-3 PR merges (overview §Sequencing).

CREATE TABLE public.ytg_deck_links (
  shopify_product_id TEXT PRIMARY KEY,
  -- ON DELETE RESTRICT, not CASCADE: once linked, the deck is store metadata.
  -- Deleting it from the deck builder fails until the product is unlinked here.
  deck_id            UUID UNIQUE NOT NULL REFERENCES public.decks(id) ON DELETE RESTRICT,
  handle             TEXT,
  product_title      TEXT,
  created_by         UUID,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.ytg_deck_sales (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id TEXT NOT NULL,
  deck_id            UUID NOT NULL,  -- no FK: sale history outlives links
  qty                INT NOT NULL CHECK (qty > 0),
  status             TEXT CHECK (status IN ('pending','applying','applied','partial','failed',
                                            'dry_run','undoing','undone','undo_partial')),
  created_by         UUID,
  created_at         TIMESTAMPTZ DEFAULT now(),
  undone_by          UUID,
  undone_at          TIMESTAMPTZ
);

-- One active sale per product; also what the WS-3 replace-guard reads.
CREATE UNIQUE INDEX idx_ytg_deck_sales_active_per_product
  ON public.ytg_deck_sales(shopify_product_id)
  WHERE status IN ('pending','applying');

CREATE TABLE public.ytg_deck_sale_items (
  sale_id           UUID REFERENCES public.ytg_deck_sales(id) ON DELETE CASCADE,
  card_key          TEXT NOT NULL,
  card_name         TEXT,
  qty_per_deck      INT NOT NULL,
  delta             INT NOT NULL,
  qty_before        INT,            -- CAS anchors; also the resume oracle
  qty_after         INT,
  single_product_id TEXT,
  variant_id        TEXT,
  inventory_item_id TEXT,
  status            TEXT CHECK (status IN ('pending','applying','applied','skipped_unmapped',
                                           'skipped_untracked','error','conflict','undone','undo_conflict')),
  error             TEXT,
  PRIMARY KEY (sale_id, card_key)   -- quantities summed per card_key pre-insert
);

ALTER TABLE public.ytg_deck_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ytg_deck_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ytg_deck_sale_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ytg_deck_links      FROM anon, authenticated;
REVOKE ALL ON public.ytg_deck_sales      FROM anon, authenticated;
REVOKE ALL ON public.ytg_deck_sale_items FROM anon, authenticated;
