-- Where the tournament is held. Until now the city existed only inside the
-- generated name (the " — {City}" suffix), recovered by string-splitting a
-- sibling's name when adding a category to an existing event. That made the
-- name the source of truth for a piece of data the name is supposed to
-- *render*. These columns invert that: the name is built from them.
--
-- Free text, mirroring tournament_listings.city/state, which is where these
-- values come from when hosting from a listing. Prod listings use two-letter
-- state codes ("MA", "OR", "TX"); utils/tournament/usStates.ts holds the
-- canonical list and normalizer, and the column stays permissive so a value
-- outside it still round-trips.
--
-- Nullable, no default, no backfill: not one of the 288 existing tournaments
-- carries a " — " suffix in its name, so there is nothing to recover.

alter table public.tournaments
  add column if not exists city text,
  add column if not exists state text;

comment on column public.tournaments.city is
  'Host city. Rendered into the generated name as " — {City}, {State}".';
comment on column public.tournaments.state is
  'Two-letter state code. Canonical list in utils/tournament/usStates.ts.';
