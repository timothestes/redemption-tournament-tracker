/** One formula everywhere: frozen generated names make events sort/group
 * predictably in the public dataset. */
export function buildTournamentName(
  category: string,
  opts?: { date?: Date; city?: string; tier?: string | null }
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
  return opts?.city ? `${base} — ${opts.city}` : base;
}

export function isNameFrozen(category: string | null): boolean {
  return !!category && category !== "Unofficial";
}
