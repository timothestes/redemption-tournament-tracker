-- 101_forge_art_candidate_source_url.sql
-- Optional source URL per art candidate — where the designer found/sourced
-- the image. Distinct from forge_cards.artist_credit, which is a printed
-- illustrator credit, not a source link. ADDITIVE ONLY (cf. 082).

alter table public.forge_card_art_candidates
  add column if not exists source_url text;

-- Set/clear a candidate's source URL. Same owner/superadmin/set-elder gate as
-- forge_delete_art_candidate (cf. 082). Empty/whitespace clears it.
create or replace function public.forge_set_art_candidate_source(p_candidate_id uuid, p_source_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card_id uuid;
begin
  select a.card_id into v_card_id
    from public.forge_card_art_candidates a where a.id = p_candidate_id;
  if v_card_id is null then
    raise exception 'no such candidate';
  end if;
  if not exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_card_art_candidates
    set source_url = nullif(trim(p_source_url), '')
    where id = p_candidate_id;
end; $$;

revoke execute on function public.forge_set_art_candidate_source(uuid, text) from public, anon;
grant execute on function public.forge_set_art_candidate_source(uuid, text) to authenticated;
