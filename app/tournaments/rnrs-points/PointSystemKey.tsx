import { LEVELS, LEVEL_CAPS, LEVEL_LABELS, LEVEL_PTS } from "@/lib/rnrs/config";

const ordinals = ["1st", "2nd", "3rd"];

/** The RNRS point/cap reference card shown above the leaderboard. Static. */
export default function PointSystemKey() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">RNRS Point System</h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {LEVELS.map((level) => {
          const pts = LEVEL_PTS[level];
          const cap = LEVEL_CAPS[level];
          return (
            <div
              key={level}
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
            >
              <div className="font-semibold text-foreground">
                {LEVEL_LABELS[level]}
              </div>
              <div className="mt-0.5 text-muted-foreground tabular-nums">
                {pts.map((p, i) => `${ordinals[i]}: ${p}`).join(" · ")}
              </div>
              <div className="mt-0.5 text-muted-foreground">
                max {cap} {cap === 1 ? "win" : "wins"} / format
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Only a player&apos;s best wins count once a level&apos;s per-format cap is
        reached. Capped cells show the counted value with the uncapped total{" "}
        <span className="line-through">struck through</span> and an amber{" "}
        <span className="font-semibold uppercase text-amber-600 dark:text-amber-500">
          cap
        </span>{" "}
        tag — so every row still adds up to its Total.
      </p>
    </div>
  );
}
