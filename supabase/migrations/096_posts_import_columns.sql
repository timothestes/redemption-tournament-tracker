-- 096_posts_import_columns.sql
-- WordPress import support. Spec: docs/superpowers/specs/2026-09-06-wxr-import-design.md §4
alter table public.posts
  add column author_name text
    check (author_name is null or char_length(author_name) between 1 and 80);
comment on column public.posts.author_name is
  'Byline override, set by the WordPress import; the editor never writes it.';

-- PostgREST upsert (on_conflict=source_url) needs a real unique index on the
-- column; a partial index would not be inferred. NULLs are distinct, so posts
-- created in the editor (source_url null) are unaffected.
alter table public.posts add constraint posts_source_url_key unique (source_url);
