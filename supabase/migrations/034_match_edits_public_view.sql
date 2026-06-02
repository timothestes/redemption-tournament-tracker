-- A restricted public view exposing only the non-sensitive subset of match_edits
-- (match_id, round, edited_at) so the player-facing "amended" badge on standings
-- can render for all viewers. The underlying match_edits table remains host-only.
--
-- Postgres views default to SECURITY DEFINER semantics, so this view executes
-- with the privileges of its creator and bypasses RLS on match_edits — which is
-- exactly what we want here: we are intentionally exposing the limited columns.

CREATE VIEW match_edits_public AS
  SELECT match_id, round, edited_at
  FROM match_edits;

GRANT SELECT ON match_edits_public TO authenticated, anon;
