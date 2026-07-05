-- 065_forge_create_card_in_set.sql
-- Create a card that is already placed in a set, in one atomic step. This is the
-- direct "New card in this set" affordance on the set cards page. It mirrors
-- forge_create_card + forge_share_card_to_set (cf. 050, 052) but avoids the
-- orphan-idea window where the card exists outside any set if the share fails.
-- Set-elder (or superadmin) only — the same gate forge_share_card_to_set uses.
-- The card starts at status 'draft', exactly as a freshly-shared idea would.
-- SCHEMA + FUNCTION ONLY — no data.

create or replace function public.forge_create_card_in_set(p_title text, p_set_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on the target set';
  end if;
  insert into public.forge_cards (owner_id, title, set_id, status)
  values (auth.uid(), nullif(btrim(p_title), ''), p_set_id, 'draft')
  returning id into v_id;
  return v_id;
end; $$;

revoke execute on function public.forge_create_card_in_set(text, uuid) from public, anon;
grant execute on function public.forge_create_card_in_set(text, uuid) to authenticated;
