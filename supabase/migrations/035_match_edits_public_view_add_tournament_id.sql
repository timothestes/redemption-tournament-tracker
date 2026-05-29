-- Add tournament_id to the public view so the repair banner can filter by tournament
-- without a join. tournament_id is not sensitive (it's the same ID in the URL).

DROP VIEW match_edits_public;
CREATE VIEW match_edits_public AS
  SELECT match_id, tournament_id, round, edited_at
  FROM match_edits;
GRANT SELECT ON match_edits_public TO authenticated, anon;
