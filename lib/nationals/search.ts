/**
 * Redemption Nationals History — pure global search.
 * No DOM, no React. Port of `globalSearch` SRC:1233-1250.
 */

import type { NationalsData, Player, Tournament } from "./types";

export interface SearchResults {
  players: Player[];
  tournaments: Tournament[];
}

/**
 * Case-insensitive full-text search across players and tournaments.
 *
 * Players matched by name or handle.
 * Tournaments matched by year, location, or venue.
 *
 * Returns empty arrays for blank/whitespace queries.
 *
 * Ports `globalSearch` SRC:1233-1250.
 */
export function globalSearch(seed: NationalsData, q: string): SearchResults {
  const query = q.trim().toLowerCase();
  if (!query) return { players: [], tournaments: [] };

  const players = seed.players.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      (p.handle || "").toLowerCase().includes(query)
  );

  const tournaments = seed.tournaments.filter(
    (t) =>
      String(t.year).includes(query) ||
      (t.location || "").toLowerCase().includes(query) ||
      (t.venue || "").toLowerCase().includes(query)
  );

  return { players, tournaments };
}
