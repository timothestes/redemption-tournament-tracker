-- 099_fix_redeem_poster_invite_array_append.sql
-- Fixes a bug in 097's redeem_poster_invite, found by the live-DB guardrail
-- test in __tests__/poster-invites-leak.test.ts.
--
-- `admin_users.permissions || 'publish_posts'` is ambiguous in Postgres: `||`
-- has both an anyarray||anyarray and an anyarray||anyelement overload, and an
-- untyped string literal on the right resolves against the array overload —
-- Postgres tries to parse the string itself as an array literal via
-- array_in(), which fails (22P02: "malformed array literal"). This happens at
-- parse/plan time for the whole CASE expression, so it fires on every call,
-- not just the branch that would take it. Verified directly against
-- production: every successful-redemption path (first insert, merge into an
-- existing row, open invite) returned null/error instead of true.
--
-- Fix: array_append, the same pattern already used in migrations 016 and 045
-- for exactly this reason.

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
      else array_append(admin_users.permissions, 'publish_posts')
    end;
  update public.poster_invites set used_at = now() where id = v_invite.id;
  return true;
end;
$$;
