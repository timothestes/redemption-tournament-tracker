// Sensible defaults for a new tournament based on its category/format. These are
// only a head start — the host can change any of them in Tournament Settings
// after the tournament is created.

export interface CategoryDefaults {
  deck_format: "T1" | "T2" | "Paragon" | "Other";
  max_score: number; // Lost Souls needed to win a game
  round_length: number; // minutes
}

// Categories offered when hosting a tournament that isn't tied to an official
// listing's own format list.
export const STANDARD_CATEGORIES = [
  "Type 1 - 2P",
  "Type 2 - 2P",
  "Booster Draft",
  "Sealed Deck",
  "Teams",
  "Type A - 2P",
  "Paragon",
] as const;

// Maps a category/format string (from a listing or the standard list) to its
// defaults. Matching is fuzzy so listing strings like "Type 2 2-Player" or
// "Booster Draft (GoC x3...)" still resolve correctly.
export function categoryDefaults(category: string): CategoryDefaults {
  const c = category.toLowerCase();
  if (c.includes("paragon"))
    return { deck_format: "Paragon", max_score: 5, round_length: 40 };
  // Teams is built to Type 1 deck rules (per the hosting guide), so it wins at
  // 5 souls — not 7. Checked before Type 2 so it never falls through.
  if (c.includes("teams"))
    return { deck_format: "T1", max_score: 5, round_length: 60 };
  if (c.includes("type 2") || c.includes("type2"))
    return { deck_format: "T2", max_score: 7, round_length: 75 };
  if (c.includes("draft"))
    return { deck_format: "Other", max_score: 5, round_length: 45 };
  if (c.includes("sealed"))
    return { deck_format: "Other", max_score: 5, round_length: 45 };
  // Type 1 and Type A (a Type 1 variant) and anything else default to Type 1.
  return { deck_format: "T1", max_score: 5, round_length: 45 };
}
