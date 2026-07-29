-- Sanctioning tier for a tournament (Regional, State, National, …), orthogonal
-- to its category/format: a Regional and a Local can both be Type 1 Unlimited.
--
-- Free text rather than an enum, mirroring `category`: the vocabulary comes
-- from tournament_listings.tournament_type, which is scraped free text, and a
-- new tier showing up in a listing must not require a migration. The canonical
-- list and the normalizer live in utils/tournament/tiers.ts.
--
-- Nullable with no default and no backfill — existing tournaments simply have
-- no tier, and their frozen names (which never carried one) stay valid.

alter table public.tournaments
  add column if not exists tier text;

comment on column public.tournaments.tier is
  'Sanctioning tier: Local (Open) | Local (Closed) | District | State | Regional | National. Null = unspecified. Canonical list in utils/tournament/tiers.ts.';
