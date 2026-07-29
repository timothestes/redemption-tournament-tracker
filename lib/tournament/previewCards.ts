import { findCard } from "@/lib/cards/lookup";
import type { DeckSnapshotCard } from "@/lib/tournament/deckSubmission";

const HERO_TYPES = ["Hero", "HC", "Hero Character"];
const EVIL_TYPES = ["Evil Character", "EC"];

/**
 * Pick cover art for a deck published from a submission snapshot: first hero
 * and first evil character, falling back to the first two main-deck cards.
 *
 * Mirrors the deck builder's auto-pick (app/decklist/card-search/hooks/
 * useDeckState.ts) so a published copy gets the same cover a player's own save
 * would have produced. Reserve is excluded, the same way maybeboard is there —
 * a card the player never fields shouldn't become the deck's face.
 */
export function derivePreviewCards(
  cards: DeckSnapshotCard[]
): [string | null, string | null] {
  const main = cards.filter((c) => c.zone === "main" && c.quantity > 0);
  const typeOf = (c: DeckSnapshotCard) =>
    findCard(c.name, c.set, c.imgFile ?? undefined)?.type ?? "";
  const hero = main.find((c) => HERO_TYPES.includes(typeOf(c)));
  const evil = main.find((c) => EVIL_TYPES.includes(typeOf(c)));
  return [
    hero?.imgFile ?? main[0]?.imgFile ?? null,
    evil?.imgFile ?? (main.length > 1 ? main[1]?.imgFile : null) ?? null,
  ];
}
