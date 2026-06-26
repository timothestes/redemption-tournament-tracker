-- 057_forge_reveal_playtesting.sql
-- Reveal cards in the 'playtesting' state to GRANTED playtesters, not just 'approved'
-- ones. Before this, a card whose status was 'playtesting' was invisible to playtesters,
-- so it could never actually be playtested (the lifecycle's whole point). Now:
--   draft        -> elders only
--   playtesting  -> granted playtesters can SEE + test it (frozen PUBLISHED snapshot)
--   approved     -> final/locked; granted playtesters keep seeing it (APPROVED snapshot)
--
-- We only relax the GRANTED-playtester branch of each SELECT policy. The owner /
-- superadmin / set-elder branches are reproduced verbatim from migration 052 and are
-- unchanged. Superseded/archived/private versions stay hidden (only 'published' and
-- 'approved' versions are exposed, and those only exist for playtesting/approved cards).

-- card_versions SELECT: granted playtesters may read the published OR approved snapshot
drop policy if exists "card_versions_select" on public.card_versions;
create policy "card_versions_select" on public.card_versions
  for select to authenticated
  using (exists (
    select 1 from public.forge_cards c
    where c.id = card_versions.card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id))
           or (c.set_id is not null
               and card_versions.status in ('published','approved')
               and public.is_forge_set_granted(c.set_id)))
  ));

-- forge_cards SELECT: granted playtesters may read playtesting OR approved cards
drop policy if exists "forge_cards_select" on public.forge_cards;
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated
  using (owner_id = auth.uid()
         or public.is_forge_superadmin()
         or (set_id is not null and public.is_forge_set_elder(set_id))
         or (set_id is not null
             and status in ('playtesting','approved')
             and public.is_forge_set_granted(set_id)));
</content>
