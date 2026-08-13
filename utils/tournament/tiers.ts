// A tournament's sanctioning tier, orthogonal to its category/format: a
// Regional and a Seasonal can both be Type 1 Unlimited. Mirrors the vocabulary
// the public listings already use (tournament_listings.tournament_type), so an
// event hosted from a listing inherits the tier the listing advertised.

// The 2026 Host Guide (v26.0.0, published 8/13/2026) replaced Local (Open),
// Local (Closed) and District with a single Seasonal level, leaving four.
export const TOURNAMENT_TIERS = [
  "Seasonal",
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
 *
 * Cactus's feed still advertises events sanctioned under the retired levels,
 * so "Local (Open)", "Local (Closed)" and "District" keep resolving — onto
 * Seasonal, the level that replaced them.
 */
export function normalizeTier(raw: string | null | undefined): TournamentTier | null {
  const t = (raw ?? "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("national")) return "National";
  if (t.includes("regional")) return "Regional";
  if (t.includes("state")) return "State";
  if (t.includes("seasonal") || t.includes("district") || t.includes("local"))
    return "Seasonal";
  return null;
}
