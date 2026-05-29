-- Root-cause fix for stale participant.match_points after re-pair / bye swap.
--
-- Symptom: a participant who had a bye in round N would keep the bye's +3
-- match_points on their participant row even after Re-pair Round N reassigned
-- the bye to someone else. The new bye holder, meanwhile, didn't get credit.
--
-- Cause: regenerate_current_round_pairings deleted and recreated matches +
-- byes but never recomputed participants.match_points / differential from the
-- new state. Only repair_match_score (step 6) had that recompute.
--
-- This migration:
--   1. Extracts the recompute-from-history logic into a reusable function
--      `recompute_participant_totals(tournament_id)`.
--   2. Patches `regenerate_current_round_pairings` to call it after writes.
--   3. Exposes the recompute as its own RPC so the client-side bye-swap
--      handlers (handleSwapPlayerWithBye, handleSwapPlayersWithBye) can use
--      it instead of their fragile incremental math.
--
-- The recompute is idempotent: running it on a correct tournament leaves
-- it unchanged. Running it on a corrupt one heals it.

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

    -- Bye contributions. 3 matches repair_match_score's convention; if a
    -- future change makes bye_points tournament-configurable, both this and
    -- repair_match_score's step 6 need to switch to reading the column.
    SELECT v_part_mp + 3 * COALESCE(COUNT(*), 0)
      INTO v_part_mp
      FROM byes
     WHERE tournament_id = p_tournament_id
       AND participant_id = v_participant.id;

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

-- Patch the regenerate RPC to recompute after writes. The auth check in
-- recompute_participant_totals is redundant with the one this function
-- already did, but the cost is negligible.
CREATE OR REPLACE FUNCTION regenerate_current_round_pairings(
  p_tournament_id  UUID,
  p_pairings       JSONB,
  p_bye_id         UUID DEFAULT NULL,
  p_unlock         BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_host_id      UUID;
  v_current_rnd  INT;
  v_round_id     UUID;
  v_is_completed BOOLEAN;
  v_scored_count INT;
  v_inserted     INT := 0;
  v_pair         JSONB;
BEGIN
  SELECT host_id, current_round INTO v_host_id, v_current_rnd
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: tournament % not found', p_tournament_id;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: not the tournament host';
  END IF;

  SELECT id, is_completed INTO v_round_id, v_is_completed
  FROM rounds
  WHERE tournament_id = p_tournament_id
    AND round_number = v_current_rnd;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: no rounds row for round % (tournament state inconsistent)', v_current_rnd;
  END IF;

  IF v_is_completed THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: round % is already completed', v_current_rnd;
  END IF;

  SELECT COUNT(*) INTO v_scored_count
  FROM matches
  WHERE tournament_id = p_tournament_id
    AND round = v_current_rnd
    AND player1_score IS NOT NULL;

  IF v_scored_count > 0 AND NOT p_unlock THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: % match(es) already scored; pass p_unlock=true to override', v_scored_count;
  END IF;

  DELETE FROM matches
   WHERE tournament_id = p_tournament_id
     AND round = v_current_rnd;
  DELETE FROM byes
   WHERE tournament_id = p_tournament_id
     AND round_number = v_current_rnd;

  FOR v_pair IN SELECT * FROM jsonb_array_elements(p_pairings)
  LOOP
    INSERT INTO matches (
      tournament_id, round, player1_id, player2_id,
      player1_score, player2_score, match_order
    ) VALUES (
      p_tournament_id,
      v_current_rnd,
      (v_pair->>'player1_id')::UUID,
      (v_pair->>'player2_id')::UUID,
      NULL, NULL,
      (v_pair->>'match_order')::INT
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  IF p_bye_id IS NOT NULL THEN
    INSERT INTO byes (
      tournament_id, round_number, participant_id,
      match_points, differential
    ) VALUES (
      p_tournament_id, v_current_rnd, p_bye_id, 3, 0
    );
  END IF;

  -- Recompute participant totals from the new match + bye state. Without this,
  -- participants who lost or gained a bye in the re-pair keep stale totals.
  PERFORM recompute_participant_totals(p_tournament_id);

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id,
    'round', v_current_rnd,
    'matches_inserted', v_inserted,
    'bye_id', p_bye_id
  );
END;
$$;

REVOKE ALL ON FUNCTION regenerate_current_round_pairings(UUID, JSONB, UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION regenerate_current_round_pairings(UUID, JSONB, UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION regenerate_current_round_pairings(UUID, JSONB, UUID, BOOLEAN) TO authenticated;
