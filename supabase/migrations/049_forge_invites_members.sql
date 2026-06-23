-- Forge access layer, part 2: invites, audit, and the membership-management RPCs.
-- Builds on 048 (playtest_members, playtest_role, my_forge_role / is_forge_* helpers,
-- last-superadmin trigger). SCHEMA + FUNCTIONS ONLY — no card data.

-- 0) Record the NDA acknowledgment on the membership row (stamped at redeem).
alter table public.playtest_members add column if not exists nda_agreed_at timestamptz;

-- 1) Invites. Hash-only token. This table has NO authenticated RLS policy: it is a
--    secret store reachable only through the SECURITY DEFINER RPCs below (mirrors
--    api_keys / migration 030). anon is default-denied + explicit revoke.
create table if not exists public.forge_invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role       public.playtest_role not null,
  set_ids    uuid[] not null default '{}',   -- stored for 1a.5; not consumed yet
  email      text,                            -- optional bind to a specific address
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.forge_invites enable row level security;
revoke all on public.forge_invites from anon;

-- 2) Minimal audit. Write-only via definer RPCs; elders+ may read.
create table if not exists public.forge_audit (
  id     bigserial primary key,
  actor  uuid not null references auth.users(id),
  action text not null,
  target text,
  at     timestamptz not null default now()
);
alter table public.forge_audit enable row level security;
drop policy if exists "forge_audit_select" on public.forge_audit;
create policy "forge_audit_select" on public.forge_audit
  for select to authenticated
  using (public.is_forge_elder_or_super());
revoke all on public.forge_audit from anon;
grant select on public.forge_audit to authenticated;

-- 3) Role-cap helper (pure logic, no table access).
create or replace function public.forge_role_outranks(actor_role text, target_role text)
returns boolean language sql immutable set search_path = '' as $$
  select case actor_role
    when 'superadmin' then target_role in ('elder','playtester')
    when 'elder'      then target_role = 'playtester'
    else false
  end;
$$;

-- 4) Mint an invite. Caller's role caps the grantable role. Stores hash only.
create or replace function public.forge_mint_invite(
  p_token_hash text, p_role public.playtest_role, p_set_ids uuid[],
  p_email text, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.forge_role_outranks(public.my_forge_role(), p_role::text) then
    raise exception 'not authorized to mint a % invite', p_role;
  end if;
  insert into public.forge_invites (token_hash, role, set_ids, email, invited_by, expires_at)
  values (p_token_hash, p_role, coalesce(p_set_ids, '{}'), p_email, auth.uid(),
          coalesce(p_expires_at, now() + interval '7 days'))
  returning id into v_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'invite_minted', v_id::text);
  return v_id;
end; $$;

