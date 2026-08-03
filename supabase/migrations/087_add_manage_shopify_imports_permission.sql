-- Add 'manage_shopify_imports' to the super_set_admin_permissions allowlist.
-- Redefines the function verbatim from 062_superuser_admin_portal.sql (the
-- latest/only prior definition), adding the one new permission key.
-- Allowlist MIRRORS app/admin/permissions/lib/permissions.ts — update both together.
create or replace function public.super_set_admin_permissions(p_user_id uuid, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed constant text[] := array[
    'manage_registrations','manage_tags','manage_spoilers',
    'manage_cards','manage_rulings','threshing_floor','manage_shopify_imports'
  ];
  perm text;
  perms text[] := coalesce(p_permissions, '{}');
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  foreach perm in array perms loop
    if not (perm = any(allowed)) then
      raise exception 'unknown permission: %', perm;
    end if;
  end loop;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'no such user';
  end if;
  insert into public.admin_users (user_id, permissions, created_by)
  values (p_user_id, perms, auth.uid())
  on conflict (user_id) do update set permissions = excluded.permissions;
end;
$$;

revoke execute on function public.super_set_admin_permissions(uuid, text[]) from public, anon;
grant execute on function public.super_set_admin_permissions(uuid, text[]) to authenticated;
