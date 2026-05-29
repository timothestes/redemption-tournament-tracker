-- Harden regenerate_current_round_pairings to fail loudly when the rounds row
-- is missing for the current round. Previously, the IF v_is_completed THEN guard
-- silently evaluated NULL-as-not-true and the RPC proceeded to delete-and-replace
-- matches without any rounds-table context, leaving the UI in an inconsistent
-- state (latestRound stays null, page can't render the active round panel).

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

  -- Explicit NULL guard: a missing rounds row means the tournament state is
  -- broken and re-pairing would proceed against an inconsistent context.
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
