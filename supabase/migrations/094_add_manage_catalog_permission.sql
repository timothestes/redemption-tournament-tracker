-- 094_add_manage_catalog_permission.sql
-- New admin permission 'manage_catalog': edit the public card catalog
-- (/admin/catalog → card_overrides + card_image_versions) without being THE
-- superuser. The superuser keeps access regardless of their admin_users row.

-- 1) Allowlist. Redefines super_set_admin_permissions verbatim from 087 (the
--    latest definition), adding the one new key.
--    Allowlist MIRRORS app/admin/permissions/lib/permissions.ts — update both together.
create or replace function public.super_set_admin_permissions(p_user_id uuid, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed constant text[] := array[
    'manage_registrations','manage_tags','manage_spoilers',
    'manage_cards','manage_rulings','threshing_floor','manage_shopify_imports',
    'manage_catalog'
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

-- 2) Catalog tables: superuser OR manage_catalog. Uses the SECURITY DEFINER
--    helper from 010 — never an inline subquery against admin_users (see 093).
drop policy if exists "card_overrides_superuser" on public.card_overrides;
create policy "card_overrides_catalog_editors" on public.card_overrides
  for all to authenticated
  using (public.is_superuser() or 'manage_catalog' = any(public.get_my_admin_permissions()))
  with check (public.is_superuser() or 'manage_catalog' = any(public.get_my_admin_permissions()));

drop policy if exists "card_image_versions_superuser" on public.card_image_versions;
create policy "card_image_versions_catalog_editors" on public.card_image_versions
  for all to authenticated
  using (public.is_superuser() or 'manage_catalog' = any(public.get_my_admin_permissions()))
  with check (public.is_superuser() or 'manage_catalog' = any(public.get_my_admin_permissions()));
