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
const otBooksLower = OT_BOOKS.map((b) => b.toLowerCase());

function normalizeBookName(ref: string): string {
  return ref.replace(/^(i{1,3}|1|2|3|4|one|two|three|four)\s+/i, "").trim();
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

  const referencesLower = references.map((r) => r.toLowerCase());

  const foundTestaments = new Set<string>();
  for (const ref of referencesLower) {
    const book = ref.split(" ")[0];
    const normalizedBook = normalizeBookName(ref).split(" ")[0];
    if (ntBooksLower.some((b) => book === b || normalizedBook === b)) foundTestaments.add("NT");
    if (otBooksLower.some((b) => book === b || normalizedBook === b)) foundTestaments.add("OT");
  }

  let testament = "";
  if (foundTestaments.size === 1) {
    testament = Array.from(foundTestaments)[0];
  } else if (foundTestaments.size > 1) {
    testament = Array.from(foundTestaments).join("/");
  }

  const isGospel = referencesLower.some((ref) => gospelBooksLower.some((b) => ref.startsWith(b)));

  return { testament, isGospel };
}

export const ALL_CARDS: Card[] = CARDS.map((c) => {
  const { testament, isGospel } = deriveTestamentAndGospel(c.reference);

  let normalizedBrigades: string[] = [];
  try {
    normalizedBrigades = normalizeBrigadeField(c.brigade, c.alignment, c.name);
  } catch {
    normalizedBrigades = c.brigade ? [c.brigade] : [];
  }

  return {
    dataLine: `${c.name}|${c.set}|${c.imgFile}`,
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
