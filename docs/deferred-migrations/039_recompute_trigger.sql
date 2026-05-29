-- ============================================================================
-- DEFERRED MIGRATION — DO NOT APPLY TO PROD WITHOUT BRANCH TESTING
-- ============================================================================
-- This file lives outside supabase/migrations on purpose. It adds DB triggers
-- that fire on EVERY write to matches/byes — including writes from existing
-- prod flows (handleEndRound auto-fill, match-edit score input, initial
-- pairing, admin tooling). If the trigger has any latent issue, every
-- live tournament breaks.
--
-- Before applying:
--   1. Create a Supabase dev branch (`mcp__supabase__create_branch`).
--   2. Apply this migration to the branch.
--   3. Run full e2e + vitest suite against the branch.
--   4. Manually exercise: start round, end round, repair, re-pair, edit
--      score, swap players, swap bye, drop player.
--   5. Only after all that passes, merge the branch and apply to main.
--
-- Until then, the explicit recompute_participant_totals calls in migration
-- 038 (regenerate RPC) and in components/ui/TournamentRounds.tsx (swap
-- handlers) cover the known mutation paths. The trigger is the
-- "unforgettable" hardening for future mutation paths.
-- ============================================================================
--
-- Layer 3 hardening: make participant total recomputation unforgettable.
--
-- Previously, any code path that mutated `matches` or `byes` had to
-- remember to call recompute_participant_totals(tournament_id) afterwards.
-- That contract was respected by repair_match_score (after migration 032b)
-- and regenerate_current_round_pairings (after migration 038), but had
-- already been silently violated by the latter and the two client-side
-- bye-swap handlers. The fix in 038 was correct for the known paths, but
-- still relies on convention — any future mutation path is one forgotten
-- call away from re-creating the same bug.
--
-- This migration moves the invariant into the database. After any
-- INSERT/UPDATE/DELETE on `matches` or `byes`, a statement-level trigger
-- recomputes `participants.match_points` and `participants.differential`
-- from history for every affected tournament_id. The invariant
--
--   participants.match_points = derive(matches, byes)
--
-- is now enforced by the DB, not by hopeful code review.
--
-- Cost: O(participants_in_tournament) per affected statement. For the
-- typical CCG tournament (≤ 50 players) this is negligible. Statement-level
-- (vs row-level) keeps it cheap for batched writes.

-- Internal recompute function — same math as recompute_participant_totals
-- but no auth check, callable only by other trusted code (RPCs, triggers).
-- SECURITY DEFINER bypasses RLS for the participants UPDATE.
CREATE OR REPLACE FUNCTION _recompute_participant_totals_internal(
  p_tournament_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_score    INT;
  v_participant  RECORD;
  v_part_mp      NUMERIC;
  v_part_diff    INT;
BEGIN
  SELECT max_score INTO v_max_score FROM tournaments WHERE id = p_tournament_id;
  IF v_max_score IS NULL THEN RETURN; END IF;

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

REVOKE ALL ON FUNCTION _recompute_participant_totals_internal(UUID) FROM PUBLIC;

-- Re-point the public recompute RPC to use the internal function. Keeps the
-- auth check in place for direct client callers (e.g., manual repair).
CREATE OR REPLACE FUNCTION recompute_participant_totals(
  p_tournament_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_host_id UUID;
BEGIN
  SELECT host_id INTO v_host_id FROM tournaments WHERE id = p_tournament_id;
  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'recompute_participant_totals: tournament % not found', p_tournament_id;
  END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_host_id THEN
    RAISE EXCEPTION 'recompute_participant_totals: not the tournament host';
  END IF;
  PERFORM _recompute_participant_totals_internal(p_tournament_id);
END;
$$;

REVOKE ALL ON FUNCTION recompute_participant_totals(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recompute_participant_totals(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION recompute_participant_totals(UUID) TO authenticated;

-- Statement-level trigger function — drains the transition table down to
-- distinct tournament_ids and recomputes each once.
CREATE OR REPLACE FUNCTION _trg_recompute_after_match_or_bye_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid UUID;
BEGIN
  -- TG_ARGV[0] is the source table name; choose which transition table to read.
  IF TG_OP = 'DELETE' THEN
    FOR v_tid IN SELECT DISTINCT tournament_id FROM deleted_rows LOOP
      PERFORM _recompute_participant_totals_internal(v_tid);
    END LOOP;
  ELSIF TG_OP = 'INSERT' THEN
    FOR v_tid IN SELECT DISTINCT tournament_id FROM inserted_rows LOOP
      PERFORM _recompute_participant_totals_internal(v_tid);
    END LOOP;
  ELSE  -- UPDATE
    FOR v_tid IN
      SELECT DISTINCT tournament_id FROM inserted_rows
      UNION
      SELECT DISTINCT tournament_id FROM deleted_rows
    LOOP
      PERFORM _recompute_participant_totals_internal(v_tid);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- Attach to `matches`
DROP TRIGGER IF EXISTS trg_matches_recompute_ins ON matches;
CREATE TRIGGER trg_matches_recompute_ins
AFTER INSERT ON matches
REFERENCING NEW TABLE AS inserted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION _trg_recompute_after_match_or_bye_change();

DROP TRIGGER IF EXISTS trg_matches_recompute_upd ON matches;
CREATE TRIGGER trg_matches_recompute_upd
AFTER UPDATE ON matches
REFERENCING NEW TABLE AS inserted_rows OLD TABLE AS deleted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION _trg_recompute_after_match_or_bye_change();

DROP TRIGGER IF EXISTS trg_matches_recompute_del ON matches;
CREATE TRIGGER trg_matches_recompute_del
AFTER DELETE ON matches
REFERENCING OLD TABLE AS deleted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION _trg_recompute_after_match_or_bye_change();

-- Attach to `byes`
DROP TRIGGER IF EXISTS trg_byes_recompute_ins ON byes;
CREATE TRIGGER trg_byes_recompute_ins
AFTER INSERT ON byes
REFERENCING NEW TABLE AS inserted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION _trg_recompute_after_match_or_bye_change();

DROP TRIGGER IF EXISTS trg_byes_recompute_upd ON byes;
CREATE TRIGGER trg_byes_recompute_upd
AFTER UPDATE ON byes
REFERENCING NEW TABLE AS inserted_rows OLD TABLE AS deleted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION _trg_recompute_after_match_or_bye_change();

DROP TRIGGER IF EXISTS trg_byes_recompute_del ON byes;
CREATE TRIGGER trg_byes_recompute_del
AFTER DELETE ON byes
REFERENCING OLD TABLE AS deleted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION _trg_recompute_after_match_or_bye_change();
