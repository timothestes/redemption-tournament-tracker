import type { ManifestEntry } from "./media";

/** The sort key wpDateToIso uses: the GMT date, unless it is WordPress's 0000 sentinel. */
const dateKey = (p: { dateGmt: string; date: string }) => (p.dateGmt && !p.dateGmt.startsWith("0000-") ? p.dateGmt : p.date);

/** The N newest posts, newest first. */
export const newest = <T extends { dateGmt: string; date: string }>(posts: T[], n: number): T[] =>
  [...posts].sort((a, b) => dateKey(b).localeCompare(dateKey(a)) || b.date.localeCompare(a.date)).slice(0, n);

/**
 * Which manifest statuses may be rewritten into a post body: a dry run has nothing in the store
 * yet, so it previews what the mirror URL WILL be; a live run rewrites only what the store
 * confirmed, so a failed upload keeps its original URL rather than publishing a dead link (§9).
 */
export const usableStatuses = (mode: "dry-run" | "live"): ReadonlySet<ManifestEntry["status"]> =>
  new Set<ManifestEntry["status"]>(mode === "dry-run" ? ["planned", "exists", "uploaded"] : ["exists", "uploaded"]);
