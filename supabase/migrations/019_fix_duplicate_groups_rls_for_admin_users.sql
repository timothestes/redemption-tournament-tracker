-- Drop the old pg_roles-based write policies
DROP POLICY IF EXISTS "Admins can manage duplicate groups" ON duplicate_card_groups;
DROP POLICY IF EXISTS "Admins can manage duplicate group members" ON duplicate_card_group_members;

-- Create new policies using admin_users table + auth.uid() (matches card_rulings pattern)
CREATE POLICY "Admins can insert duplicate groups"
  ON duplicate_card_groups FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));

CREATE POLICY "Admins can update duplicate groups"
  ON duplicate_card_groups FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));

CREATE POLICY "Admins can delete duplicate groups"
  ON duplicate_card_groups FOR DELETE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));

CREATE POLICY "Admins can insert duplicate group members"
  ON duplicate_card_group_members FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));

CREATE POLICY "Admins can update duplicate group members"
  ON duplicate_card_group_members FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));

CREATE POLICY "Admins can delete duplicate group members"
  ON duplicate_card_group_members FOR DELETE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));
