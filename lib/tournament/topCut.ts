/**
 * Top-cut sizing, kept in its own module so the browser can have it cheaply.
 *
 * `breakdown.ts` reaches the card index through `cardIdentity`, which pulls the
 * whole 5,692-card dataset in with it. That is fine on the server, but a client
 * component importing any *value* from `breakdown.ts` drags the entire index
 * into the bundle — it took this route's first load from ~220 kB to 586 kB.
 * Types erase at compile time, so the client can keep importing those; this is
 * the one runtime helper it needs.
 */

/**
 * Number of decks in the cut, given a cutoff.
 *
 * `topCut` is a deck count (8, 16) or a fraction of the field when below 1
 * (0.25). Only decks with a recorded placement can be in a cut.
 */
export function topCutSize(deckCount: number, topCut: number): number {
  if (topCut <= 0) return 0;
  const size = topCut < 1 ? Math.round(deckCount * topCut) : topCut;
  return Math.max(1, Math.min(deckCount, Math.round(size)));
}

/** The minimum a deck needs to be placed in a cut: a finish, and an event. */
export interface RankedDeck {
  place: number | null;
  /** Absent on a single-event page, where every deck shares one field. */
  eventId?: string | null;
}

/**
 * Indexes of the decks inside the cut, drawn separately for each event.
 *
 * A cut only means something relative to the field it was drawn from. Pool
 * several events and "place 4" stops being comparable: 4th of 72 is the top 6%
 * of that field, 4th of 12 is the top third. Ranking the pooled decks by place
 * would hand every small event's leaderboard the same weight as a Nationals
 * top table, and a fixed count is worse still — "top 8" of a 12-player event is
 * two thirds of it.
 *
 * So the cut is applied within each event and the survivors are pooled. With a
 * fractional cutoff that reads as "the top quarter of every event", which is
 * the same question asked of every field regardless of size.
 *
 * A single-event page is the degenerate case: one group, identical to ranking
 * the whole list.
 */
export function cutIndexesByEvent(decks: RankedDeck[], topCut: number): Set<number> {
  const byEvent = new Map<string, { place: number; index: number }[]>();

  decks.forEach((deck, index) => {
    // A deck with no recorded finish can never be in a cut, and counting it
    // among the ranked would deflate every event's cut size.
    if (typeof deck.place !== "number") return;
    const key = deck.eventId ?? "";
    const group = byEvent.get(key);
    if (group) group.push({ place: deck.place, index });
    else byEvent.set(key, [{ place: deck.place, index }]);
  });

  const cut = new Set<number>();
  for (const group of byEvent.values()) {
    group.sort((a, b) => a.place - b.place);
    const size = topCutSize(group.length, topCut);
    for (let i = 0; i < size; i += 1) cut.add(group[i].index);
  }
  return cut;
}

/** Decks carrying a recorded finish — the denominator a cut is drawn from. */
export function rankedDeckCount(decks: RankedDeck[]): number {
  return decks.reduce((count, deck) => (typeof deck.place === "number" ? count + 1 : count), 0);
}
