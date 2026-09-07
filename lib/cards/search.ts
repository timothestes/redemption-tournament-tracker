// Name search for the article card picker. One row per card (not per
// printing): rows are keyed by name stem + type + brigade + alignment, so the
// twenty-odd "Son of God" printings collapse to one row, while "Aaron (Di)"
// and "Aaron (G)" — different cards sharing a stem — stay separate.
// Server-side only in practice: it walks the full generated index.
import { CARDS, type CardData } from "./lookup";
import { cardIdentityKey, cardNameStem, representativeCard } from "./cardIdentity";
import { cardNameKey } from "./nameKey";

export interface CardSearchHit {
  /** What goes inside `[[ ]]`: the stem when it names exactly one card, else the printing name. */
  name: string;
  /** What the picker shows. */
  label: string;
  imgFile: string;
  set: string;
  type: string;
  brigade: string;
}

interface Entry {
  norm: string;
  stem: string;
  card: CardData;
  /** True when no other row shares this stem — `[[stem]]` is unambiguous. */
  uniqueStem: boolean;
}

function preferred(a: CardData, b: CardData): CardData {
  const aLegal = a.legality === "Rotation";
  const bLegal = b.legality === "Rotation";
  if (aLegal !== bLegal) return aLegal ? a : b;
  return b.name.length < a.name.length ? b : a;
}

let index: Entry[] | null = null;

function getIndex(): Entry[] {
  if (index) return index;
  const seenIdentity = new Set<string>();
  const rows = new Map<string, { stem: string; card: CardData }>();
  for (const card of CARDS) {
    const key = cardIdentityKey(card);
    if (seenIdentity.has(key)) continue;
    seenIdentity.add(key);
    const rep = representativeCard(key) ?? card;
    const stem = cardNameStem(rep.name, rep.type);
    const rowKey = [cardNameKey(stem), rep.type, rep.brigade, rep.alignment].map((s) => (s ?? "").toLowerCase()).join("|");
    const held = rows.get(rowKey);
    rows.set(rowKey, { stem, card: held ? preferred(held.card, rep) : rep });
  }
  const perStem = new Map<string, number>();
  for (const r of rows.values()) {
    const k = cardNameKey(r.stem);
    perStem.set(k, (perStem.get(k) ?? 0) + 1);
  }
  index = [...rows.values()]
    .map((r) => ({ norm: cardNameKey(r.stem), stem: r.stem, card: r.card, uniqueStem: perStem.get(cardNameKey(r.stem)) === 1 }))
    .sort((a, b) => a.norm.localeCompare(b.norm) || a.card.name.localeCompare(b.card.name));
  return index;
}

/** Prefix matches first, then word-start matches, then substrings. */
export function searchCardNames(query: string, limit = 12): CardSearchHit[] {
  const q = cardNameKey(query);
  if (!q) return [];
  const prefix: Entry[] = [];
  const word: Entry[] = [];
  const sub: Entry[] = [];
  for (const e of getIndex()) {
    if (e.norm.startsWith(q)) {
      prefix.push(e);
      if (prefix.length === limit) break;
    } else if (e.norm.includes(" " + q)) {
      word.push(e);
    } else if (e.norm.includes(q)) {
      sub.push(e);
    }
  }
  return [...prefix, ...word, ...sub].slice(0, limit).map((e) => ({
    name: e.uniqueStem ? e.stem : e.card.name,
    label: e.stem,
    imgFile: e.card.imgFile,
    set: e.card.set,
    type: e.card.type,
    brigade: e.card.brigade,
  }));
}
