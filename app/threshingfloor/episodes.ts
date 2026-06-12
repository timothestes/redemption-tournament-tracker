export interface DraftListRow {
  episode_number: string;
  updated_at: string;
}

const NUMERIC_RE = /^\d+(\.\d+)?$/;

export function normalizeEpisode(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.includes("/") || t.length > 100) return null;
  return t;
}

export function isNumericEpisode(s: string): boolean {
  return NUMERIC_RE.test(s);
}

export function pickPreviousEpisode(episodes: string[], before: string): string | null {
  if (!isNumericEpisode(before)) return null;
  const target = parseFloat(before);
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const ep of episodes) {
    if (!isNumericEpisode(ep)) continue;
    const v = parseFloat(ep);
    if (v < target && v > bestVal) {
      bestVal = v;
      best = ep;
    }
  }
  return best;
}

export function sortDraftsForList(rows: DraftListRow[]): DraftListRow[] {
  return [...rows].sort((a, b) => {
    const an = isNumericEpisode(a.episode_number);
    const bn = isNumericEpisode(b.episode_number);
    if (an && bn) return parseFloat(b.episode_number) - parseFloat(a.episode_number);
    if (an) return -1;
    if (bn) return 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}
