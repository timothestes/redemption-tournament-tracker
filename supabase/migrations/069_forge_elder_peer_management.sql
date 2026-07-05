-- Let elders fully manage other elders (invite / add / remove / change-role).
-- forge_role_outranks (defined in 049) is the single rank-cap gate shared by
-- forge_mint_invite, forge_add_member, forge_remove_member, and forge_change_role,
-- so widening the elder row here unlocks all four at once. Superadmin stays out of
-- reach for elders (not in the target list), and the 048 last-superadmin trigger
-- remains the backstop against demoting/removing the final superadmin.
create or replace function public.forge_role_outranks(actor_role text, target_role text)
returns boolean language sql immutable set search_path = '' as $$
  select case actor_role
    when 'superadmin' then target_role in ('elder','playtester')
    when 'elder'      then target_role in ('elder','playtester')
    else false
  end;
$$;
