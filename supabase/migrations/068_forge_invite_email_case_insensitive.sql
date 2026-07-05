-- Forge invites: make email binding case-insensitive.
--
-- Supabase Auth lowercases every account email, but the invite stored the
-- inviter's raw typed string and forge_redeem_invite compared it with a
-- case-sensitive `is distinct from`. An invite typed as `J.EarleyIII@gmail.com`
-- could therefore never be redeemed by the account `j.earleyiii@gmail.com`,
-- surfacing as "This invite link is invalid, expired, or already used."
--
-- Fix in three parts: normalize at mint, compare case-insensitively at redeem,
-- and backfill any invites already stored with mixed-case / padded emails.

-- 1) Normalize the email at mint time (lower + trim; empty -> null).
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
  values (p_token_hash, p_role, coalesce(p_set_ids, '{}'),
          nullif(lower(trim(p_email)), ''), auth.uid(),
          coalesce(p_expires_at, now() + interval '7 days'))
  returning id into v_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'invite_minted', v_id::text);
  return v_id;
end; $$;

-- 2) Compare the email binding case-insensitively at redeem time. Body is
--    identical to migration 055 except the email guard uses lower() on both sides.
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

-- 3) Backfill existing invites whose stored email is not already normalized.
update public.forge_invites
set email = lower(trim(email))
where email is not null
  and email is distinct from lower(trim(email));
