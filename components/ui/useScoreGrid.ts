"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { saveMatchScore, validateScorePair } from "../../utils/tournament/saveMatchScore";
import {
  handleGridKey,
  type CellRef,
  type ScoreColumn,
} from "../../lib/tournament/scoreGridNav";

/**
 * Cursor, optimistic draft state, and background persistence for the desktop
 * keyboard score grid.
 *
 * Saving is deliberately decoupled from typing: a digit updates local state and
 * moves the cursor immediately, and the write fires in the background once a
 * row holds both scores. The host never waits on a round-trip, so the three
 * queries saveMatchScore issues are invisible at typing speed.
 */

export type RowSaveState = "idle" | "saving" | "saved" | "error";

/** Local, not-yet-confirmed scores, keyed by match id. */
type Draft = Record<string, { p1: number | null; p2: number | null }>;

export interface ScoreGridMatch {
  id: string;
  player1_id: { id: string; name: string };
  player2_id: { id: string; name: string };
  player1_score: number | null;
  player2_score: number | null;
}

export function useScoreGrid({
  matches,
  maxScore,
  enabled,
  onSaved,
  onOpenHelp,
}: {
  matches: ScoreGridMatch[];
  maxScore: number;
  enabled: boolean;
  /** Called after a successful write so the parent can refetch / clear errors. */
  onSaved?: (matchId: string) => void;
  onOpenHelp?: () => void;
}) {
  const [cursor, setCursor] = useState<CellRef | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saveState, setSaveState] = useState<Record<string, RowSaveState>>({});
  const [rejected, setRejected] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const cellKey = (row: number, col: ScoreColumn) => `${row}:${col}`;

  const registerInput = useCallback(
    (row: number, col: ScoreColumn, el: HTMLInputElement | null) => {
      const key = cellKey(row, col);
      if (el) inputRefs.current.set(key, el);
      else inputRefs.current.delete(key);
    },
    [],
  );

  /** Effective value for a cell: the local draft if present, else the DB value. */
  const valueAt = useCallback(
    (row: number, col: ScoreColumn): number | null => {
      const match = matches[row];
      if (!match) return null;
      const d = draft[match.id];
      if (d) return col === 0 ? d.p1 : d.p2;
      return col === 0 ? match.player1_score : match.player2_score;
    },
    [matches, draft],
  );

  const isRowComplete = useCallback(
    (row: number) => valueAt(row, 0) !== null && valueAt(row, 1) !== null,
    [valueAt],
  );

  const focusCell = useCallback((to: CellRef) => {
    setCursor(to);
    // Focus after paint so a cell that just mounted (or re-ordered) exists.
    requestAnimationFrame(() => {
      const el = inputRefs.current.get(cellKey(to.row, to.col));
      el?.focus();
      el?.select();
    });
  }, []);

  /**
   * Persist a row once both its cells hold a value. Illegal pairs (max–max)
   * are left in the draft and flagged rather than written, so the host sees the
   * bad row instead of silently losing the entry.
   */
  const commitRow = useCallback(
    async (row: number, next: { p1: number | null; p2: number | null }) => {
      const match = matches[row];
      if (!match) return;
      if (next.p1 === null || next.p2 === null) return;
      if (validateScorePair(next.p1, next.p2, maxScore)) {
        setSaveState((s) => ({ ...s, [match.id]: "error" }));
        return;
      }

      setSaveState((s) => ({ ...s, [match.id]: "saving" }));
      const result = await saveMatchScore(createClient(), {
        matchId: match.id,
        player1Id: match.player1_id.id,
        player2Id: match.player2_id.id,
        player1Score: next.p1,
        player2Score: next.p2,
        maxScore,
      });

      if (result.ok === false) {
        setSaveState((s) => ({ ...s, [match.id]: "error" }));
        return;
      }

      setSaveState((s) => ({ ...s, [match.id]: "saved" }));
      onSaved?.(match.id);
      // Drop the draft only after the parent has been told to refetch; until
      // its data lands the draft is still what the cell should show.
      setDraft((d) => {
        const { [match.id]: _drop, ...rest } = d;
        return rest;
      });
    },
    [matches, maxScore, onSaved],
  );

  const writeCell = useCallback(
    (at: CellRef, value: number | null) => {
      const match = matches[at.row];
      if (!match) return;
      const current = draft[match.id] ?? {
        p1: match.player1_score,
        p2: match.player2_score,
      };
      const next =
        at.col === 0 ? { ...current, p1: value } : { ...current, p2: value };
      setDraft((d) => ({ ...d, [match.id]: next }));
      setSaveState((s) => ({ ...s, [match.id]: "idle" }));
      if (value !== null) void commitRow(at.row, next);
    },
    [matches, draft, commitRow],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, at: CellRef) => {
      if (!enabled) return;

      const action = handleGridKey(e.key, {
        cursor: at,
        rowCount: matches.length,
        maxScore,
        isRowComplete,
        isDirty: draft[matches[at.row]?.id] !== undefined,
      });

      if (action.kind === "passthrough") return;
      e.preventDefault();

      switch (action.kind) {
        case "move":
          focusCell(action.to);
          break;
        case "write":
          writeCell(action.at, action.value);
          focusCell(action.then);
          break;
        case "revert": {
          const match = matches[action.at.row];
          if (match) {
            setDraft((d) => {
              const { [match.id]: _drop, ...rest } = d;
              return rest;
            });
            setSaveState((s) => ({ ...s, [match.id]: "idle" }));
          }
          break;
        }
        case "exit":
          inputRefs.current.get(cellKey(at.row, at.col))?.blur();
          setCursor(null);
          break;
        case "reject": {
          // Brief flash on the offending cell — the digit is above the cap.
          const key = cellKey(action.at.row, action.at.col);
          setRejected(key);
          setTimeout(() => setRejected((r) => (r === key ? null : r)), 400);
          break;
        }
        case "help":
          onOpenHelp?.();
          break;
      }
    },
    [
      enabled,
      matches,
      maxScore,
      isRowComplete,
      draft,
      focusCell,
      writeCell,
      onOpenHelp,
    ],
  );

  const isCursor = useCallback(
    (row: number, col: ScoreColumn) =>
      cursor?.row === row && cursor?.col === col,
    [cursor],
  );

  const isRejected = useCallback(
    (row: number, col: ScoreColumn) => rejected === cellKey(row, col),
    [rejected],
  );

  /** How many matches still need a result — drives the grid's footer hint. */
  const unscoredCount = useMemo(
    () => matches.reduce((n, _m, i) => (isRowComplete(i) ? n : n + 1), 0),
    [matches, isRowComplete],
  );

  return {
    cursor,
    valueAt,
    saveState,
    unscoredCount,
    registerInput,
    focusCell,
    onKeyDown,
    isCursor,
    isRejected,
  };
}
