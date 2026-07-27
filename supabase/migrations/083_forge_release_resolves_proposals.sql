-- 083: "Release update" resolves open proposals instead of orphaning them.
--
-- A card has ONE working draft, and two controls both mint a version from it:
-- "Propose changes" (forge_create_proposal -> an elder accepts) and "Release
-- update" (forge_publish_card). Release used to ignore open proposals, so
-- Propose-then-Release left a proposal whose base_version_id no longer matched
-- the card's latest version: it stayed 'open' (the set-grid badge kept
-- advertising it) and only on clicking Accept did forge_accept_proposal's
-- stale-base guard close it as 'superseded' and return null -- surfacing as
-- "out of date -- please re-propose" even though the content HAD shipped.
--
-- forge_publish_card now closes them in the same transaction as the version
-- insert:
--   * the oldest open proposal whose proposed_snapshot equals what is being
--     released closes as 'accepted', pointing at the new version -- the release
--     IS the acceptance, and History renders "Accepted -> vN" with the
--     proposal's summary beside the release note;
--   * every other open proposal closes as 'superseded'. Their base is stale the
--     moment this version lands, so they were unacceptable anyway; closing now
--     clears the badge honestly instead of erroring on the next click.
--
-- Deliberate choices:
--   * ONE accept per release (oldest by created_at). Two 'accepted' rows
--     pointing at one version would double-render in History.
--   * jsonb '=' for the match. Postgres normalizes jsonb, so key order and
--     numeric form do not matter; a ::text compare would miss the common case.
--   * The accept branch is gated on elder/superadmin. This function also admits
--     the card owner (072), while accepting is elder-only (075), so a non-elder
--     owner supersedes every open proposal and accepts none -- 'accepted' keeps
--     meaning "an elder decided". Unreachable through the app (publish() is
--     behind requireElder()), but the RPC is callable directly.
--   * resulting_version_id is NEVER set on a superseded row; History keys its
--     "-> vN" rendering off that column.
--   * The transaction-stable now() shared by both updates is what lets
--     deriveSupersededBy (app/forge/lib/historyView.ts) attribute the sweep to
--     the accepted proposal, exactly as forge_accept_proposal's own sibling
--     sweep does. With no match, it correctly falls back to "Out of date -- a
--     direct release replaced the version it was based on".
--
-- forge_accept_proposal is UNCHANGED: its stale-base guard stays as the
-- backstop for the concurrent-release race (someone releases while another
-- elder has the review open).
-- Body = 072 verbatim + the resolution block. Signature unchanged, so
-- CREATE OR REPLACE preserves existing grants.
-- Design: docs/superpowers/specs/2026-07-27-forge-release-resolves-proposals-design.md

create or replace function public.forge_publish_card(p_card_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_next int; v_version_id uuid;
        v_can_accept boolean; v_matched uuid;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to publish this card';
  end if;
  if v_card.set_id is null then raise exception 'only cards in a set can be published'; end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'only a draft or playtesting card can be published';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = p_card_id;
  update public.card_versions set status = 'superseded'
    where card_id = p_card_id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by, note)
  values
    (p_card_id, v_next, 'published', v_card.working_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id, status = 'playtesting', updated_at = now()
   where id = p_card_id;

  -- Resolve open proposals. The card row is locked FOR UPDATE above and
  -- forge_create_proposal takes FOR SHARE on it, so no proposal can be created
  -- between the version insert and this sweep.
  v_can_accept := public.is_forge_superadmin() or public.is_forge_set_elder(v_card.set_id);
  if v_can_accept then
    select id into v_matched
      from public.card_proposals
     where card_id = p_card_id
       and status = 'open'
       and proposed_snapshot = v_card.working_snapshot
     order by created_at, id
     limit 1
       for update;
    if v_matched is not null then
      update public.card_proposals
         set status = 'accepted', resulting_version_id = v_version_id,
             closed_at = now(), closed_by = auth.uid()
       where id = v_matched;
    end if;
  end if;

  -- The accepted row (if any) is no longer 'open', so this sweep skips it
  -- without needing to name it.
  update public.card_proposals
     set status = 'superseded', closed_at = now(), closed_by = auth.uid()
   where card_id = p_card_id and status = 'open';

  return v_version_id;
end; $$;
