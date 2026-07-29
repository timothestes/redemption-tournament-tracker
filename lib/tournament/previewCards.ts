import { findCard } from "@/lib/cards/lookup";
import type { DeckSnapshotCard } from "@/lib/tournament/deckSubmission";

/**
 * Pick cover art for a deck published from a submission snapshot: a hero and an
 * evil character, falling back to the first main-deck cards that have art.
 *
 * Follows the deck builder's auto-pick (app/decklist/card-search/hooks/
 * useDeckState.ts) in spirit — hero first, EC second — but deliberately differs
 * in three ways, because that version was written against an in-memory deck and
 * this one runs on a snapshot:
 *   - dual types count ("Hero/GE", "GE/Evil Character"); the builder's exact
 *     match misses them, which sends decks whose only EC is a dual type down
 *     the positional fallback
 *   - a card with no usable art is skipped rather than stored as a null cover,
 *     which would leave the community tile blank — the whole point of this
 *     function
 *   - the second slot never repeats the first
 *
 * Reserve is excluded, the same way maybeboard is in the builder — a card the
 * player never fields shouldn't become the deck's face.
 */
export function derivePreviewCards(
  cards: DeckSnapshotCard[]
): [string | null, string | null] {
  // Forge refs resolve to nothing on the public CDN, so they'd render blank.
  const withArt = cards.filter(
    (c) => c.zone === "main" && c.quantity > 0 && c.imgFile && !c.imgFile.startsWith("forge:")
  );
  const typeOf = (c: DeckSnapshotCard) =>
    findCard(c.name, c.set, c.imgFile ?? undefined)?.type ?? "";
  const isHero = (c: DeckSnapshotCard) => /(^|\/)\s*Hero\s*(\/|$)/.test(typeOf(c));
  const isEvil = (c: DeckSnapshotCard) => /(^|\/)\s*Evil Character\s*(\/|$)/.test(typeOf(c));

  const first = withArt.find(isHero)?.imgFile ?? withArt[0]?.imgFile ?? null;
  const second =
    withArt.find((c) => isEvil(c) && c.imgFile !== first)?.imgFile ??
    withArt.find((c) => c.imgFile !== first)?.imgFile ??
    null;
  return [first, second];
}
