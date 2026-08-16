/**
 * The Metagame view's filter vocabulary.
 *
 * Kept out of `app/tournaments/actions.ts` because that file carries the
 * `"use server"` directive, under which every runtime export must be an async
 * function — constants and parsers there are a build error. Client components
 * need these values anyway, and this module is free of card-index imports, so
 * it costs the bundle nothing.
 */

export const METAGAME_FORMATS = ["Limited", "Unlimited", "T2"] as const;
export type MetagameFormatId = (typeof METAGAME_FORMATS)[number];

export const METAGAME_FORMAT_LABELS: Record<MetagameFormatId, string> = {
  Limited: "T1 Limited",
  Unlimited: "T1 Unlimited",
  T2: "Type 2",
};

/**
 * Windows offered on the page. 0 means every published event, all time.
 *
 * Formats are never pooled: a 50–70 card Limited deck and a 100–140 card Type 2
 * deck share a card pool but nothing else, so a combined median or play rate
 * would describe no real deck. The format filter is a choice, not a facet.
 */
export const METAGAME_WINDOWS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
  { days: 365, label: "12 months" },
  { days: 0, label: "All time" },
];

export const DEFAULT_METAGAME_FORMAT: MetagameFormatId = "Limited";

// Events are sparse enough that a short default window would show an empty page
// for most of the year.
export const DEFAULT_METAGAME_DAYS = 365;

export function parseMetagameFormat(raw: string | undefined): MetagameFormatId {
  return (METAGAME_FORMATS as readonly string[]).includes(raw ?? "")
    ? (raw as MetagameFormatId)
    : DEFAULT_METAGAME_FORMAT;
}

export function parseMetagameDays(raw: string | undefined): number {
  const parsed = Number(raw);
  return METAGAME_WINDOWS.some((w) => w.days === parsed) ? parsed : DEFAULT_METAGAME_DAYS;
}

export function windowLabel(days: number): string {
  return METAGAME_WINDOWS.find((w) => w.days === days)?.label ?? `${days} days`;
}
