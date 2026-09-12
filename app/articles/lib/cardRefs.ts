// Resolves `[[mention]]` names against the card index. Server-side only: it
// pulls in the full generated card data. Pure otherwise, so it is unit-tested
// against the real index.
import { CARDS, findCard, type CardData } from "@/lib/cards/lookup";
import { cardIdentityKey, cardNameStem, representativeCard } from "@/lib/cards/cardIdentity";
import { cardNameKey } from "@/lib/cards/nameKey";
import { aliasTarget } from "@/lib/cards/aliases";
import type { CardRef } from "./refTypes";

// A mention resolves in three passes — exact printing, name stem, then a
// curated alias ("LAFS") — each a strictly later fallback than the last.
//
// Most cards have no undecorated printing — "Son of God" exists only as
// "Son of God (J)", "[K]", "(2019) (Promo)"… — so a plain typed name has to
// match on the stem. Prefer a currently-legal printing, then the shortest name,
// the same rule cardIdentity uses to pick a representative.
let stemIndex: Map<string, CardData> | null = null;

function getStemIndex(): Map<string, CardData> {
  if (stemIndex) return stemIndex;
  const map = new Map<string, CardData>();
  for (const card of CARDS) {
    const key = cardNameKey(cardNameStem(card.name, card.type));
    const held = map.get(key);
    if (!held) {
      map.set(key, card);
      continue;
    }
    const heldLegal = held.legality === "Rotation";
    const cardLegal = card.legality === "Rotation";
    if (cardLegal !== heldLegal ? cardLegal : card.name.length < held.name.length) map.set(key, card);
  }
  stemIndex = map;
  return map;
}

function variants(name: string): string[] {
  const trimmed = name.replace(/\s+/g, " ").trim();
  const straight = trimmed.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const curly = trimmed.replace(/'/g, "’");
  return [...new Set([trimmed, straight, curly])];
}

/** The card a mention points at, or undefined when nothing in the index matches. */
export function resolveCardRef(name: string): CardRef | undefined {
  // An exact printing name is a deliberate choice: keep that art.
  for (const v of variants(name)) {
    const card = findCard(v);
    if (card) return { name: card.name, imgFile: card.imgFile };
  }
  const byStem = getStemIndex().get(cardNameKey(name));
  if (byStem) {
    const rep = representativeCard(cardIdentityKey(byStem)) ?? byStem;
    return { name: rep.name, imgFile: rep.imgFile };
  }
  // Curated aliases go last, so a real card always wins and an alias can never
  // shadow the catalog. The editor and the codegen both refuse one that would.
  const aliased = aliasTarget(name);
  return aliased ? { name: aliased.name, imgFile: aliased.imgFile } : undefined;
}

export function resolveCardRefs(names: string[]): Record<string, CardRef> {
  const out: Record<string, CardRef> = {};
  for (const name of names) {
    const ref = resolveCardRef(name);
    if (ref) out[cardNameKey(name)] = ref;
  }
  return out;
}
