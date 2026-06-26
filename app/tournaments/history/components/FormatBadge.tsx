import { fmtClass } from "@/lib/nationals/format";

const FORMAT_STYLES: Record<string, string> = {
  "fmt-T1":      "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  "fmt-T2":      "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30 [.jayden_&]:text-rose-200",
  "fmt-Sealed":  "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  "fmt-Booster": "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  "fmt-Teams":   "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  "fmt-TypeA":   "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  "fmt-default": "bg-muted text-muted-foreground border-border",
};

const PILL = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide";

export function FormatBadge({ format }: { format: string }) {
  const key = fmtClass(format);
  return (
    <span className={`${PILL} ${FORMAT_STYLES[key] ?? FORMAT_STYLES["fmt-default"]}`}>
      {format}
    </span>
  );
}
