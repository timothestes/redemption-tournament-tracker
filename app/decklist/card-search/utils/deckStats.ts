/**
 * Shared helpers for every deck statistic the app displays.
 *
 * The maybeboard is a scratchpad of cards under consideration — it is not part
 * of the deck, so it must never reach a stat, price, or composition figure.
 * Routing all aggregation through these helpers keeps that guarantee in one
 * place instead of relying on each call site to remember the zone filter.
 */

interface ZonedCard {
  zone: string;
}

interface CountableCard extends ZonedCard {
  quantity: number;
}

/** The cards that count toward deck stats: main + reserve, never maybeboard. */
export function statCards<T extends ZonedCard>(cards: T[]): T[] {
  return cards.filter((c) => c.zone !== "maybeboard");
}

/** Total number of copies in the deck (main + reserve). */
export function sumQuantity<T extends CountableCard>(cards: T[]): number {
  return statCards(cards).reduce((sum, c) => sum + c.quantity, 0);
}

/**
 * Tally card copies by a caller-supplied key — card type, alignment, brigade.
 * `keyOf` may return several keys (a multi-brigade card counts under each) or
 * null to skip the card entirely.
 */
export function countBy<T extends CountableCard>(
  cards: T[],
  keyOf: (card: T) => string | string[] | null | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of statCards(cards)) {
    const key = keyOf(card);
    if (key == null) continue;
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      counts[k] = (counts[k] || 0) + card.quantity;
    }
  }
  return counts;
}
