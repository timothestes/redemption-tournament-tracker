// A tournament's sanctioning tier, orthogonal to its category/format: a
// Regional and a Local can both be Type 1 Unlimited. Mirrors the vocabulary the
// public listings already use (tournament_listings.tournament_type), so an
// event hosted from a listing inherits the tier the listing advertised.

export const TOURNAMENT_TIERS = [
  "Local (Open)",
  "Local (Closed)",
  "District",
  "State",
  "Regional",
  "National",
] as const;

export type TournamentTier = (typeof TOURNAMENT_TIERS)[number];

/**
 * Map a listing's free-text tournament_type onto a canonical tier. Listings
 * carry named variants — "South Central Regional", "Redemption National
 * Tournament", "Midwest Regional" — that all collapse to their base tier.
 * Returns null for anything unrecognized so an odd listing leaves the tier
 * unset rather than guessing.
 */
export function normalizeTier(raw: string | null | undefined): TournamentTier | null {
  const t = (raw ?? "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("national")) return "National";
  if (t.includes("regional")) return "Regional";
  if (t.includes("district")) return "District";
  if (t.includes("state")) return "State";
  if (t.includes("local")) return t.includes("closed") ? "Local (Closed)" : "Local (Open)";
  return null;
}
