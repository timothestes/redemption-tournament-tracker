-- Drop the old role-based admin system and replace with table-based approach
-- This is simpler and follows Supabase best practices

-- Drop old function
DROP FUNCTION IF EXISTS public.check_admin_role();

-- Drop old role (keep if other things depend on it, but we won't use it anymore)
-- DROP ROLE IF EXISTS registration_admin;

-- Create admin_users table
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS on admin_users table
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can view the admin list
CREATE POLICY "Admins can view admin list"
ON public.admin_users
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

-- Policy: Only admins can add new admins
CREATE POLICY "Admins can add new admins"
ON public.admin_users
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

-- Policy: Only admins can remove admins
CREATE POLICY "Admins can remove admins"
ON public.admin_users
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.user_id = auth.uid()
  )
);

-- Recreate check_admin_role function with table-based approach
CREATE OR REPLACE FUNCTION public.check_admin_role()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.admin_users 
    WHERE user_id = auth.uid()
  );
$$;

-- Grant execute permission on the function to authenticated users
GRANT EXECUTE ON FUNCTION public.check_admin_role() TO authenticated;

-- Grant permissions on admin_users table
GRANT SELECT, INSERT, DELETE ON public.admin_users TO authenticated;

-- Note: To grant admin access to your first user, run:
-- INSERT INTO public.admin_users (user_id) VALUES ('your-user-uuid');
-- 
-- Find your UUID with:
-- SELECT id, email FROM auth.users WHERE email = 'your@email.com';
