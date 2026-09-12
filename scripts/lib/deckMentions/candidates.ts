/**
 * Which names a deck's description may have its text wrapped around.
 *
 * A deck card is stored as the printing the builder clicked ("Son of God (J)"),
 * while prose almost always says the stem ("Son of God"). Both are offered, but
 * only when the resulting `[[mention]]` resolves back to THAT card: `[[Aaron]]`
 * would point at whichever Aaron the index prefers, which may not be the one in
 * this deck, and a mention that renames someone's card is worse than no link.
 */
import { CARDS, findCard } from "@/lib/cards/lookup";
import { cardIdentityKey, cardNameStem } from "@/lib/cards/cardIdentity";
import { cardNameKey } from "@/lib/cards/nameKey";
import { resolveCardRef } from "@/app/articles/lib/cardRefs";

/** `[[Son of God [K]]]` does not parse — the mention syntax forbids brackets. */
const UNMENTIONABLE = /[[\]\n]/;

let known: Set<string> | null = null;

/**
 * Every printing name and stem in the index, for the linker's "is this text
 * itself a card name?" question. Built once; the index has a few thousand rows.
 */
export function isKnownCardName(text: string): boolean {
  if (!known) {
    known = new Set<string>();
    for (const card of CARDS) {
      known.add(cardNameKey(card.name));
      known.add(cardNameKey(cardNameStem(card.name, card.type)));
    }
  }
  return known.has(cardNameKey(text));
}

export function candidatesForDeck(deckCardNames: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const printing of new Set(deckCardNames)) {
    const card = findCard(printing);
    if (!card) continue; // not in the public index (forge card, renamed printing)
    const identity = cardIdentityKey(card);
    for (const candidate of [printing, cardNameStem(card.name, card.type)]) {
      if (!candidate || UNMENTIONABLE.test(candidate)) continue;
      const ref = resolveCardRef(candidate);
      if (!ref) continue;
      const target = findCard(ref.name);
      if (!target || cardIdentityKey(target) !== identity) continue;
      out.add(candidate);
    }
  }
  return [...out];
}
