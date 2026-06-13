-- Live View Mode: a frozen "published" snapshot of an episode outline that
-- anonymous visitors can read at /threshingfloor/episodes/<n>. The editable
-- draft (data) stays private; only published_data is ever exposed publicly.

ALTER TABLE public.threshing_floor_drafts
  ADD COLUMN IF NOT EXISTS published_data jsonb,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Public read path. SECURITY DEFINER so anon can call it without any RLS grant
-- on the table itself. Returns ONLY published_data, and ONLY when published.
CREATE OR REPLACE FUNCTION public.get_published_outline(ep text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT published_data
  FROM public.threshing_floor_drafts
  WHERE episode_number = ep AND published_at IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_published_outline(text) TO anon, authenticated;
