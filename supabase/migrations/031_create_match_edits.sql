-- Append-only audit log of host repairs to past-round match scores.
-- See docs/superpowers/specs/2026-05-27-mid-round-score-repair-design.md

CREATE TABLE match_edits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           UUID NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  tournament_id      UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round              INT NOT NULL,
  old_player1_score  INT NOT NULL,
  old_player2_score  INT NOT NULL,
  new_player1_score  INT NOT NULL,
  new_player2_score  INT NOT NULL,
  edited_by          UUID NOT NULL REFERENCES auth.users(id),
  edited_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason             TEXT
);

CREATE INDEX match_edits_tournament_round_idx
  ON match_edits(tournament_id, round);
CREATE INDEX match_edits_match_id_idx
  ON match_edits(match_id);

ALTER TABLE match_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY host_can_select_match_edits
  ON match_edits FOR SELECT
  USING (
    auth.uid() = (
      SELECT host_id FROM tournaments
      WHERE tournaments.id = match_edits.tournament_id
    )
  );

CREATE POLICY host_can_insert_match_edits
  ON match_edits FOR INSERT
  WITH CHECK (
    auth.uid() = edited_by
    AND auth.uid() = (
      SELECT host_id FROM tournaments
      WHERE tournaments.id = match_edits.tournament_id
    )
  );
-- No UPDATE or DELETE policies: audit rows are append-only.

-- NOTE: byes_tournament_round_unique index was intentionally omitted from this
-- migration. Production data has duplicate (tournament_id, round_number) rows
-- in the byes table (at least 3 tournaments affected). A separate cleanup
-- migration is needed to deduplicate those rows before the unique index can be
-- added safely.
