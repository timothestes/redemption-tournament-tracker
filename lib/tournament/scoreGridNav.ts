// lib/tournament/scoreGridNav.ts
//
// Pure navigation + keystroke logic for the desktop score-entry grid.
//
// Kept free of React and DOM so the whole key map is unit-testable. The
// component layer owns focus (a roving tabindex over real <input> cells) and
// persistence; this module only answers "given the current cell and this key,
// where do we go and what do we write?".
//
// Single-digit assumption: tournaments.max_score is a <select> locked to 5 or 7
// (components/ui/TournamentSettings.tsx), so a score is always one character.
// That's what lets a digit keystroke both write AND advance — two keystrokes
// records a whole match.

/** Which of a match row's two score cells the cursor is on. */
export type ScoreColumn = 0 | 1;

/** A cell address within the round's match list. */
export interface CellRef {
  /** Index into the round's `matches` array. */
  row: number;
  col: ScoreColumn;
}

/** Result of interpreting one keystroke against the grid. */
export type GridAction =
  /** Move the cursor; write nothing. */
  | { kind: "move"; to: CellRef }
  /** Write `value` (null = clear) into `at`, then move the cursor to `then`. */
  | { kind: "write"; at: CellRef; value: number | null; then: CellRef }
  /** Discard the in-progress edit on `at` and restore its saved value. */
  | { kind: "revert"; at: CellRef }
  /** Leave the grid entirely (blur back to the page). */
  | { kind: "exit" }
  /** Open the shortcuts cheatsheet. */
  | { kind: "help" }
  /** A digit outside 0..maxScore — reject it visibly, write nothing. */
  | { kind: "reject"; at: CellRef }
  /** Not a grid key; let the browser handle it. */
  | { kind: "passthrough" };

/** Everything the key handler needs to know about the grid's current state. */
export interface GridContext {
  cursor: CellRef;
  /** Number of match rows in the current round. */
  rowCount: number;
  /** Tournament max_score (5 or 7). Upper bound for a legal digit. */
  maxScore: number;
  /**
   * Per-row scored state, used by `nextUnscored`. Index-aligned with the
   * matches array; a row is "complete" once both its cells hold a value.
   */
  isRowComplete: (row: number) => boolean;
  /** True when the in-progress edit on the cursor differs from what's saved. */
  isDirty?: boolean;
}

const clampRow = (row: number, rowCount: number) =>
  Math.max(0, Math.min(row, rowCount - 1));

/**
 * Step one cell to the right, wrapping P2 → next row's P1. Returns null when
 * already on the very last cell (caller decides whether that's a no-op or a
 * jump to the first unscored row).
 */
export function stepRight(cell: CellRef, rowCount: number): CellRef | null {
  if (cell.col === 0) return { row: cell.row, col: 1 };
  if (cell.row + 1 < rowCount) return { row: cell.row + 1, col: 0 };
  return null;
}

/** Step one cell to the left, wrapping P1 → previous row's P2. */
export function stepLeft(cell: CellRef, rowCount: number): CellRef | null {
  if (cell.col === 1) return { row: cell.row, col: 0 };
  if (cell.row > 0) return { row: cell.row - 1, col: 1 };
  return null;
}

/**
 * First cell of the first incomplete row at or after `from`, wrapping once to
 * the top. Returns null when every row is scored — that's the signal the round
 * is ready to end. This is the Excel "jump to the next blank" behavior, and it
 * targets exactly the rows End Round blocks on.
 */
export function nextUnscored(
  from: number,
  rowCount: number,
  isRowComplete: (row: number) => boolean,
): CellRef | null {
  for (let i = 0; i < rowCount; i++) {
    const row = (from + i) % rowCount;
    if (!isRowComplete(row)) return { row, col: 0 };
  }
  return null;
}

/**
 * Interpret a keystroke. `key` is a raw KeyboardEvent.key.
 *
 * Enter is deliberately NOT a commit key — writes are committed by the
 * component when the cursor leaves a row, so a digit keystroke alone is enough.
 * Enter just advances to the next row, matching spreadsheet muscle memory.
 */
export function handleGridKey(key: string, ctx: GridContext): GridAction {
  const { cursor, rowCount, maxScore, isRowComplete } = ctx;
  if (rowCount === 0) return { kind: "passthrough" };

  // A digit writes and auto-advances. This is the hot path: "3" "1" fills a
  // whole match and lands on the next one.
  if (/^[0-9]$/.test(key)) {
    const value = Number(key);
    if (value > maxScore) return { kind: "reject", at: cursor };
    const forward = stepRight(cursor, rowCount);
    // Falling off the last cell parks on the first still-unscored row so the
    // host is never left staring at a dead cursor with blanks above them.
    const then =
      forward ??
      nextUnscored(0, rowCount, (r) =>
        // The cell we're about to write isn't in state yet, so treat the row
        // we just completed as complete when scanning.
        r === cursor.row ? true : isRowComplete(r),
      ) ??
      cursor;
    return { kind: "write", at: cursor, value, then };
  }

  switch (key) {
    case "ArrowUp":
      return {
        kind: "move",
        to: { row: clampRow(cursor.row - 1, rowCount), col: cursor.col },
      };

    case "ArrowDown":
      return {
        kind: "move",
        to: { row: clampRow(cursor.row + 1, rowCount), col: cursor.col },
      };

    case "ArrowLeft":
      return { kind: "move", to: stepLeft(cursor, rowCount) ?? cursor };

    case "ArrowRight":
      return { kind: "move", to: stepRight(cursor, rowCount) ?? cursor };

    case "Enter": {
      const target =
        cursor.row + 1 < rowCount
          ? { row: cursor.row + 1, col: 0 as ScoreColumn }
          : nextUnscored(0, rowCount, isRowComplete);
      // Every row scored and Enter pressed on the last one — hold position
      // rather than wrapping the host back to the top unnecessarily.
      return { kind: "move", to: target ?? cursor };
    }

    case "Backspace":
    case "Delete":
      return { kind: "write", at: cursor, value: null, then: cursor };

    case "Home":
      return { kind: "move", to: { row: 0, col: 0 } };

    case "End":
      return { kind: "move", to: { row: rowCount - 1, col: 1 } };

    case "Escape":
      // First Escape abandons the in-progress edit; a second one (nothing left
      // to revert) releases focus back to the page.
      return ctx.isDirty ? { kind: "revert", at: cursor } : { kind: "exit" };

    case "?":
      return { kind: "help" };

    default:
      // Tab/Shift+Tab included: DOM order already matches the grid order, so
      // the browser's native tabbing is correct. Don't fight it.
      return { kind: "passthrough" };
  }
}
