import { describe, it, expect } from "vitest";
import { GLOSSARY_TERMS, findGlossaryTerm, resolveGlossaryTerms } from "../terms";
import { CARDS } from "@/lib/cards/lookup";
import { CARD_ALIASES } from "@/lib/cards/aliases";
import { cardNameStem } from "@/lib/cards/cardIdentity";
import { cardNameKey } from "@/lib/cards/nameKey";
import { resolveCardRef, resolveCardRefs } from "@/app/articles/lib/cardRefs";
import { extractCardMentions } from "@/app/articles/lib/markdown";

describe("findGlossaryTerm", () => {
  it("finds a term the loose way a person types it", () => {
    expect(findGlossaryTerm("  ec ")?.expansion).toBe("Evil Character");
  });

  it("returns undefined for anything not on the list", () => {
    expect(findGlossaryTerm("Son of God")).toBeUndefined();
    expect(findGlossaryTerm("")).toBeUndefined();
  });

  it("carries the set codes as well as the game terms", () => {
    expect(findGlossaryTerm("LoC")).toEqual({ term: "LoC", expansion: "The Lineage of Christ", kind: "set" });
    expect(findGlossaryTerm("CBI")?.kind).toBe("term");
  });
});

describe("the glossary list", () => {
  it("gives every term a non-empty expansion that is not just the term again", () => {
    for (const t of GLOSSARY_TERMS) {
      expect(t.expansion.trim(), t.term).toBeTruthy();
      expect(cardNameKey(t.expansion)).not.toBe(cardNameKey(t.term));
    }
  });

  it("has no duplicate terms", () => {
    const keys = GLOSSARY_TERMS.map((t) => cardNameKey(t.term));
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("never collides with a card name or name stem", () => {
    // A card always wins resolution, so a colliding term could never render.
    const taken = new Set<string>();
    for (const card of CARDS) {
      taken.add(cardNameKey(card.name));
      taken.add(cardNameKey(cardNameStem(card.name, card.type)));
    }
    expect(GLOSSARY_TERMS.filter((t) => taken.has(cardNameKey(t.term))).map((t) => t.term)).toEqual([]);
  });

  it("never collides with a curated card alias", () => {
    const aliases = new Set(CARD_ALIASES.map((a) => cardNameKey(a.alias)));
    expect(GLOSSARY_TERMS.filter((t) => aliases.has(cardNameKey(t.term))).map((t) => t.term)).toEqual([]);
  });

  it("is invisible to the card resolver, so a card can never lose to a term", () => {
    for (const t of GLOSSARY_TERMS) {
      expect(resolveCardRef(t.term), `"${t.term}" resolved as a card`).toBeUndefined();
    }
  });
});

describe("resolveGlossaryTerms", () => {
  it("keys hits the way the renderer looks them up, and omits misses", () => {
    const mentions = extractCardMentions("Band to an [[EC]] with [[CBI]], then [[Son of God]].");
    expect(mentions).toEqual(["EC", "CBI", "Son of God"]);
    const terms = resolveGlossaryTerms(mentions);
    expect(Object.keys(terms).sort()).toEqual(["cbi", "ec"]);
    expect(terms[cardNameKey("EC")].expansion).toBe("Evil Character");
  });

  it("is empty when nothing matches", () => {
    expect(resolveGlossaryTerms(["Son of God"])).toEqual({});
  });
});

describe("a document mixing all four kinds of mention", () => {
  const md = "Play [[LAFS]] turn 1, band to an [[EC]] with [[CBI]], per [[Son of God]] and [[Nnope]].";

  it("sorts each mention into cards or terms, and leaves the rest unresolved", () => {
    const mentions = extractCardMentions(md);
    const cards = resolveCardRefs(mentions);
    const terms = resolveGlossaryTerms(mentions);

    // A curated alias and a real card both resolve as cards.
    expect(Object.keys(cards).sort()).toEqual(["lafs", "son of god"]);
    // Shorthand resolves as terms.
    expect(Object.keys(terms).sort()).toEqual(["cbi", "ec"]);
    // Nothing claims both, and the typo claims neither.
    for (const key of Object.keys(cards)) expect(terms[key]).toBeUndefined();
    expect(cards["nnope"]).toBeUndefined();
    expect(terms["nnope"]).toBeUndefined();
  });
});
