-- 098_author_profile.sql
-- Self-service author bio, rendered on articles. Spec:
-- docs/superpowers/specs/2026-09-06-poster-invites-author-profile-design.md
--
-- profiles.avatar_url already exists in production (populated from OAuth
-- provider metadata by the live handle_new_user() trigger — full_name and
-- website exist too), even though 007_create_profiles_table.sql doesn't
-- show it: the migrations folder has drifted from prod for this table.
-- Reuses that column as the author's photo rather than adding a duplicate.

alter table public.profiles
  add column bio text check (bio is null or char_length(bio) <= 500);
