/**
 * Which names a deck's description may have its text wrapped around, and what
 * each one should point at.
 *
 * A deck card is stored as the printing the builder clicked ("Jacob (FooF)"),
 * while prose says the plain name ("Jacob"). The plain name is preferred — it
 * is what the author wrote — but only when it resolves back to THAT card. It
 * often does not: `[[Jacob]]` lands on Jacob (Israel), `[[Simeon]]` on the
 * Simeon who blessed Jesus. Rather than drop those, the mention points at the
 * deck's own printing and carries the author's words as its label.
 */
import { CARDS, findCard } from "@/lib/cards/lookup";
import { cardIdentityKey, cardNameStem } from "@/lib/cards/cardIdentity";
import { cardNameKey } from "@/lib/cards/nameKey";
import { resolveCardRef } from "@/app/articles/lib/cardRefs";
import type { Candidate } from "./linkCards";

/** `[[Son of God [K]]]` does not parse — the mention syntax forbids brackets. */
const UNMENTIONABLE = /[[\]\n|]/;

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

/**
 * A reprint whose printing name is unmentionable ("A New Beginning [RR2]") has
 * no usable alias target, so the plain name is the only way to link it. Accept
 * it when the two are the same card in everything but brigade — which is what a
 * reprint changes, and what splits them into different identities in the index.
 */
function sameCardBarBrigade(plain: string, printing: string): boolean {
  const a = resolveCardRef(plain);
  const b = findCard(printing);
  const card = a ? findCard(a.name) : undefined;
  if (!card || !b) return false;
  return (
    cardNameKey(cardNameStem(card.name, card.type)) === cardNameKey(cardNameStem(b.name, b.type)) &&
    card.type === b.type &&
    card.alignment === b.alignment
  );
}

/** The identity a bare `[[name]]` would land on, or undefined. */
function identityOf(name: string): string | undefined {
  const ref = resolveCardRef(name);
  const card = ref ? findCard(ref.name) : undefined;
  return card ? cardIdentityKey(card) : undefined;
}

/** True when writing `[[written]]` on its own reaches the same card as `target`. */
export function resolvesTo(written: string, target: string): boolean {
  const wanted = identityOf(target);
  return !!wanted && identityOf(written) === wanted;
}

export function candidatesForDeck(deckCardNames: Iterable<string>): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const printing of new Set(deckCardNames)) {
    const card = findCard(printing);
    if (!card) continue; // not in the public index (forge card, renamed printing)
    const identity = cardIdentityKey(card);
    const aliasTarget = UNMENTIONABLE.test(card.name) ? null : card.name;
    for (const name of [printing, cardNameStem(card.name, card.type)]) {
      if (!name || UNMENTIONABLE.test(name)) continue;
      // The plain name if it lands on this very card, else the deck's printing,
      // else — for a bracketed reprint — the plain name if it is the same card.
      const target =
        identityOf(name) === identity
          ? name
          : (aliasTarget ?? (sameCardBarBrigade(name, printing) ? name : null));
      if (!target) continue;
      const key = `${name}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, target });
    }
  }
  return out;
}
