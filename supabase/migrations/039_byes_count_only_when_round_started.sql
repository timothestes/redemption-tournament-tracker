-- Byes only score once their round has actually started.
--
-- Symptom: a player holding the bye for the *current* round showed inflated
-- match_points (the +3 bye credit) the moment "End Round" staged the next
-- round's pairings — before that round was started. Meanwhile the Standings
-- W-L-T record and Byes column hid that same bye (they gate on
-- round_number < current_round). Result: MP=4 with a 0-1-0 record and 0 byes,
-- which looks impossible.
--
-- Root cause: a bye is a result for a round that hasn't been run yet during
-- the "staged but not started" window (End Round N stages round N+1's bye and
-- bumps current_round, but rounds.started_at stays NULL until Start Round).
-- The MP recompute counted every bye row unconditionally; the display did not.
--
-- Fix (consistent on both sides): a bye contributes its 3 MP only when its
-- round has started (rounds.started_at IS NOT NULL). This patches the two
-- server functions that sum bye points. The client mirrors the same rule in
-- recomputeTotalsFromHistory + StandingsTable. Differential is unaffected
-- (byes contribute 0). The recompute stays idempotent: started_at is
-- monotonic, so totals only ever gain the +3 once, at the start transition.

CREATE OR REPLACE FUNCTION recompute_participant_totals(
  p_tournament_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_host_id      UUID;
  v_max_score    INT;
  v_participant  RECORD;
  v_part_mp      NUMERIC;
  v_part_diff    INT;
BEGIN
  SELECT host_id, max_score
    INTO v_host_id, v_max_score
    FROM tournaments
   WHERE id = p_tournament_id;

  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'recompute_participant_totals: tournament % not found', p_tournament_id;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'recompute_participant_totals: not the tournament host';
  END IF;

  FOR v_participant IN
    SELECT id FROM participants WHERE tournament_id = p_tournament_id
  LOOP
    SELECT
      COALESCE(SUM(
        CASE
          WHEN m.player1_score = m.player2_score THEN 1.5
          WHEN (m.player1_id = v_participant.id AND m.player1_score = v_max_score) THEN 3
          WHEN (m.player2_id = v_participant.id AND m.player2_score = v_max_score) THEN 3
          WHEN (m.player1_id = v_participant.id AND m.player2_score = v_max_score) THEN 0
          WHEN (m.player2_id = v_participant.id AND m.player1_score = v_max_score) THEN 0
          WHEN (m.player1_id = v_participant.id AND m.player1_score > m.player2_score) THEN 2
          WHEN (m.player1_id = v_participant.id AND m.player1_score < m.player2_score) THEN 1
          WHEN (m.player2_id = v_participant.id AND m.player2_score > m.player1_score) THEN 2
          WHEN (m.player2_id = v_participant.id AND m.player2_score < m.player1_score) THEN 1
          ELSE 0
        END
      ), 0),
      COALESCE(SUM(
        CASE
          WHEN m.player1_id = v_participant.id THEN m.player1_score - m.player2_score
          WHEN m.player2_id = v_participant.id THEN m.player2_score - m.player1_score
          ELSE 0
        END
      ), 0)
    INTO v_part_mp, v_part_diff
    FROM matches m
    WHERE m.tournament_id = p_tournament_id
      AND m.player1_score IS NOT NULL
      AND m.player2_score IS NOT NULL
      AND (m.player1_id = v_participant.id OR m.player2_id = v_participant.id);

    -- Bye contributions — ONLY for byes whose round has started. A staged but
    -- not-yet-started round's bye must not score yet (see migration header).
    SELECT v_part_mp + 3 * COALESCE(COUNT(*), 0)
      INTO v_part_mp
      FROM byes b
      JOIN rounds r
        ON r.tournament_id = b.tournament_id
       AND r.round_number = b.round_number
     WHERE b.tournament_id = p_tournament_id
       AND b.participant_id = v_participant.id
       AND r.started_at IS NOT NULL;

    UPDATE participants
       SET match_points = v_part_mp,
           differential = v_part_diff
     WHERE id = v_participant.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION recompute_participant_totals(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recompute_participant_totals(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION recompute_participant_totals(UUID) TO authenticated;


-- repair_match_score: same started-round gate on BOTH bye references
-- (step 6 participant totals, and the step 7 chronological snapshot walk).
CREATE OR REPLACE FUNCTION repair_match_score(
  p_match_id        UUID,
  p_new_p1_score    INT,
  p_new_p2_score    INT,
  p_reason          TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tournament_id  UUID;
  v_host_id        UUID;
  v_round          INT;
  v_max_score      INT;
  v_old_p1         INT;
  v_old_p2         INT;
  v_p1_id          UUID;
  v_p2_id          UUID;
  v_is_tie         BOOLEAN;
  v_winner_id      UUID;
  v_participant    RECORD;
  v_event          RECORD;
  v_cum_mp         NUMERIC;
  v_cum_diff       INT;
  v_p1_pts         NUMERIC;
  v_p2_pts         NUMERIC;
  v_part_mp        NUMERIC;
  v_part_diff      INT;
BEGIN
  -- 1. Lock the target match and load tournament context.
  SELECT m.tournament_id, m.round, m.player1_id, m.player2_id,
         m.player1_score, m.player2_score, t.host_id, t.max_score
    INTO v_tournament_id, v_round, v_p1_id, v_p2_id,
         v_old_p1, v_old_p2, v_host_id, v_max_score
  FROM matches m
  JOIN tournaments t ON t.id = m.tournament_id
  WHERE m.id = p_match_id
  FOR UPDATE OF m;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'repair_match_score: match % not found', p_match_id;
  END IF;

  -- 2. Authorization.
  IF auth.uid() IS NULL OR auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'repair_match_score: not the tournament host';
  END IF;

  -- 3. Validate scores.
  IF p_new_p1_score < 0 OR p_new_p2_score < 0 THEN
    RAISE EXCEPTION 'repair_match_score: scores must be non-negative';
  END IF;
  IF p_new_p1_score > v_max_score OR p_new_p2_score > v_max_score THEN
    RAISE EXCEPTION 'repair_match_score: scores exceed tournament max_score (%)', v_max_score;
  END IF;
  IF p_new_p1_score = v_max_score AND p_new_p2_score = v_max_score THEN
    RAISE EXCEPTION 'repair_match_score: both players cannot score max_score';
  END IF;

  -- 4. Derive is_tie + winner_id.
  IF p_new_p1_score = p_new_p2_score THEN
    v_is_tie := TRUE;
    v_winner_id := NULL;
  ELSIF p_new_p1_score > p_new_p2_score THEN
    v_is_tie := FALSE;
    v_winner_id := v_p1_id;
  ELSE
    v_is_tie := FALSE;
    v_winner_id := v_p2_id;
  END IF;

  -- 5. Update the corrected scores.
  UPDATE matches
     SET player1_score = p_new_p1_score,
         player2_score = p_new_p2_score,
         is_tie        = v_is_tie,
         winner_id     = v_winner_id,
         updated_at    = now()
   WHERE id = p_match_id;

  -- 6. Recompute participants.match_points / differential from history.
  FOR v_participant IN
    SELECT id FROM participants WHERE tournament_id = v_tournament_id
  LOOP
    SELECT
      COALESCE(SUM(
        CASE
          WHEN m.player1_score = m.player2_score THEN 1.5
          WHEN (m.player1_id = v_participant.id AND m.player1_score = v_max_score) THEN 3
          WHEN (m.player2_id = v_participant.id AND m.player2_score = v_max_score) THEN 3
          WHEN (m.player1_id = v_participant.id AND m.player2_score = v_max_score) THEN 0
          WHEN (m.player2_id = v_participant.id AND m.player1_score = v_max_score) THEN 0
          WHEN (m.player1_id = v_participant.id AND m.player1_score > m.player2_score) THEN 2
          WHEN (m.player1_id = v_participant.id AND m.player1_score < m.player2_score) THEN 1
          WHEN (m.player2_id = v_participant.id AND m.player2_score > m.player1_score) THEN 2
          WHEN (m.player2_id = v_participant.id AND m.player2_score < m.player1_score) THEN 1
          ELSE 0
        END
      ), 0),
      COALESCE(SUM(
        CASE
          WHEN m.player1_id = v_participant.id THEN m.player1_score - m.player2_score
          WHEN m.player2_id = v_participant.id THEN m.player2_score - m.player1_score
          ELSE 0
        END
      ), 0)
    INTO v_part_mp, v_part_diff
    FROM matches m
    WHERE m.tournament_id = v_tournament_id
      AND m.player1_score IS NOT NULL
      AND m.player2_score IS NOT NULL
      AND (m.player1_id = v_participant.id OR m.player2_id = v_participant.id);

    -- Started-round byes only (see migration header).
    SELECT v_part_mp + 3 * COALESCE(COUNT(*), 0)
      INTO v_part_mp
      FROM byes b
      JOIN rounds r
        ON r.tournament_id = b.tournament_id
       AND r.round_number = b.round_number
     WHERE b.tournament_id = v_tournament_id
       AND b.participant_id = v_participant.id
       AND r.started_at IS NOT NULL;

    UPDATE participants
       SET match_points = v_part_mp,
           differential = v_part_diff
     WHERE id = v_participant.id;
  END LOOP;

  -- 7. Chronological per-match snapshot rewrite, bye-aware. Byes only advance
  --    the cumulative once their round has started, matching step 6.
  FOR v_participant IN
    SELECT DISTINCT pid AS id FROM (
      SELECT v_p1_id AS pid
      UNION SELECT v_p2_id
    ) s
  LOOP
    v_cum_mp := 0;
    v_cum_diff := 0;

    FOR v_event IN
      SELECT 'match'::TEXT AS kind, m.id, m.round, m.match_order,
             m.player1_id, m.player2_id, m.player1_score, m.player2_score
      FROM matches m
      WHERE m.tournament_id = v_tournament_id
        AND m.player1_score IS NOT NULL
        AND m.player2_score IS NOT NULL
        AND (m.player1_id = v_participant.id OR m.player2_id = v_participant.id)
      UNION ALL
      SELECT 'bye'::TEXT AS kind, NULL::UUID AS id, b.round_number AS round, 0 AS match_order,
             NULL::UUID AS player1_id, NULL::UUID AS player2_id, NULL::INT AS player1_score, NULL::INT AS player2_score
      FROM byes b
      JOIN rounds r
        ON r.tournament_id = b.tournament_id
       AND r.round_number = b.round_number
      WHERE b.tournament_id = v_tournament_id
        AND b.participant_id = v_participant.id
        AND r.started_at IS NOT NULL
      ORDER BY round ASC, match_order ASC
    LOOP
      IF v_event.kind = 'bye' THEN
        v_cum_mp := v_cum_mp + 3;
        -- bye differential = 0 (no change)
        -- no snapshot row to update
      ELSE
        IF v_event.player1_score = v_event.player2_score THEN
          v_p1_pts := 1.5; v_p2_pts := 1.5;
        ELSIF v_event.player1_score = v_max_score THEN
          v_p1_pts := 3;   v_p2_pts := 0;
        ELSIF v_event.player2_score = v_max_score THEN
          v_p1_pts := 0;   v_p2_pts := 3;
        ELSIF v_event.player1_score > v_event.player2_score THEN
          v_p1_pts := 2;   v_p2_pts := 1;
        ELSE
          v_p1_pts := 1;   v_p2_pts := 2;
        END IF;

        IF v_event.player1_id = v_participant.id THEN
          v_cum_mp := v_cum_mp + v_p1_pts;
          v_cum_diff := v_cum_diff + (v_event.player1_score - v_event.player2_score);
          UPDATE matches
             SET player1_match_points = v_cum_mp,
                 differential = v_cum_diff
           WHERE id = v_event.id;
        ELSE
          v_cum_mp := v_cum_mp + v_p2_pts;
          v_cum_diff := v_cum_diff + (v_event.player2_score - v_event.player1_score);
          UPDATE matches
             SET player2_match_points = v_cum_mp,
                 differential2 = v_cum_diff
           WHERE id = v_event.id;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- 8. Append-only audit row.
  INSERT INTO match_edits (
    match_id, tournament_id, round,
    old_player1_score, old_player2_score,
    new_player1_score, new_player2_score,
    edited_by, reason
  ) VALUES (
    p_match_id, v_tournament_id, v_round,
    v_old_p1, v_old_p2,
    p_new_p1_score, p_new_p2_score,
    auth.uid(), p_reason
  );

  RETURN jsonb_build_object(
    'match_id', p_match_id,
    'tournament_id', v_tournament_id,
    'round', v_round,
    'old', jsonb_build_object('p1', v_old_p1, 'p2', v_old_p2),
    'new', jsonb_build_object('p1', p_new_p1_score, 'p2', p_new_p2_score)
  );
END;
$$;

REVOKE ALL ON FUNCTION repair_match_score(UUID, INT, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION repair_match_score(UUID, INT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION repair_match_score(UUID, INT, INT, TEXT) TO authenticated;
