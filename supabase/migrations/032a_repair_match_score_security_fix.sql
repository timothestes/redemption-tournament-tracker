-- Fix two security findings in 032_repair_match_score_rpc.sql:
-- 1. Add explicit NULL check for auth.uid() so anon calls cannot bypass the
--    host check via SQL three-valued logic.
-- 2. Explicitly REVOKE EXECUTE from anon; the original `REVOKE ALL FROM PUBLIC`
--    did not strip Supabase's default anon grant.

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
  v_match          RECORD;
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

  -- 2. Authorization. The explicit NULL check prevents anon (auth.uid() = NULL)
  --    from bypassing this gate via SQL three-valued logic.
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

    SELECT v_part_mp + 3 * COALESCE(COUNT(*), 0)
      INTO v_part_mp
    FROM byes
    WHERE tournament_id = v_tournament_id
      AND participant_id = v_participant.id;

    UPDATE participants
       SET match_points = v_part_mp,
           differential = v_part_diff
     WHERE id = v_participant.id;
  END LOOP;

  -- 7. Chronological per-match snapshot rewrite for both affected participants.
  FOR v_participant IN
    SELECT DISTINCT pid AS id FROM (
      SELECT v_p1_id AS pid
      UNION SELECT v_p2_id
    ) s
  LOOP
    v_cum_mp := 0;
    v_cum_diff := 0;

    FOR v_match IN
      SELECT m.id, m.player1_id, m.player2_id, m.player1_score, m.player2_score
      FROM matches m
      WHERE m.tournament_id = v_tournament_id
        AND m.player1_score IS NOT NULL
        AND m.player2_score IS NOT NULL
        AND (m.player1_id = v_participant.id OR m.player2_id = v_participant.id)
      ORDER BY m.round ASC, m.match_order ASC
    LOOP
      IF v_match.player1_score = v_match.player2_score THEN
        v_p1_pts := 1.5; v_p2_pts := 1.5;
      ELSIF v_match.player1_score = v_max_score THEN
        v_p1_pts := 3;   v_p2_pts := 0;
      ELSIF v_match.player2_score = v_max_score THEN
        v_p1_pts := 0;   v_p2_pts := 3;
      ELSIF v_match.player1_score > v_match.player2_score THEN
        v_p1_pts := 2;   v_p2_pts := 1;
      ELSE
        v_p1_pts := 1;   v_p2_pts := 2;
      END IF;

      IF v_match.player1_id = v_participant.id THEN
        v_cum_mp := v_cum_mp + v_p1_pts;
        v_cum_diff := v_cum_diff + (v_match.player1_score - v_match.player2_score);
        UPDATE matches
           SET player1_match_points = v_cum_mp,
               differential = v_cum_diff
         WHERE id = v_match.id;
      ELSE
        v_cum_mp := v_cum_mp + v_p2_pts;
        v_cum_diff := v_cum_diff + (v_match.player2_score - v_match.player1_score);
        UPDATE matches
           SET player2_match_points = v_cum_mp,
               differential2 = v_cum_diff
         WHERE id = v_match.id;
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
