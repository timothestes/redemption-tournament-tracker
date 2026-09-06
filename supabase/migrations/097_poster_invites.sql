-- 097_poster_invites.sql
-- Scalable poster invites, modeled on forge_invites (049). Spec:
-- docs/superpowers/specs/2026-09-06-poster-invites-author-profile-design.md

create table public.poster_invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email      text,                          -- optional bind to a specific address
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.poster_invites enable row level security;
revoke all on public.poster_invites from anon, authenticated;

-- Mint: superuser-only. Stores a hash of the raw token; the raw token is
-- never persisted (mirrors forge_mint_invite).
create or replace function public.mint_poster_invite(p_token_hash text, p_email text, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  insert into public.poster_invites (token_hash, email, invited_by, expires_at)
  values (p_token_hash, p_email, auth.uid(), coalesce(p_expires_at, now() + interval '7 days'))
  returning id into v_id;
  return v_id;
end;
$$;

-- Redeem: any authenticated caller. No oracle — every failure path (bad
-- token, wrong bound email, expired, already used) returns false, mirroring
-- forge_redeem_invite's "every failure path returns the same thing" rule.
-- Merges 'publish_posts' into the caller's existing admin_users row (or
-- creates one) rather than overwriting other permissions they may hold.
create or replace function public.redeem_poster_invite(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_invite public.poster_invites;
begin
  select * into v_invite from public.poster_invites
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   for update;
  if not found then return false; end if;
  if v_invite.email is not null and v_invite.email is distinct from auth.email() then
    return false;  -- email-bound to someone else; same false as any other failure
  end if;
  insert into public.admin_users (user_id, permissions, created_by)
  values (auth.uid(), array['publish_posts'], v_invite.invited_by)
  on conflict (user_id) do update
    set permissions = case
      when 'publish_posts' = any(admin_users.permissions) then admin_users.permissions
      else admin_users.permissions || 'publish_posts'
    end;
  update public.poster_invites set used_at = now() where id = v_invite.id;
  return true;
end;
$$;

-- Admin read: invites WITHOUT token_hash, superuser only (empty for everyone else).
create or replace function public.list_poster_invites()
returns table(id uuid, email text, invited_by uuid, expires_at timestamptz, used_at timestamptz, created_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select id, email, invited_by, expires_at, used_at, created_at
  from public.poster_invites
  where public.is_superuser()
  order by created_at desc;
$$;

revoke execute on function public.mint_poster_invite(text, text, timestamptz) from public, anon;
revoke execute on function public.redeem_poster_invite(text) from public, anon;
revoke execute on function public.list_poster_invites() from public, anon;
grant execute on function public.mint_poster_invite(text, text, timestamptz) to authenticated;
grant execute on function public.redeem_poster_invite(text) to authenticated;
grant execute on function public.list_poster_invites() to authenticated;
