-- Forge members: default display_name from the profile username.
--
-- forge_redeem_invite inserted the playtest_members row with no display_name,
-- so invite-redeemed members rendered as "—" in the admin member list and
-- set-access grid until they set a Forge profile. Default it to the member's
-- site username at redeem time (still editable via forge_set_profile), and
-- backfill members already missing one.

-- 1) Redeem now seeds display_name from profiles.username. Body is identical
--    to migration 068 except the playtest_members insert.
create or replace function public.forge_redeem_invite(
  p_token_hash text, p_nda_agreed boolean
) returns text language plpgsql security definer set search_path = '' as $$
declare v_invite public.forge_invites; v_set_id uuid;
begin
  if not coalesce(p_nda_agreed, false) then return null; end if;  -- must accept the NDA
  select * into v_invite from public.forge_invites
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   for update;
  if not found then return null; end if;
  if v_invite.email is not null and lower(v_invite.email) is distinct from lower(auth.email()) then
    return null;  -- email-bound to someone else; Supabase lowercases auth emails
  end if;
  insert into public.playtest_members (user_id, role, invited_by, nda_agreed_at, display_name)
  values (auth.uid(), v_invite.role, v_invite.invited_by, now(),
          (select nullif(trim(p.username), '') from public.profiles p where p.id = auth.uid()))
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

-- 2) Backfill members with no display name from their profile username.
update public.playtest_members pm
set display_name = nullif(trim(p.username), '')
from public.profiles p
where p.id = pm.user_id
  and nullif(btrim(pm.display_name), '') is null
  and nullif(trim(p.username), '') is not null;
