-- WordPress post/page id, for legacy short-link redirects (/?p=<id>, /?page_id=<id>).
-- Backfilled from the WXR export by scripts/backfill-wp-post-ids.ts; the app only reads it.
alter table public.posts add column wp_post_id integer unique;
