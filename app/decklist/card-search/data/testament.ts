// Testament / gospel derivation from a card's scripture `reference`.
//
// Testament is NOT stored in the card data — it is derived at runtime from the
// scripture reference by matching the book name against the NT/OT book lists.
// Shared by the public card index (app/decklist/card-search/data/cardIndex.ts)
// and the Forge adapter (app/forge/lib/deckAdapter.ts) so both paths assign
// testament identically. Pure module (no client/server) — importable anywhere.

import { NT_BOOKS, OT_BOOKS, GOSPEL_BOOKS } from "../constants";

const gospelBooksLower = GOSPEL_BOOKS.map((b) => b.toLowerCase());
const ntBooksLower = NT_BOOKS.map((b) => b.toLowerCase());
// Data uses singular "Psalm 60:5" while OT_BOOKS lists "psalms" — keep both as valid OT prefixes.
const otBooksLower = [...OT_BOOKS.map((b) => b.toLowerCase()), "psalm"];

function normalizeBookName(ref: string): string {
  return ref.replace(/^(i{1,3}|1|2|3|4|one|two|three|four)\s+/i, "").trim();
}

function startsWithBook(text: string, book: string): boolean {
  if (!text.startsWith(book)) return false;
  const next = text[book.length];
  // Require a word boundary so "psalm" doesn't match "psalms" and "john" doesn't match "johnson".
  return next === undefined || !/[a-z0-9]/i.test(next);
}

export function getTestamentForRef(ref: string): "NT" | "OT" | null {
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

// Derived testament code ("NT" | "OT" | "NT/OT") → the game's "N.T." / "O.T."
// display convention. Empty in → empty out.
export function formatTestament(code: string): string {
  return code
    .split("/")
    .filter(Boolean)
    .map((c) => (c === "NT" ? "N.T." : c === "OT" ? "O.T." : c))
    .join(" / ");
}

export function deriveTestamentAndGospel(reference: string): { testament: string; isGospel: boolean } {
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
