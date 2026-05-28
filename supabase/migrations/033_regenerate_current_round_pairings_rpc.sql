-- Atomically replace the current round's matches and byes with the supplied
-- pairings. Pairing math computed in TypeScript (lib/tournament/pairing.ts)
-- and passed in as JSONB by the server action.
--
-- p_pairings  : jsonb array, each element {"player1_id": uuid, "player2_id": uuid, "match_order": int}
-- p_bye_id    : nullable uuid; if non-null, inserted into byes table
-- p_unlock    : if false, RAISE if any current-round match has a non-null player1_score

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
  -- 1. Lock the tournaments row to serialize concurrent regenerates.
  SELECT host_id, current_round INTO v_host_id, v_current_rnd
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: tournament % not found', p_tournament_id;
  END IF;

  -- Explicit NULL check prevents anon (auth.uid() = NULL) bypass.
  IF auth.uid() IS NULL OR auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: not the tournament host';
  END IF;

  -- 2. Check the round is not completed.
  SELECT id, is_completed INTO v_round_id, v_is_completed
  FROM rounds
  WHERE tournament_id = p_tournament_id
    AND round_number = v_current_rnd;

  IF v_is_completed THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: round % is already completed', v_current_rnd;
  END IF;

  -- 3. Gate on existing scored matches unless unlock=true.
  SELECT COUNT(*) INTO v_scored_count
  FROM matches
  WHERE tournament_id = p_tournament_id
    AND round = v_current_rnd
    AND player1_score IS NOT NULL;

  IF v_scored_count > 0 AND NOT p_unlock THEN
    RAISE EXCEPTION 'regenerate_current_round_pairings: % match(es) already scored; pass p_unlock=true to override', v_scored_count;
  END IF;

  -- 4. Delete the current round's matches and byes.
  DELETE FROM matches
   WHERE tournament_id = p_tournament_id
     AND round = v_current_rnd;
  DELETE FROM byes
   WHERE tournament_id = p_tournament_id
     AND round_number = v_current_rnd;

  -- 5. Insert the new pairings.
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

  -- 6. Insert the bye if any.
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
