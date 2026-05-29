-- Backfill rounds rows for tournaments that are mid-round but missing the
-- rounds row for their current round.
--
-- Why: matches were created by createPairing without a corresponding rounds
-- row (the row was only inserted later by "Start Round"). Migration 036
-- hardened regenerate_current_round_pairings to require the rounds row, which
-- left these tournaments unable to use the repair flow until the host had
-- clicked Start Round.
--
-- Forward fix: createPairing now upserts a rounds row with started_at=NULL.
-- This migration backfills existing affected tournaments.
--
-- Safety: only inserts when there are matches for the current round and no
-- rounds row exists. started_at is NULL so the UI continues to show the round
-- as "not yet started" until the host clicks Start Round (stamping started_at).

INSERT INTO rounds (tournament_id, round_number, started_at, is_completed)
SELECT DISTINCT t.id, t.current_round, NULL::timestamptz, false
FROM tournaments t
WHERE t.has_started = true
  AND t.has_ended = false
  AND t.current_round IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM matches m
    WHERE m.tournament_id = t.id AND m.round = t.current_round
  )
  AND NOT EXISTS (
    SELECT 1 FROM rounds r
    WHERE r.tournament_id = t.id AND r.round_number = t.current_round
  )
ON CONFLICT (tournament_id, round_number) DO NOTHING;
