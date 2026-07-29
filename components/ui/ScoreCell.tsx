"use client";

import { forwardRef } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import type { RowSaveState } from "./useScoreGrid";

/**
 * One editable score cell in the desktop round table.
 *
 * A real <input> rather than a tabIndex'd div so it inherits caret, selection,
 * and assistive-tech behavior for free. maxLength=1 is safe because
 * tournaments.max_score is locked to 5 or 7, so a score is always one digit.
 *
 * Focus is shown with a surface shift plus a solid accent underline rather than
 * a ring — consistent with the design system's tonal-layering rule.
 */
export const ScoreCell = forwardRef<
  HTMLInputElement,
  {
    value: number | null;
    playerName: string;
    isCursor: boolean;
    isRejected: boolean;
    saveState: RowSaveState;
    disabled?: boolean;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onFocus: () => void;
  }
>(function ScoreCell(
  { value, playerName, isCursor, isRejected, saveState, disabled, onKeyDown, onFocus },
  ref,
) {
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      maxLength={1}
      readOnly
      disabled={disabled}
      value={value === null ? "" : String(value)}
      placeholder="–"
      aria-label={`Score for ${playerName}`}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      // Every mutation goes through the key handler, which owns validation and
      // cursor movement. readOnly keeps the browser from inserting characters
      // behind its back (paste, IME, autofill) while still allowing focus.
      onChange={() => {}}
      className={[
        "w-9 h-9 rounded-md text-center text-sm font-medium tabular-nums",
        "transition-colors caret-transparent cursor-pointer",
        // Bottom accent only — the design system forbids 1px boxes for
        // structure, so the active cell reads as a surface shift plus an
        // underline rather than an outlined box.
        "border-0 border-b-2 outline-none",
        "placeholder:text-muted-foreground/50",
        disabled
          ? "bg-transparent border-transparent text-muted-foreground cursor-not-allowed"
          : isRejected
            ? "bg-destructive/15 border-destructive text-foreground"
            : isCursor
              ? "bg-muted border-primary text-foreground"
              : saveState === "error"
                ? "bg-destructive/10 border-destructive/50 text-foreground"
                : "bg-muted/40 border-transparent text-foreground hover:bg-muted",
      ].join(" ")}
    />
  );
});

/** Per-row save indicator, sized to never shift the row's layout. */
export function SaveIndicator({ state }: { state: RowSaveState }) {
  return (
    <span className="inline-flex w-4 justify-center" aria-live="polite">
      {state === "saving" && (
        <Loader2
          className="w-3 h-3 animate-spin text-muted-foreground"
          aria-label="Saving"
        />
      )}
      {state === "saved" && (
        <Check className="w-3 h-3 text-primary" aria-label="Saved" />
      )}
      {state === "error" && (
        <TriangleAlert
          className="w-3 h-3 text-destructive"
          aria-label="Failed to save — check the score"
        />
      )}
    </span>
  );
}
