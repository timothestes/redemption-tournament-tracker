-- 084: QR join + decklist submissions.
-- New surface is default-deny: service-role only, accessed via server actions.

-- 1) Link participants to accounts (host manual adds keep NULL).
alter table public.participants
  add column user_id uuid references auth.users(id) on delete set null;

create unique index participants_tournament_user_uniq
  on public.participants (tournament_id, user_id)
  where user_id is not null;

-- 2) Tournament policy knobs. code (join code) already exists + UNIQUE.
alter table public.tournaments
  add column require_decklists boolean not null default false,
  add column results_published boolean not null default false;

-- 3) The immutable submission record. Default-deny by construction.
create table public.tournament_deck_submissions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  deck_id uuid references public.decks(id) on delete set null, -- provenance only
  submitted_by uuid references auth.users(id) on delete set null,
  source text not null check (source in ('player', 'host')),
  deck_snapshot jsonb not null,
  is_legal boolean,
  deckcheck_issues jsonb,
  submitted_at timestamptz not null default now()
);
alter table public.tournament_deck_submissions enable row level security;
revoke all on public.tournament_deck_submissions from anon, authenticated;
-- No policies on purpose: service-role only (forge_invites precedent, 049).

-- 4) Rejoin blocks ("Remove & block").
create table public.tournament_join_blocks (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
alter table public.tournament_join_blocks enable row level security;
revoke all on public.tournament_join_blocks from anon, authenticated;

-- 5) Fix submission rot: deleting a live deck must not destroy the event
-- record. published_deck_id is already SET NULL; deck_id was CASCADE.
alter table public.tournament_decklists
  alter column deck_id drop not null;
alter table public.tournament_decklists
  drop constraint tournament_decklists_deck_id_fkey;
alter table public.tournament_decklists
  add constraint tournament_decklists_deck_id_fkey
  foreign key (deck_id) references public.decks(id) on delete set null;

-- 6) Atomic join. Locks the tournament row so joins serialize against the
-- host's Start update (has_started); inserts participant + submission +
-- decklist link in one transaction. Service-role only.
create or replace function public.tournament_qr_join(
  p_code text,
  p_user_id uuid,
  p_display_name text,
  p_deck_id uuid,
  p_snapshot jsonb,
  p_is_legal boolean,
  p_issues jsonb,
  p_resubmit boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_participant_id uuid;
begin
  select id, has_started, require_decklists into v_t
    from public.tournaments
    where code = p_code
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_t.has_started then
    return jsonb_build_object('ok', false, 'error', 'started');
  end if;
  if exists (
    select 1 from public.tournament_join_blocks b
    where b.tournament_id = v_t.id and b.user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  if v_t.require_decklists and p_snapshot is null then
    return jsonb_build_object('ok', false, 'error', 'decklist_required');
  end if;

  select id into v_participant_id
    from public.participants
    where tournament_id = v_t.id and user_id = p_user_id;

  if p_resubmit then
    if v_participant_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_joined');
    end if;
  else
    if v_participant_id is not null then
      return jsonb_build_object('ok', false, 'error', 'already_joined');
    end if;
    insert into public.participants (tournament_id, name, user_id)
      values (v_t.id, p_display_name, p_user_id)
      returning id into v_participant_id;
  end if;

  if p_snapshot is not null then
    insert into public.tournament_deck_submissions
      (tournament_id, participant_id, deck_id, submitted_by, source,
       deck_snapshot, is_legal, deckcheck_issues)
    values
      (v_t.id, v_participant_id, p_deck_id, p_user_id, 'player',
       p_snapshot, p_is_legal, p_issues)
    on conflict (participant_id) do update set
      deck_id = excluded.deck_id,
      submitted_by = excluded.submitted_by,
      source = excluded.source,
      deck_snapshot = excluded.deck_snapshot,
      is_legal = excluded.is_legal,
      deckcheck_issues = excluded.deckcheck_issues,
      submitted_at = now();

    if p_deck_id is not null then
      insert into public.tournament_decklists (tournament_id, participant_id, deck_id)
        values (v_t.id, v_participant_id, p_deck_id)
        on conflict (participant_id) do update set deck_id = excluded.deck_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'participant_id', v_participant_id);
end
$$;

revoke execute on function public.tournament_qr_join(text, uuid, text, uuid, jsonb, boolean, jsonb, boolean)
  from public, anon, authenticated;
