// Name search for the article card picker. One row per card (not per
// printing): rows are keyed by name stem + type + brigade + alignment, so the
// twenty-odd "Son of God" printings collapse to one row, while "Aaron (Di)"
// and "Aaron (G)" — different cards sharing a stem — stay separate.
// Server-side only in practice: it walks the full generated index.
import { CARDS, findCard, type CardData } from "./lookup";
import { cardIdentityKey, cardNameStem, representativeCard } from "./cardIdentity";
import { cardNameKey } from "./nameKey";
import { CARD_ALIASES, aliasTarget } from "./aliases";

export interface CardSearchHit {
  /** What goes inside `[[ ]]`: the stem when it names exactly one card, else the printing name. */
  name: string;
  /** What the picker shows. */
  label: string;
  /** Set when the query matched a curated alias rather than the name. */
  alias?: string;
  imgFile: string;
  set: string;
  type: string;
  brigade: string;
}

interface Entry {
  norm: string;
  stem: string;
  card: CardData;
  /** Which identity this row stands for, so an alias row can replace it. */
  identity: string;
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
    .map((r) => ({
      norm: cardNameKey(r.stem),
      stem: r.stem,
      card: r.card,
      identity: cardIdentityKey(r.card),
      uniqueStem: perStem.get(cardNameKey(r.stem)) === 1,
    }))
    .sort((a, b) => a.norm.localeCompare(b.norm) || a.card.name.localeCompare(b.card.name));
  return index;
}

/**
 * What the picker should write into `[[ ]]` for an alias row.
 *
 * The printing's own name when that name lands back on this very printing —
 * that is the plainest thing to read in the prose. It often does not: a name
 * shared by several printings resolves last-wins, and a bracketed reprint
 * ("A New Beginning [RR2]") cannot appear inside a mention at all. The alias
 * itself is the fallback, and it always resolves here by construction.
 */
function mentionTextFor(alias: string, card: CardData): string {
  if (/[[\]|\n]/.test(card.name)) return alias;
  const landsOn = findCard(card.name);
  return landsOn && landsOn.name === card.name && landsOn.set === card.set ? card.name : alias;
}

/**
 * Alias key → the printing it names. Built from the alias's own target rather
 * than from the merged picker row it falls in: rows collapse every printing
 * that shares a stem, type, brigade and alignment behind one representative, so
 * reading the row would report a printing the curator did not choose.
 *
 * First-wins on a duplicate key, matching buildAliasIndex — the codegen rejects
 * duplicates, so the two only ever disagree on a hand-edited overlay.
 */
function getAliasIndex(): Map<string, { alias: string; card: CardData }> {
  const map = new Map<string, { alias: string; card: CardData }>();
  for (const { alias } of CARD_ALIASES) {
    const card = aliasTarget(alias);
    if (!card) continue; // orphan: the codegen already refused to ship it
    const key = cardNameKey(alias);
    if (!map.has(key)) map.set(key, { alias, card });
  }
  return map;
}

let aliasIndex: Map<string, { alias: string; card: CardData }> | null = null;

/** Prefix matches first, then word-start matches, then substrings. */
export function searchCardNames(query: string, limit = 12): CardSearchHit[] {
  const q = cardNameKey(query);
  if (!q) return [];
  // An alias is the most deliberate match there is — someone curated it for
  // exactly this query — so it leads, and its row is dropped from the name
  // passes below so the card is never listed twice.
  if (!aliasIndex) aliasIndex = getAliasIndex();
  const aliased = aliasIndex.get(q);
  const aliasedIdentity = aliased ? cardIdentityKey(aliased.card) : null;
  const prefix: Entry[] = [];
  const word: Entry[] = [];
  const sub: Entry[] = [];
  for (const e of getIndex()) {
    if (e.identity === aliasedIdentity) continue;
    if (e.norm.startsWith(q)) {
      prefix.push(e);
      if (prefix.length === limit) break;
    } else if (e.norm.includes(" " + q)) {
      word.push(e);
    } else if (e.norm.includes(q)) {
      sub.push(e);
    }
  }
  const toHit = (e: Entry): CardSearchHit => ({
    name: e.uniqueStem ? e.stem : e.card.name,
    label: e.stem,
    imgFile: e.card.imgFile,
    set: e.card.set,
    type: e.card.type,
    brigade: e.card.brigade,
  });
  const hits = [...prefix, ...word, ...sub].slice(0, aliased ? limit - 1 : limit).map(toHit);
  if (!aliased) return hits;
  const { alias, card } = aliased;
  return [
    {
      name: mentionTextFor(alias, card),
      label: cardNameStem(card.name, card.type),
      alias,
      imgFile: card.imgFile,
      set: card.set,
      type: card.type,
      brigade: card.brigade,
    },
    ...hits,
  ];
}
