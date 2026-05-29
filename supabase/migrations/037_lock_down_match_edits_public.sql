-- Lock down match_edits_public view writes. The view inherits PUBLIC default
-- grants for INSERT/UPDATE/DELETE which were never revoked, and because the
-- view runs as SECURITY DEFINER (owned by postgres) it bypasses the underlying
-- match_edits RLS. That means any anon visitor can DELETE or UPDATE audit rows
-- through the view, breaking the spec's append-only audit invariant.
--
-- Revoke all writes; keep SELECT for anon/authenticated so the badge and
-- banner continue to work.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON match_edits_public FROM PUBLIC, anon, authenticated;
