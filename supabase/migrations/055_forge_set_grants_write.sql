-- 055_forge_set_grants_write.sql
-- Phase 2.1: activate the dormant forge_set_grants plumbing (shipped read-only in 052).
-- Adds grant/revoke RPCs (set-elder or superadmin), makes invite redemption consume the
-- invite's stored set_ids, and lets a playtester read their own grant rows.
-- All functions: SECURITY DEFINER, SET search_path='', anon-revoked (cf. 052).

-- 1) Grant a member read access to a set's approved cards.
create or replace function public.forge_grant_set(p_set_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not authorized to grant this set';
  end if;
  if not exists (select 1 from public.playtest_members where user_id = p_user_id) then
    raise exception 'not a member';
  end if;
  insert into public.forge_set_grants (set_id, user_id, granted_by)
  values (p_set_id, p_user_id, auth.uid())
  on conflict (set_id, user_id) do nothing;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_granted', p_set_id::text || ' -> ' || p_user_id::text);
end; $$;

-- 2) Revoke a member's access to a set.
create or replace function public.forge_revoke_set(p_set_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not authorized to revoke this set';
  end if;
  delete from public.forge_set_grants where set_id = p_set_id and user_id = p_user_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_revoked', p_set_id::text || ' -> ' || p_user_id::text);
end; $$;

-- 3) Redeem now also consumes the invite's stored set_ids (grants in the same txn).
--    Unchanged from 049 except the set-grant loop. Defends against a since-deleted set
--    (the EXISTS guard) so a stale set_id can't abort an otherwise-valid redemption.
create or replace function public.forge_redeem_invite(p_token_hash text, p_nda_agreed boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_invite public.forge_invites; v_set_id uuid;
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
  foreach v_set_id in array coalesce(v_invite.set_ids, '{}') loop
    insert into public.forge_set_grants (set_id, user_id, granted_by)
    select v_set_id, auth.uid(), v_invite.invited_by
    where exists (select 1 from public.forge_sets s where s.id = v_set_id)
    on conflict (set_id, user_id) do nothing;
  end loop;
  update public.forge_invites set used_at = now() where id = v_invite.id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_added', v_invite.id::text);
  return v_invite.role::text;
end; $$;

-- 4) Let a member read their own grant rows (resolves the 1a.5 "own-row read" follow-up).
drop policy if exists "forge_set_grants_select" on public.forge_set_grants;
create policy "forge_set_grants_select" on public.forge_set_grants
  for select to authenticated
  using (public.is_forge_set_elder(set_id)
         or public.is_forge_superadmin()
         or user_id = auth.uid());

-- 5) Lock down execute on the new functions (anon default-grant stripped; cf. 052).
revoke execute on function public.forge_grant_set(uuid, uuid) from public, anon;
revoke execute on function public.forge_revoke_set(uuid, uuid) from public, anon;
grant execute on function public.forge_grant_set(uuid, uuid) to authenticated;
grant execute on function public.forge_revoke_set(uuid, uuid) to authenticated;
-- forge_redeem_invite keeps its 049 grant (CREATE OR REPLACE preserves it); re-grant defensively.
grant execute on function public.forge_redeem_invite(text, boolean) to authenticated;
