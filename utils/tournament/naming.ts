/** The location suffix on a generated name: "Wichita, KS", or just whichever
 * half is set. Empty string when the event has no location at all. */
export function formatLocation(
  city?: string | null,
  state?: string | null
): string {
  const parts = [city?.trim(), state?.trim()].filter(Boolean);
  return parts.join(", ");
}

/** One formula everywhere: frozen generated names make events sort/group
 * predictably in the public dataset. */
export function buildTournamentName(
  category: string,
  opts?: {
    date?: Date;
    city?: string | null;
    state?: string | null;
    tier?: string | null;
  }
): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(opts?.date ?? new Date());
  // Tier sits between the date and the category ("Aug 2, 2026 Regional Type 2
  // Tournament") and is simply absent when the event has none.
  const subject = [opts?.tier, category].filter(Boolean).join(" ");
  const base = `${date} ${subject} Tournament`;
  const location = formatLocation(opts?.city, opts?.state);
  return location ? `${base} — ${location}` : base;
}

export function isNameFrozen(category: string | null): boolean {
  return !!category && category !== "Unofficial";
}