-- 5) Redeem an invite. Authenticated caller becomes a member after acknowledging
--    the NDA (p_nda_agreed). NO ORACLE: every failure path returns NULL
--    (no-agreement/bad/expired/used/email-mismatch are indistinguishable).
create or replace function public.forge_redeem_invite(p_token_hash text, p_nda_agreed boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_invite public.forge_invites;
begin
  if not coalesce(p_nda_agreed, false) then return null; end if;  -- must accept the NDA
  select * into v_invite from public.forge_invites
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   for update;
  if not found then return null; end if;
  if v_invite.email is not null and v_invite.email is distinct from auth.email() then
    return null;  -- email-bound to someone else; same not-found result
  end if;
  insert into public.playtest_members (user_id, role, invited_by, nda_agreed_at)
  values (auth.uid(), v_invite.role, v_invite.invited_by, now())
  on conflict (user_id) do nothing;
  update public.forge_invites set used_at = now() where id = v_invite.id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_added', v_invite.id::text);
  return v_invite.role::text;
end; $$;

-- 6) Direct membership management (no invite). All role-capped against the caller.
--    add_member is INSERT-only (use change_role to modify an existing member —
--    otherwise an elder could downgrade an elder via add_member, bypassing the cap).
create or replace function public.forge_add_member(p_user_id uuid, p_role public.playtest_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.forge_role_outranks(public.my_forge_role(), p_role::text) then
    raise exception 'not authorized to add a % member', p_role;
  end if;
  if exists (select 1 from public.playtest_members where user_id = p_user_id) then
    raise exception 'already a member; use change_role';
  end if;
  insert into public.playtest_members (user_id, role, invited_by)
  values (p_user_id, p_role, auth.uid());
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_added', p_user_id::text);
end; $$;

create or replace function public.forge_remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target_role text;
begin
  select role::text into v_target_role from public.playtest_members where user_id = p_user_id;
  if v_target_role is null then raise exception 'not a member'; end if;
  if not public.forge_role_outranks(public.my_forge_role(), v_target_role) then
    raise exception 'not authorized to remove a % member', v_target_role;
  end if;
  -- FORWARD DEPENDENCY: card/set ownership reassignment lands when forge_cards/
  -- forge_sets exist (plans 1a.4/1a.5). Deleting the membership row already revokes
  -- all access via RLS — the security-critical effect. The last-superadmin trigger
  -- (048) backstops removal of the final superadmin.
  delete from public.playtest_members where user_id = p_user_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_removed', p_user_id::text);
end; $$;

create or replace function public.forge_change_role(p_user_id uuid, p_new_role public.playtest_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_caller text := public.my_forge_role(); v_current text;
begin
  select role::text into v_current from public.playtest_members where user_id = p_user_id;
  if v_current is null then raise exception 'not a member'; end if;
  if not public.forge_role_outranks(v_caller, v_current)
     or not public.forge_role_outranks(v_caller, p_new_role::text) then
    raise exception 'not authorized to change this member''s role';
  end if;
  -- last-superadmin demotion is backstopped by the 048 trigger.
  update public.playtest_members set role = p_new_role where user_id = p_user_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'role_changed', p_user_id::text || ' -> ' || p_new_role::text);
end; $$;

-- 7) Self-service profile (display_name + avatar only; never role).
create or replace function public.forge_set_profile(p_display_name text, p_avatar_url text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.playtest_members
     set display_name = p_display_name, avatar_url = p_avatar_url
   where user_id = auth.uid();
  if not found then raise exception 'not a member'; end if;
end; $$;

-- 8) Admin read: invites WITHOUT token_hash (elders+ only; empty for everyone else).
create or replace function public.forge_list_invites()
returns table(id uuid, role public.playtest_role, email text, set_ids uuid[],
              invited_by uuid, expires_at timestamptz, used_at timestamptz, created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select id, role, email, set_ids, invited_by, expires_at, used_at, created_at
  from public.forge_invites
  where public.is_forge_elder_or_super()
  order by created_at desc;
$$;

-- 9) Lock down execute: strip anon (Supabase default-grants it directly), grant authenticated.
revoke execute on function public.forge_role_outranks(text, text) from public, anon;
revoke execute on function public.forge_mint_invite(text, public.playtest_role, uuid[], text, timestamptz) from public, anon;
revoke execute on function public.forge_redeem_invite(text, boolean) from public, anon;
revoke execute on function public.forge_add_member(uuid, public.playtest_role) from public, anon;
revoke execute on function public.forge_remove_member(uuid) from public, anon;
revoke execute on function public.forge_change_role(uuid, public.playtest_role) from public, anon;
revoke execute on function public.forge_set_profile(text, text) from public, anon;
revoke execute on function public.forge_list_invites() from public, anon;

grant execute on function public.forge_role_outranks(text, text) to authenticated;
grant execute on function public.forge_mint_invite(text, public.playtest_role, uuid[], text, timestamptz) to authenticated;
grant execute on function public.forge_redeem_invite(text, boolean) to authenticated;
grant execute on function public.forge_add_member(uuid, public.playtest_role) to authenticated;
grant execute on function public.forge_remove_member(uuid) to authenticated;
grant execute on function public.forge_change_role(uuid, public.playtest_role) to authenticated;
grant execute on function public.forge_set_profile(text, text) to authenticated;
grant execute on function public.forge_list_invites() to authenticated;
