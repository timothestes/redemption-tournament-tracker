-- Threshing Floor general-purpose key-value store.
-- Holds shared community data that lives OUTSIDE any single episode draft
-- (player registry, recurring tournament names, recurring side-event names).
-- Kept in its own table so these reserved keys never appear in the episode
-- draft picker (which lists every row in threshing_floor_drafts).
--
-- Mirrors the drafts table from migration 044: one jsonb row per key, same
-- threshing_floor permission gate. Allowed keys are enforced in the API layer.

CREATE TABLE public.threshing_floor_store (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at current on every write (function exists since migration 001)
CREATE TRIGGER update_threshing_floor_store_updated_at
  BEFORE UPDATE ON public.threshing_floor_store
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS — every operation requires the threshing_floor permission.
-- Uses the SECURITY DEFINER helper from migration 010; do NOT use an inline
-- subquery against admin_users (circular-RLS failure documented in 009).
ALTER TABLE public.threshing_floor_store ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tf_store_select" ON public.threshing_floor_store
  FOR SELECT TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_store_insert" ON public.threshing_floor_store
  FOR INSERT TO authenticated
  WITH CHECK ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_store_update" ON public.threshing_floor_store
  FOR UPDATE TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()))
  WITH CHECK ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_store_delete" ON public.threshing_floor_store
  FOR DELETE TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()));
