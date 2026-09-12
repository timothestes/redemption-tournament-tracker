-- 103_card_aliases.sql
-- Card aliases for `[[mentions]]`: the short names people actually say ("LAFS")
-- pointing at the printing they mean ("Love at First Sight (LoC)"). Curated in
-- /admin/catalog and baked into the overlay by `make pull-card-overrides`, the
-- same build-time path card overrides take (092/094).
--
-- Its own table rather than a column on card_overrides: an override patches a
-- card's fields and requires a note explaining the change, while an alias adds
-- a name and explains itself. Keying them together would make either one a
-- partial row of the other.
--
-- SCHEMA ONLY — no data.

create table if not exists public.card_aliases (
  id           uuid primary key default gen_random_uuid(),
  alias        text not null,   -- as typed by the curator; casing is kept for display
  card_name    text not null,   -- catalog identity, matched byte-for-byte
  set_code     text not null,   --   against CardData name|set (strict lookup)
  updated_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Aliases are global, not per-card: `[[LAFS]]` has to name exactly one card, so
-- uniqueness is enforced the loose way resolution matches (cardNameKey folds
-- case and whitespace, and the editor collapses whitespace before it writes).
create unique index if not exists card_aliases_alias_key
  on public.card_aliases (lower(btrim(alias)));

-- The editor lists a selected card's aliases on every card selection.
create index if not exists card_aliases_card_idx
  on public.card_aliases (card_name, set_code);

alter table public.card_aliases enable row level security;

-- Superuser OR manage_catalog, matching the other catalog tables (094). Uses
-- the SECURITY DEFINER helper from 010 — never an inline subquery against
-- admin_users (see 093).
drop policy if exists "card_aliases_catalog_editors" on public.card_aliases;
create policy "card_aliases_catalog_editors" on public.card_aliases
  for all to authenticated
  using (public.is_superuser() or 'manage_catalog' = any(public.get_my_admin_permissions()))
  with check (public.is_superuser() or 'manage_catalog' = any(public.get_my_admin_permissions()));

revoke all on public.card_aliases from anon;
grant select, insert, update, delete on public.card_aliases to authenticated;
