-- 095_posts.sql
-- Articles: markdown posts written by users granted the 'publish_posts'
-- permission. Spec: docs/superpowers/specs/2026-09-05-articles-design.md
--
-- Ordering: 094 (manage_catalog, PR #355) is live; §3 below redefines the
-- allowlist from 094's body. If 094 is ever re-applied after this file, it
-- would drop 'publish_posts' from the allowlist — re-run §3 in that case.

-- 0) profiles backfill. posts.author_id references profiles(id) so PostgREST
--    can embed the byline; the 007 trigger covers new users, a few predate it.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- 1) table -------------------------------------------------------------------
create table public.posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title           text not null check (char_length(title) between 1 and 200),
  excerpt         text check (excerpt is null or char_length(excerpt) <= 500),
  body_md         text not null default '',
  cover_image_url text,
  tags            text[] not null default '{}' check (cardinality(tags) <= 10),
  status          text not null default 'draft' check (status in ('draft','published')),
  author_id       uuid not null references public.profiles(id) on delete restrict,
  published_at    timestamptz,               -- set on FIRST publish, never cleared
  source_url      text,                      -- reserved for the WordPress import
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index posts_published_idx on public.posts (status, published_at desc);
create index posts_tags_idx on public.posts using gin (tags);
create index posts_author_idx on public.posts (author_id);

grant select on public.posts to anon;
grant select, insert, update, delete on public.posts to authenticated;

alter table public.posts enable row level security;

-- 2) policies. Gate on the SECURITY DEFINER helpers from 010/062 — never an
--    inline subquery against admin_users (see 093). is_superuser() is not
--    executable by anon, so every policy that calls it is `to authenticated`.
create policy "posts_select_published" on public.posts
  for select to anon, authenticated
  using (status = 'published');

create policy "posts_select_own_or_super" on public.posts
  for select to authenticated
  using (author_id = auth.uid() or public.is_superuser());

create policy "posts_insert_poster" on public.posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and ('publish_posts' = any(public.get_my_admin_permissions()) or public.is_superuser())
  );

create policy "posts_update_owner_or_super" on public.posts
  for update to authenticated
  using (
    (author_id = auth.uid() and 'publish_posts' = any(public.get_my_admin_permissions()))
    or public.is_superuser()
  )
  with check (
    (author_id = auth.uid() and 'publish_posts' = any(public.get_my_admin_permissions()))
    or public.is_superuser()
  );

create policy "posts_delete_owner_or_super" on public.posts
  for delete to authenticated
  using (
    (author_id = auth.uid() and 'publish_posts' = any(public.get_my_admin_permissions()))
    or public.is_superuser()
  );

-- 3) allowlist: VERBATIM from 094 plus 'publish_posts'.
--    MIRRORS app/admin/permissions/lib/permissions.ts — update both together.
create or replace function public.super_set_admin_permissions(p_user_id uuid, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed constant text[] := array[
    'manage_registrations','manage_tags','manage_spoilers',
    'manage_cards','manage_rulings','threshing_floor','manage_shopify_imports',
    'manage_catalog','publish_posts'
  ];
  perm text;
  perms text[] := coalesce(p_permissions, '{}');
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  foreach perm in array perms loop
    if not (perm = any(allowed)) then
      raise exception 'unknown permission: %', perm;
    end if;
  end loop;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'no such user';
  end if;
  insert into public.admin_users (user_id, permissions, created_by)
  values (p_user_id, perms, auth.uid())
  on conflict (user_id) do update set permissions = excluded.permissions;
end;
$$;

revoke execute on function public.super_set_admin_permissions(uuid, text[]) from public, anon;
grant execute on function public.super_set_admin_permissions(uuid, text[]) to authenticated;
