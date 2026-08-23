-- 092_card_overrides.sql
-- Catalog admin editor (docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md).
-- Two tables because cards and images are different resources: ~151 imgFiles
-- serve 2+ catalog cards (Limited/Unlimited pairs share art), so image versions
-- key on img_file — a per-card version was shown to produce non-monotonic ?v=
-- regressions and archive clobbering (spec F2).
--
-- No definer RPCs: single-admin tables with no cross-row invariants. The one
-- atomic need (version bump) is handled by a compare-and-set UPDATE from the
-- route. SCHEMA ONLY — no data.

create table if not exists public.card_overrides (
  id           uuid primary key default gen_random_uuid(),
  card_name    text not null,   -- catalog identity, matched byte-for-byte
  set_code     text not null,   --   against CardData name|set (strict lookup, spec F3)
  fields       jsonb not null default '{}'::jsonb,  -- SPARSE: only changed fields
  note         text not null,
  updated_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (card_name, set_code)
);

create table if not exists public.card_image_versions (
  img_file     text primary key,  -- the blob's identity (card-images/<img_file>.jpg)
  version      int  not null,     -- monotonic; bumped via CAS from the image route
  note         text,
  updated_by   uuid not null references auth.users(id),
  updated_at   timestamptz not null default now()
);

alter table public.card_overrides      enable row level security;
alter table public.card_image_versions enable row level security;

drop policy if exists "card_overrides_superuser" on public.card_overrides;
create policy "card_overrides_superuser" on public.card_overrides
  for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists "card_image_versions_superuser" on public.card_image_versions;
create policy "card_image_versions_superuser" on public.card_image_versions
  for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

revoke all on public.card_overrides      from anon;
revoke all on public.card_image_versions from anon;
grant select, insert, update, delete on public.card_overrides      to authenticated;
grant select, insert, update, delete on public.card_image_versions to authenticated;
