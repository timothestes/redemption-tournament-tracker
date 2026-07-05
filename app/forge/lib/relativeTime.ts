// Compact relative-time formatter for Forge comment threads.
// Finer granularity (minute/hour) than the day-only community-page helper,
// since a review thread wants "5m ago" vs "today". `nowMs` is injectable for tests.
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const secs = Math.floor((nowMs - then) / 1000);
  if (!Number.isFinite(secs) || secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
