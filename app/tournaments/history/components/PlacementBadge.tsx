import { placeBadgeClass, ordinal } from "@/lib/nationals/format";

const PLACE_STYLES: Record<string, string> = {
  "place-1": "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
  "place-2": "bg-slate-400/20 text-slate-700 dark:text-slate-300 border-slate-400/40",
  "place-3": "bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/40",
  "place-n": "bg-muted text-muted-foreground border-border",
};

const PILL = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide";

/** Maps a 0-based leaderboard index to the same color tiers as place-1/2/3/n. */
function rankClass(index: number): string {
  if (index === 0) return PLACE_STYLES["place-1"];
  if (index === 1) return PLACE_STYLES["place-2"];
  if (index === 2) return PLACE_STYLES["place-3"];
  return PLACE_STYLES["place-n"];
}

interface PlacementBadgeProps {
  place: number;
  variant?: "rank";
}

export function PlacementBadge({ place, variant }: PlacementBadgeProps) {
  const colorClass =
    variant === "rank" ? rankClass(place) : PLACE_STYLES[placeBadgeClass(place)] ?? PLACE_STYLES["place-n"];
  return (
    <span className={`${PILL} ${colorClass}`}>
      {ordinal(variant === "rank" ? place + 1 : place)}
    </span>
  );
}
