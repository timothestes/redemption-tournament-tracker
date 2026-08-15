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
