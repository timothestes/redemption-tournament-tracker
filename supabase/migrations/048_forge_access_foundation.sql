-- Forge (private card design & playtesting) — access & security foundation.
-- Role enum + membership table, SECURITY DEFINER helpers, superadmin seed,
-- last-superadmin protection, default-deny RLS. SCHEMA ONLY — no card data.

-- 1) Role enum
do $$ begin
  create type public.playtest_role as enum ('superadmin','elder','playtester');
exception when duplicate_object then null; end $$;

-- 2) Membership (one row per member; highest role)
create table if not exists public.playtest_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         public.playtest_role not null,
  display_name text,
  avatar_url   text,
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

alter table public.playtest_members enable row level security;

-- 3) SECURITY DEFINER helpers. search_path pinned; reads the table outside the
--    caller's RLS so policies that call them don't recurse (cf. migration 009).
create or replace function public.my_forge_role()
returns text language sql security definer stable set search_path = '' as $$
  select role::text from public.playtest_members where user_id = auth.uid();
$$;

create or replace function public.forge_role_of(uid uuid)
returns text language sql security definer stable set search_path = '' as $$
  select role::text from public.playtest_members where user_id = uid;
$$;

create or replace function public.is_forge_member()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.playtest_members where user_id = auth.uid());
$$;

create or replace function public.is_forge_elder_or_super()
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    (select role from public.playtest_members where user_id = auth.uid())
      in ('elder','superadmin'), false);
$$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE directly to anon (and
-- authenticated) on new public functions, so a REVOKE FROM PUBLIC is not enough.
-- Strip anon explicitly so it cannot call these over REST (e.g. forge_role_of(uid)
-- would otherwise leak any member's role). authenticated keeps the grant below.
revoke execute on function public.my_forge_role() from public, anon;
revoke execute on function public.forge_role_of(uuid) from public, anon;
revoke execute on function public.is_forge_member() from public, anon;
revoke execute on function public.is_forge_elder_or_super() from public, anon;

grant execute on function public.my_forge_role() to authenticated;
grant execute on function public.forge_role_of(uuid) to authenticated;
grant execute on function public.is_forge_member() to authenticated;
grant execute on function public.is_forge_elder_or_super() to authenticated;

-- 4) Last-superadmin protection
create or replace function public.forge_protect_last_superadmin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare remaining int;
begin
  select count(*) into remaining
  from public.playtest_members
  where role = 'superadmin'
    and user_id <> coalesce(old.user_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if tg_op = 'DELETE' then
    if old.role = 'superadmin' and remaining = 0 then
      raise exception 'cannot remove the last superadmin';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.role = 'superadmin' and new.role <> 'superadmin' and remaining = 0 then
      raise exception 'cannot demote the last superadmin';
    end if;
    return new;
  end if;
  return null;
end;
$$;

-- Trigger function should never be callable as an RPC (revoke from both roles).
revoke execute on function public.forge_protect_last_superadmin() from public, anon, authenticated;

drop trigger if exists forge_protect_last_superadmin on public.playtest_members;
create trigger forge_protect_last_superadmin
  before update or delete on public.playtest_members
  for each row execute function public.forge_protect_last_superadmin();

-- 5) RLS: members may read the membership list. No direct write policy — writes
--    land in plan 1a.2 via SECURITY DEFINER RPCs. anon gets nothing.
drop policy if exists "forge_members_select" on public.playtest_members;
create policy "forge_members_select" on public.playtest_members
  for select to authenticated
  using (public.is_forge_member());

-- 6) Default-deny hardening for the public/anon role
revoke all on public.playtest_members from anon;
grant select on public.playtest_members to authenticated;

-- 7) Seed the superadmin (baboonytim). UID from migration 044. Fail loudly if
--    the auth.users row is missing. CONFIRM this UID is baboonytim before apply.
do $$
declare super uuid := '6d30f6e3-838e-4f11-9416-95996da6e5b9';
begin
  if not exists (select 1 from auth.users where id = super) then
    raise exception 'superadmin seed failed: no auth.users row for %', super;
  end if;
  insert into public.playtest_members (user_id, role, display_name)
  values (super, 'superadmin', 'baboonytim')
  on conflict (user_id) do update set role = 'superadmin';
end $$;
