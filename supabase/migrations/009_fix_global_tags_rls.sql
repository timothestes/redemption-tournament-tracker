-- Fix: the original policy used a direct EXISTS query against admin_users,
-- which fails because admin_users itself has RLS that creates a circular check.
-- Use the SECURITY DEFINER check_admin_role() function instead, which bypasses RLS.

DROP POLICY IF EXISTS "Admins can manage global tags" ON global_tags;

CREATE POLICY "Admins can manage global tags" ON global_tags
  FOR ALL
  USING (check_admin_role())
  WITH CHECK (check_admin_role());
