-- 062_superuser_admin_portal.sql
-- Superuser-only management of admin_users permissions (spec:
-- docs/superpowers/specs/2026-07-03-superuser-admin-portal-design.md).
-- The app superuser is ONE hardcoded auth.users id (baboonytim); changing it
-- requires a migration by design, so the portal can never lock him out.

-- 1) Superuser identity check -----------------------------------------------
create or replace function public.is_superuser()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() = '6d30f6e3-838e-4f11-9416-95996da6e5b9'::uuid
$$;

revoke execute on function public.is_superuser() from public, anon;
grant execute on function public.is_superuser() to authenticated;

-- 2) Defensive: permissions column exists in prod but was never declared in
--    migration 005; declare it for fresh environments.
alter table public.admin_users
  add column if not exists permissions text[] not null default '{}';

-- 3) Close the 005 hole: any admin could INSERT/DELETE admin_users rows
--    directly. Nothing in app code uses direct table access (reads go via the
--    definer RPCs check_admin_role / get_my_admin_permissions); from now on
--    writes go ONLY via the super_* RPCs below.
drop policy if exists "Admins can view admin list" on public.admin_users;
drop policy if exists "Admins can add new admins" on public.admin_users;
drop policy if exists "Admins can remove admins" on public.admin_users;
revoke select, insert, update, delete on table public.admin_users from anon, authenticated;

-- 4) super_list_admins -------------------------------------------------------
create or replace function public.super_list_admins()
returns table (
  user_id uuid,
  username text,
  email text,
  permissions text[],
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  return query
    select au.user_id,
           p.username,
           u.email::text,
           coalesce(au.permissions, '{}'),
           au.created_at
    from public.admin_users au
    join auth.users u on u.id = au.user_id
    left join public.profiles p on p.id = au.user_id
    order by au.created_at;
end;
$$;

-- 5) super_search_users ------------------------------------------------------
create or replace function public.super_search_users(p_query text)
returns table (
  user_id uuid,
  username text,
  email text,
  is_admin boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  if length(q) < 2 then
    return;
  end if;
  return query
    select u.id,
           p.username,
           u.email::text,
           exists (select 1 from public.admin_users au where au.user_id = u.id)
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.email ilike '%' || q || '%'
       or p.username ilike '%' || q || '%'
    order by u.email
    limit 20;
end;
$$;

-- 6) super_set_admin_permissions ----------------------------------------------
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
    'manage_cards','manage_rulings','threshing_floor'
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

-- 7) super_remove_admin -------------------------------------------------------
create or replace function public.super_remove_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  delete from public.admin_users where user_id = p_user_id;
end;
$$;

-- 8) Lock down EXECUTE on the definer RPCs ------------------------------------
revoke execute on function public.super_list_admins() from public, anon;
revoke execute on function public.super_search_users(text) from public, anon;
revoke execute on function public.super_set_admin_permissions(uuid, text[]) from public, anon;
revoke execute on function public.super_remove_admin(uuid) from public, anon;
grant execute on function public.super_list_admins() to authenticated;
grant execute on function public.super_search_users(text) to authenticated;
grant execute on function public.super_set_admin_permissions(uuid, text[]) to authenticated;
grant execute on function public.super_remove_admin(uuid) to authenticated;
