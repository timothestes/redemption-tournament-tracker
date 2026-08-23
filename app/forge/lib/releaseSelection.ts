// Pure selection logic for selective ("wave") releases. Lives outside
// promote.ts because that file's "use server" directive forbids non-async
// exports. Design: docs/superpowers/specs/2026-08-23-forge-selective-release-design.md

export type RosterGroup = "approved" | "unapproved" | "promoted";

export type RosterEntry = { cardId: string; title: string; status: string; group: RosterGroup };

export type RosterCard = {
  id: string;
  title: string | null;
  status: string;
  approvedVersionId: string | null;
};

// Archived cards are invisible to the release flow; promoted cards render for
// context only; approved-with-version cards are the selectable pool.
export function groupRoster(cards: RosterCard[]): RosterEntry[] {
  return cards
    .filter((c) => c.status !== "archived")
    .map((c) => ({
      cardId: c.id,
      title: (c.title ?? "").trim() || "Untitled",
      status: c.status,
      group:
        c.status === "promoted"
          ? ("promoted" as const)
          : c.status === "approved" && c.approvedVersionId
            ? ("approved" as const)
            : ("unapproved" as const),
    }));
}

export function defaultSelection(roster: RosterEntry[]): string[] {
  return roster.filter((r) => r.group === "approved").map((r) => r.cardId);
}

// A release may close the set only when it covers EVERY remaining releasable
// card — an unapproved card can never be selected, so its presence alone
// makes closing ineligible.
export function isCloseEligible(roster: RosterEntry[], selectedIds: string[]): boolean {
  const selected = new Set(selectedIds);
  const releasable = roster.filter((r) => r.group !== "promoted");
  return releasable.length > 0 && releasable.every((r) => selected.has(r.cardId));
}

export function sameSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((id) => bs.has(id));
}
