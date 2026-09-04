-- 093_fix_inline_admin_users_rls.sql
-- Ruling, discord-ruling staging, and duplicate-card-group writes have failed
-- for EVERY signed-in user since 062 went live (2026-07-04) with
--   "permission denied for table admin_users"
-- No ruling has been written since 2026-06-24.
--
-- Why: 062 revoked SELECT on admin_users from authenticated (reads go via the
-- definer RPCs, writes only via the super_* RPCs). These four tables still
-- carried 015/017/019-era write policies with an inline
--   EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
-- subquery. That subquery runs as the authenticated role, so it now fails the
-- table-privilege check before RLS is even consulted.
--
-- Fix: rewrite them on the SECURITY DEFINER helper from 010, gated on the same
-- permission the server actions already require (pattern: 044/047). Do NOT
-- use an inline subquery against admin_users (see 009 and 062 §3).

-- card_rulings: manage_rulings (app/admin/rulings/actions.ts)
drop policy if exists "Admins can insert rulings" on public.card_rulings;
drop policy if exists "Admins can update rulings" on public.card_rulings;
drop policy if exists "Admins can delete rulings" on public.card_rulings;

create policy "rulings_insert" on public.card_rulings
  for insert to authenticated
  with check ('manage_rulings' = any(public.get_my_admin_permissions()));

create policy "rulings_update" on public.card_rulings
  for update to authenticated
  using ('manage_rulings' = any(public.get_my_admin_permissions()))
  with check ('manage_rulings' = any(public.get_my_admin_permissions()));

create policy "rulings_delete" on public.card_rulings
  for delete to authenticated
  using ('manage_rulings' = any(public.get_my_admin_permissions()));

-- discord_ruling_messages: manage_rulings. The sync cron writes with the
-- service role (bypasses RLS); these cover admin-side writes only.
drop policy if exists "Admins can insert discord messages" on public.discord_ruling_messages;
drop policy if exists "Admins can update discord messages" on public.discord_ruling_messages;

create policy "discord_rulings_insert" on public.discord_ruling_messages
  for insert to authenticated
  with check ('manage_rulings' = any(public.get_my_admin_permissions()));

create policy "discord_rulings_update" on public.discord_ruling_messages
  for update to authenticated
  using ('manage_rulings' = any(public.get_my_admin_permissions()))
  with check ('manage_rulings' = any(public.get_my_admin_permissions()));

-- duplicate_card_groups / duplicate_card_group_members: manage_cards
-- (app/admin/cards/actions.ts)
drop policy if exists "Admins can insert duplicate groups" on public.duplicate_card_groups;
drop policy if exists "Admins can update duplicate groups" on public.duplicate_card_groups;
drop policy if exists "Admins can delete duplicate groups" on public.duplicate_card_groups;

create policy "dup_groups_insert" on public.duplicate_card_groups
  for insert to authenticated
  with check ('manage_cards' = any(public.get_my_admin_permissions()));

create policy "dup_groups_update" on public.duplicate_card_groups
  for update to authenticated
  using ('manage_cards' = any(public.get_my_admin_permissions()))
  with check ('manage_cards' = any(public.get_my_admin_permissions()));

create policy "dup_groups_delete" on public.duplicate_card_groups
  for delete to authenticated
  using ('manage_cards' = any(public.get_my_admin_permissions()));

drop policy if exists "Admins can insert duplicate group members" on public.duplicate_card_group_members;
drop policy if exists "Admins can update duplicate group members" on public.duplicate_card_group_members;
drop policy if exists "Admins can delete duplicate group members" on public.duplicate_card_group_members;

create policy "dup_group_members_insert" on public.duplicate_card_group_members
  for insert to authenticated
  with check ('manage_cards' = any(public.get_my_admin_permissions()));

create policy "dup_group_members_update" on public.duplicate_card_group_members
  for update to authenticated
  using ('manage_cards' = any(public.get_my_admin_permissions()))
  with check ('manage_cards' = any(public.get_my_admin_permissions()));

create policy "dup_group_members_delete" on public.duplicate_card_group_members
  for delete to authenticated
  using ('manage_cards' = any(public.get_my_admin_permissions()));
