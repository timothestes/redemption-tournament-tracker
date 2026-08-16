"use client";

/**
 * Where to draw the top cut.
 *
 * Shared by the frequency table and the scatter so the two never disagree, and
 * always prints the resulting deck count — the whole point of the control is
 * that a reader can see how thin the sample gets.
 */
/** Cutoffs offered when the pool is a single tournament. */
export const SINGLE_EVENT_CUTS = [
  { value: 8, label: "Top 8" },
  { value: 16, label: "Top 16" },
  { value: 0.25, label: "Top 25%" },
];

/**
 * Cutoffs offered when the pool spans several tournaments.
 *
 * Fractions only, because a fixed count is not comparable across field sizes:
 * "top 8" is the top 13% of a 62-player event and two thirds of a 12-player
 * one, so pooling the two would let the small event dominate the cut.
 */
export const CROSS_EVENT_CUTS = [
  { value: 0.1, label: "Top 10%" },
  { value: 0.25, label: "Top 25%" },
  { value: 0.5, label: "Top 50%" },
];

export default function TopCutControl({
  topCut,
  onChange,
  cutSize,
  rankedDeckCount,
  options = SINGLE_EVENT_CUTS,
  perEvent = false,
}: {
  topCut: number;
  onChange: (value: number) => void;
  cutSize: number;
  rankedDeckCount: number;
  options?: { value: number; label: string }[];
  /** Label the cut as drawn within each event rather than across the pool. */
  perEvent?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Cut
      </span>
      <div className="inline-flex gap-1 rounded-lg bg-muted/50 p-0.5">
        {options.map((option) => {
          const isActive = option.value === topCut;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={isActive}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "font-medium text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {cutSize} of {rankedDeckCount} placed decks
        {perEvent && <span className="ml-1 text-muted-foreground/70">· per event</span>}
      </span>
    </div>
  );
}
