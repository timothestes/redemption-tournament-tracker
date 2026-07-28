/** One formula everywhere: frozen generated names make events sort/group
 * predictably in the public dataset. */
export function buildTournamentName(
  category: string,
  opts?: { date?: Date; city?: string }
): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(opts?.date ?? new Date());
  const base = `${date} ${category} Tournament`;
  return opts?.city ? `${base} — ${opts.city}` : base;
}

export function isNameFrozen(category: string | null): boolean {
  return !!category && category !== "Unofficial";
}
