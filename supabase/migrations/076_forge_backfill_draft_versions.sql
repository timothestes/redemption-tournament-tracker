-- 076: mint 'draft' versions for 073-era draft accepts that folded into the
-- working draft without minting a version (measured scope at authoring time:
-- exactly one accepted proposal, c921068f-…, on a card with zero versions).
-- Guard: only cards with NO existing versions — avoids renumbering under a
-- later release; cards released in the interim keep the gap. Numbered by
-- closed_at order; author/time taken from the accept. Art keys are
-- unknowable retroactively and stay null. Idempotent by the resulting_
-- version_id / not-exists guards.
with lost as (
  select p.id, p.card_id, p.proposed_snapshot, p.closed_by, p.closed_at,
         row_number() over (partition by p.card_id order by p.closed_at) as rn
  from public.card_proposals p
  where p.status = 'accepted' and p.resulting_version_id is null
    and not exists (select 1 from public.card_versions v where v.card_id = p.card_id)
), minted as (
  insert into public.card_versions (card_id, version_number, status, data, created_by, created_at)
  select card_id, rn, 'draft', proposed_snapshot, closed_by, closed_at from lost
  returning id, card_id, version_number
)
update public.card_proposals p
   set resulting_version_id = m.id
  from minted m join lost l on l.card_id = m.card_id and l.rn = m.version_number
 where p.id = l.id;
