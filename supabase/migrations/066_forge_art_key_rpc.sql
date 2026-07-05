-- 066_forge_art_key_rpc.sql
-- Collapse the /forge/api/art per-image lookup chain (my_forge_role RPC +
-- forge_cards select + card_versions select — three sequential PostgREST round
-- trips) into one RPC. Perf only: in forge play mode the image preloader fires
-- dozens of art requests at once and each paid four Supabase round trips before
-- the blob read; this makes it one.
--
-- SECURITY INVOKER on purpose: the reads below stay subject to the 057 RLS
-- policies (granted playtesters see only published/approved snapshots of
-- granted cards), so this cannot return anything the caller couldn't already
-- SELECT. The my_forge_role() gate mirrors requireForge's member check.
-- Key-resolution rules mirror app/forge/api/art/[cardId]/route.ts exactly.
-- SCHEMA + FUNCTION ONLY — no data.

create or replace function public.forge_art_key(
  p_card_id uuid,
  p_approved boolean,
  p_kind text
) returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_key text;
begin
  if coalesce(public.my_forge_role(), '') not in ('superadmin', 'elder', 'playtester') then
    return null;
  end if;

  if p_approved then
    -- Approved view: approved snapshot if finalized, else published (in-testing).
    select coalesce(c.approved_version_id, c.published_version_id)
      into v_version_id
      from public.forge_cards c
     where c.id = p_card_id;
    if v_version_id is null then
      return null;
    end if;

    if p_kind = 'finished' then
      select v.finished_key
        into v_key
        from public.card_versions v
       where v.id = v_version_id;
    else
      select case when v.art_is_placeholder then null
                  else coalesce(v.art_original_key, v.art_key) end
        into v_key
        from public.card_versions v
       where v.id = v_version_id;
    end if;
  else
    if p_kind = 'finished' then
      select c.working_finished_key into v_key
        from public.forge_cards c where c.id = p_card_id;
    else
      select c.working_art_key into v_key
        from public.forge_cards c where c.id = p_card_id;
    end if;
  end if;

  return v_key;
end;
$$;

-- Supabase's default privileges grant EXECUTE directly to anon on new public
-- functions; strip it explicitly (cf. 048) so anon cannot even probe this.
revoke execute on function public.forge_art_key(uuid, boolean, text) from public, anon;
grant execute on function public.forge_art_key(uuid, boolean, text) to authenticated;
