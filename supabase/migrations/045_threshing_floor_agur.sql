-- Grant the 'threshing_floor' permission to Agurthewise (jakeantonetz@gmail.com),
-- co-host of The Threshing Floor podcast. He had no admin_users row, so this
-- inserts one with only the threshing_floor permission (no other admin powers).

INSERT INTO public.admin_users (user_id, permissions)
VALUES ('da65afb4-054c-4103-a265-2b3920eee1e4', ARRAY['threshing_floor'])
ON CONFLICT (user_id) DO UPDATE
SET permissions = array_append(admin_users.permissions, 'threshing_floor')
WHERE COALESCE(admin_users.permissions @> ARRAY['threshing_floor'], false) = false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = 'da65afb4-054c-4103-a265-2b3920eee1e4'
      AND permissions @> ARRAY['threshing_floor']
  ) THEN
    RAISE EXCEPTION 'threshing_floor grant failed for Agurthewise';
  END IF;
END $$;
