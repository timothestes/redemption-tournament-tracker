/**
 * Community shorthand that is NOT a card — set codes ("LoC") and game terms
 * ("EC", "CBI"). Sourced from redemptionccgfl.weebly.com/abbreviations-etc.html.
 *
 * A `[[mention]]` of one of these renders the shorthand the author wrote and
 * explains it on hover or tap, the way a card mention previews its card. That
 * keeps deck-tech voice intact for readers who know the jargon while giving a
 * newcomer a way in.
 *
 * Static on purpose: unlike card aliases ([[project-curated, editable in
 * /admin/catalog]]) this list is the rulebook's vocabulary, not a judgement
 * call about printings, and it changes about once a decade. A table and an
 * editor would be machinery around a constant.
 *
 * Terms are resolved LAST, after cards and card aliases, and a test asserts
 * this list collides with neither — a term that shadows a card could never
 * render, because the card always wins.
 */
import { cardNameKey } from "@/lib/cards/nameKey";

export interface GlossaryTerm {
  /** The shorthand, as people write it — what stands on the page. */
  term: string;
  expansion: string;
  kind: "set" | "term";
}

export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  { term: "AB", expansion: "Alternate Border Version", kind: "term" },
  { term: "Ap", expansion: "Apostles", kind: "set" },
  { term: "AW", expansion: "Angel Wars", kind: "set" },
  { term: "BC", expansion: "Battle Challenge", kind: "term" },
  { term: "CBI", expansion: "Cannot be Interrupted", kind: "term" },
  { term: "CBN", expansion: "Cannot be Negated", kind: "term" },
  { term: "CBP", expansion: "Cannot be Prevented", kind: "term" },
  { term: "CoW", expansion: "Cloud of Witnesses", kind: "set" },
  { term: "CTB", expansion: "Choose the Blocker", kind: "term" },
  { term: "Di", expansion: "Disciples", kind: "set" },
  { term: "EC", expansion: "Evil Character", kind: "term" },
  { term: "EE", expansion: "Evil Enhancement", kind: "term" },
  { term: "FBN", expansion: "Fight by Numbers", kind: "term" },
  { term: "FBTN", expansion: "Fight by the Numbers", kind: "term" },
  { term: "FoM", expansion: "Fall of Man", kind: "set" },
  { term: "FooF", expansion: "Faith of our Fathers", kind: "set" },
  { term: "GG", expansion: "Good Game", kind: "term" },
  { term: "Ki", expansion: "Kings", kind: "set" },
  { term: "L", expansion: "Limited", kind: "set" },
  { term: "LFG", expansion: "Looking for a Game", kind: "term" },
  { term: "Lim", expansion: "Limited", kind: "set" },
  { term: "LoB", expansion: "Land of Bondage", kind: "term" },
  { term: "LoC", expansion: "The Lineage of Christ", kind: "set" },
  { term: "LoR", expansion: "Land of Redemption", kind: "term" },
  { term: "LS", expansion: "Lost Soul", kind: "term" },
  { term: "MI", expansion: "My Initiative", kind: "term" },
  { term: "MT", expansion: "My Turn", kind: "term" },
  { term: "OP", expansion: "Overpowered", kind: "term" },
  { term: "Pi", expansion: "Priests", kind: "set" },
  { term: "PoC", expansion: "Prophecies of Christ", kind: "set" },
  { term: "Pr", expansion: "Prophets", kind: "set" },
  { term: "Pri", expansion: "Priests", kind: "set" },
  { term: "RA", expansion: "Rescue Attempt", kind: "term" },
  { term: "RoA", expansion: "Rock of Ages", kind: "set" },
  { term: "RoJ", expansion: "Revelation of John", kind: "set" },
  { term: "TEC", expansion: "The Early Church", kind: "set" },
  { term: "TeXP", expansion: "Thesarus ex Preteritus", kind: "set" },
  { term: "TPC", expansion: "The Persecuted Church", kind: "set" },
  { term: "UL", expansion: "Unlimited", kind: "set" },
  { term: "Unlim", expansion: "Unlimited", kind: "set" },
  { term: "Wa", expansion: "Warriors", kind: "set" },
  { term: "Wo", expansion: "Women", kind: "set" },
  { term: "YI", expansion: "Your Initiative", kind: "term" },
];

const INDEX = new Map(GLOSSARY_TERMS.map((t) => [cardNameKey(t.term), t]));

/** The glossary entry for a mention, or undefined when it is not shorthand. */
export function findGlossaryTerm(text: string): GlossaryTerm | undefined {
  return text ? INDEX.get(cardNameKey(text)) : undefined;
}

/** Mention key -> entry, for the names a document actually mentions. */
export function resolveGlossaryTerms(names: readonly string[]): Record<string, GlossaryTerm> {
  const out: Record<string, GlossaryTerm> = {};
  for (const name of names) {
    const hit = findGlossaryTerm(name);
    if (hit) out[cardNameKey(name)] = hit;
  }
  return out;
}
