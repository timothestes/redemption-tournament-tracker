-- New admin permission: 'threshing_floor'
-- Grants access to the secret Threshing Floor podcast outline page at
-- /threshingfloor and its drafts API. Granted to jhendrix6426 and BaboonyTim.
-- Also creates the shared drafts table (one jsonb row per episode).

-- 1) Grant the permission (idempotent; fails loudly if a user row is missing)
DO $$
DECLARE
  target uuid;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    '809bf436-d74d-41d2-be17-e37b03cd2328',  -- jhendrix6426
    '6d30f6e3-838e-4f11-9416-95996da6e5b9'   -- BaboonyTim
  ]::uuid[]
  LOOP
    UPDATE public.admin_users
    SET permissions = array_append(permissions, 'threshing_floor')
    WHERE user_id = target
      AND COALESCE(permissions @> ARRAY['threshing_floor'], false) = false;

    IF NOT EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE user_id = target AND permissions @> ARRAY['threshing_floor']
    ) THEN
      RAISE EXCEPTION 'threshing_floor grant failed: no admin_users row for %', target;
    END IF;
  END LOOP;
END $$;

-- 2) Drafts table
CREATE TABLE public.threshing_floor_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at current on every write (function exists since migration 001)
CREATE TRIGGER update_threshing_floor_drafts_updated_at
  BEFORE UPDATE ON public.threshing_floor_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 3) RLS — every operation requires the threshing_floor permission.
-- Uses the SECURITY DEFINER helper from migration 010; do NOT use an inline
-- subquery against admin_users (circular-RLS failure documented in 009).
ALTER TABLE public.threshing_floor_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tf_drafts_select" ON public.threshing_floor_drafts
  FOR SELECT TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_drafts_insert" ON public.threshing_floor_drafts
  FOR INSERT TO authenticated
  WITH CHECK ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_drafts_update" ON public.threshing_floor_drafts
  FOR UPDATE TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()))
  WITH CHECK ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_drafts_delete" ON public.threshing_floor_drafts
  FOR DELETE TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()));
