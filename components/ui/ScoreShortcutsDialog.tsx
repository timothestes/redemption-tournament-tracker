"use client";

import { useEffect, useRef } from "react";
import { Keyboard } from "lucide-react";
import { Dialog, DialogContent } from "./dialog";

/**
 * Cheatsheet for the desktop keyboard score grid, plus the ⌨ trigger that
 * opens it. Desktop-only — the mobile pairing cards keep the tap-the-pencil
 * flow, so the trigger is hidden below `md`.
 */

interface ShortcutRow {
  keys: string[];
  /** Separator drawn between key chips — plain text, never itself a chip. */
  joiner?: string;
  label: string;
}

const NAV_SHORTCUTS: ShortcutRow[] = [
  { keys: ["0", "5"], joiner: "–", label: "Type a score — fills the cell and jumps to the next" },
  { keys: ["Enter"], label: "Next match (or the next unscored one from the bottom)" },
  { keys: ["→", "←"], joiner: "/", label: "Move between the two players" },
  { keys: ["↑", "↓"], joiner: "/", label: "Same player, previous / next match" },
  { keys: ["Tab"], label: "Next cell (same as →)" },
  { keys: ["Home", "End"], joiner: "/", label: "First / last cell" },
];

const EDIT_SHORTCUTS: ShortcutRow[] = [
  { keys: ["Backspace"], label: "Clear this score" },
  { keys: ["Esc"], label: "Undo the current cell, then leave the grid" },
  { keys: ["?"], label: "Open this cheatsheet" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground">
      {children}
    </kbd>
  );
}

function ShortcutList({ rows }: { rows: ShortcutRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-baseline gap-3">
          <span className="flex shrink-0 items-center gap-1">
            {row.keys.map((key, i) => (
              <span key={key} className="flex items-center gap-1">
                {i > 0 && row.joiner && (
                  <span className="text-xs text-muted-foreground">{row.joiner}</span>
                )}
                <Kbd>{key}</Kbd>
              </span>
            ))}
          </span>
          <span className="text-sm text-muted-foreground">{row.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreShortcutsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Keyboard shortcuts for score entry"
      title="Keyboard shortcuts (?)"
      className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Keyboard className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

export function ScoreShortcutsDialog({
  open,
  onOpenChange,
  maxScore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxScore: number;
}) {
  // The digit row is the one line that depends on the tournament's soul cap.
  const navRows = NAV_SHORTCUTS.map((row) =>
    row.keys[0] === "0" ? { ...row, keys: ["0", String(maxScore)] } : row,
  );

  // The Dialog primitive is hand-rolled and does not trap focus, so opening the
  // cheatsheet from a score cell would leave that cell focused underneath —
  // every keystroke spent reading this would land in the grid behind it.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="bg-card border-2 border-border px-8 py-7">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-bold text-foreground outline-none"
        >
          Keyboard score entry
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Click any score cell in the round table to start. Most matches are two
          keystrokes — type both scores and you land on the next match.
        </p>

        <div className="mt-6 space-y-6">
          <section>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Moving around
            </h3>
            <ShortcutList rows={navRows} />
          </section>
          <section>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fixing and leaving
            </h3>
            <ShortcutList rows={EDIT_SHORTCUTS} />
          </section>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Scores save on their own as you type. The pencil still works for
          editing one match at a time.
        </p>
      </DialogContent>
    </Dialog>
  );
}
