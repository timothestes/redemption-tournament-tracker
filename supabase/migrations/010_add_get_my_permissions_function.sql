-- Add a SECURITY DEFINER function to safely fetch the calling user's admin permissions.
-- This bypasses RLS (just like check_admin_role) so it always works for any admin user.

CREATE OR REPLACE FUNCTION public.get_my_admin_permissions()
RETURNS TEXT[]
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(permissions, '{}')
  FROM public.admin_users
  WHERE user_id = auth.uid();
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_my_admin_permissions() TO authenticated;
