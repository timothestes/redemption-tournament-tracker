import { HelpCircle } from "lucide-react";

/** Canonical tooltip copy for the match-points and differential columns,
 * shared across the standings, round pairings, and bye tables. */
export const MP_HINT =
  "Match Points (MP) — points earned from wins, ties, and byes. The primary metric for ranking players.";
export const DIFF_HINT =
  "Differential (Diff) — cumulative lost-soul-score margin. Used to break ties between players with equal match points.";

/** Round-scoped variants for the Rounds tab, where the columns show what was
 * earned in THIS round only — not the running total. The Standings tab is the
 * source of truth for cumulative MP and differential. */
export const MP_ROUND_HINT =
  "Match Points (MP) earned this round only — from this round's win, tie, or bye. See Standings for cumulative totals.";
export const DIFF_ROUND_HINT =
  "Differential (Diff) for this round only — the lost-soul-score margin in this round's match. See Standings for cumulative totals.";

/**
 * A small, visible info icon that surfaces an explanatory tooltip on hover.
 * Used to demystify abbreviated column headers (MP, Diff, …) for users who
 * may not know what they stand for.
 *
 * Uses the native `title` attribute on a wrapping span so the tooltip works
 * reliably inside tables with `overflow-hidden`/`overflow-x-auto` wrappers,
 * which would clip a CSS-positioned popup.
 */
export default function InfoHint({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="inline-flex cursor-help align-middle text-muted-foreground/70 hover:text-foreground"
    >
      <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
    </span>
  );
}
