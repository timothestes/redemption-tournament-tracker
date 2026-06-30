-- Link a tournament to an official listing and record which category/format it
-- is for. This turns the old one-listing -> one-tournament link into
-- many-tournaments -> one-listing, so a real event's multiple categories
-- (e.g. "Type 1 - 2P", "Type 2 - 2P") can be grouped under one heading on the
-- host's tournaments page.
alter table tournaments
  add column if not exists listing_id uuid references tournament_listings(id) on delete set null;

alter table tournaments
  add column if not exists category text;

create index if not exists idx_tournaments_listing on tournaments(listing_id);
