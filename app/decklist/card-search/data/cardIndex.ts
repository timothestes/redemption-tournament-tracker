/**
 * Module-scope enriched card index for the deck builder.
 *
 * Runs the per-row mapping (testament/gospel derivation, brigade
 * normalization) exactly once per bundle load, against the build-time
 * generated `CARDS` array.
 */

import { CARDS } from "@/lib/cards/lookup";
import { Card, normalizeBrigadeField } from "../utils";
import { NT_BOOKS, OT_BOOKS, GOSPEL_BOOKS } from "../constants";

const gospelBooksLower = GOSPEL_BOOKS.map((b) => b.toLowerCase());
const ntBooksLower = NT_BOOKS.map((b) => b.toLowerCase());
// Data uses singular "Psalm 60:5" while OT_BOOKS lists "psalms" — keep both as valid OT prefixes.
const otBooksLower = [...OT_BOOKS.map((b) => b.toLowerCase()), "psalm"];

function normalizeBookName(ref: string): string {
  return ref.replace(/^(i{1,3}|1|2|3|4|one|two|three|four)\s+/i, "").trim();
}

// Manual Testament overrides for cards with empty reference fields in carddata.txt.
// Keyed by `name|set|imgFile` (matches dataLine).
const TESTAMENT_OVERRIDES: ReadonlyMap<string, "NT" | "OT"> = new Map([
  ["A Child is Born|Pmo-P1|A_Child_is_Born_(Promo)", "NT"],
  ["Caleb (Promo)|Pmo-P1|Caleb_(Promo)", "OT"],
  ["King Solomon (Promo)|Pmo-P1|King_Solomon_(Promo)", "OT"],
  ["Mary's Prophetic Act|Pmo-P1|Mary's_Prophetic_Act_(Promo)", "NT"],
  ["Threatened Lives|AW|Threatened_Lives_(AW)", "OT"],
]);

function startsWithBook(text: string, book: string): boolean {
  if (!text.startsWith(book)) return false;
  const next = text[book.length];
  // Require a word boundary so "psalm" doesn't match "psalms" and "john" doesn't match "johnson".
  return next === undefined || !/[a-z0-9]/i.test(next);
}

function getTestamentForRef(ref: string): "NT" | "OT" | null {
  const lower = ref.toLowerCase().trim();
  if (!lower) return null;

  if (startsWithBook(lower, "old testament")) return "OT";
  if (startsWithBook(lower, "new testament")) return "NT";

  const normalized = normalizeBookName(lower);
  for (const book of ntBooksLower) {
    if (startsWithBook(lower, book) || startsWithBook(normalized, book)) return "NT";
  }
  for (const book of otBooksLower) {
    if (startsWithBook(lower, book) || startsWithBook(normalized, book)) return "OT";
  }
  return null;
}

function deriveTestamentAndGospel(reference: string): { testament: string; isGospel: boolean } {
  const references: string[] = [];
  for (let refGroup of reference.split(";")) {
    refGroup = refGroup.trim();
    if (refGroup.includes("(") && refGroup.includes(")")) {
      const mainRef = refGroup.split("(")[0].trim();
      if (mainRef) references.push(mainRef);
      const parenContent = refGroup.substring(refGroup.indexOf("(") + 1, refGroup.indexOf(")"));
      const parenRefs = parenContent.split(",").map((pr) => pr.trim()).filter(Boolean);
      references.push(...parenRefs);
    } else if (refGroup) {
      references.push(refGroup);
    }
  }

  const foundTestaments = new Set<string>();
  for (const ref of references) {
    const t = getTestamentForRef(ref);
    if (t) foundTestaments.add(t);
  }

  let testament = "";
  if (foundTestaments.size === 1) {
    testament = Array.from(foundTestaments)[0];
  } else if (foundTestaments.size > 1) {
    testament = Array.from(foundTestaments).join("/");
  }

  const referencesLower = references.map((r) => r.toLowerCase());
  const isGospel = referencesLower.some((ref) => gospelBooksLower.some((b) => ref.startsWith(b)));

  return { testament, isGospel };
}

export const ALL_CARDS: Card[] = CARDS.map((c) => {
  const dataLine = `${c.name}|${c.set}|${c.imgFile}`;
  const derived = deriveTestamentAndGospel(c.reference);
  const override = TESTAMENT_OVERRIDES.get(dataLine);
  const testament = override ?? derived.testament;
  const isGospel = derived.isGospel;

  let normalizedBrigades: string[] = [];
  try {
    normalizedBrigades = normalizeBrigadeField(c.brigade, c.alignment, c.name);
  } catch {
    normalizedBrigades = c.brigade ? [c.brigade] : [];
  }

  return {
    dataLine,
    name: c.name,
    set: c.set,
    imgFile: c.imgFile,
    officialSet: c.officialSet,
    type: c.type,
    brigade: normalizedBrigades.join("/"),
    strength: c.strength,
    toughness: c.toughness,
    class: c.class,
    identifier: c.identifier,
    specialAbility: c.specialAbility,
    rarity: c.rarity,
    reference: c.reference,
    alignment: c.alignment,
    legality: c.legality,
    testament,
    isGospel,
  };
});

export const CARD_BY_FULL_KEY: ReadonlyMap<string, Card> = (() => {
  const map = new Map<string, Card>();
  for (const card of ALL_CARDS) {
    map.set(`${card.name}|${card.set}|${card.imgFile}`, card);
  }
  return map;
})();
