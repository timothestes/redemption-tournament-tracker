-- 104_card_aliases_key_matches_resolution.sql
-- Follow-up to 103. Two problems that only showed up under review.
--
-- 1) The unique index was lower(btrim(alias)), which is LOOSER than the key
--    resolution actually uses. cardNameKey (lib/cards/nameKey.ts) also collapses
--    interior whitespace and folds curly quotes, so two curators could
--    concurrently claim "Boaz’ Guy" and "Boaz' Guy": both pass the server's
--    read-then-validate (neither insert is visible to the other's read) and both
--    pass the index. Resolution then honours only the first, and the next
--    `make pull-card-overrides` aborts the whole card codegen with "duplicate
--    alias" — blocking every catalog regen until someone deletes a row by hand.
--    The expression below is cardNameKey, in SQL.
--
-- 2) card_aliases has no update path and no updated_at trigger, so the column
--    never moved off its default. A timestamp that lies is worse than none.

drop index if exists public.card_aliases_alias_key;

create unique index card_aliases_alias_key
  on public.card_aliases (
    lower(btrim(regexp_replace(translate(alias, $$‘’“”$$, $$''""$$), '\s+', ' ', 'g')))
  );

alter table public.card_aliases drop column if exists updated_at;
