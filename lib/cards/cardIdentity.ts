/**
 * Collapsing printings down to the card a player actually played.
 *
 * A decklist stores whichever printing the builder clicked, so a field of 62
 * decks spreads one Dominant across eleven rows — "Son of God (J)", "Son of God
 * [Fundraiser]", "Son of God \"Manger\" (Promo)". Frequency analysis needs the
 * card, not the print run.
 *
 * Matching happens in two stages, because no single field survives contact with
 * the data:
 *
 * 1. A **base group** — name stem plus type, brigade, alignment and class.
 *    The stem drops trailing parenthesised/bracketed groups, which is where set
 *    codes, promo years, placements and border variants live. On anything that
 *    is not a Lost Soul it also drops a trailing nickname (the only case in the
 *    index is Son of God "Manger"); on a Lost Soul the quoted nickname IS the
 *    card's identity, so it stays. Brigade does real work here: it is what
 *    separates the three printings of "The Depraved", which are distinct cards
 *    sharing a base name.
 *
 * 2. **Union within that group**, on either an identical ability text or a
 *    shared scripture reference whose abilities are near-identical.
 *
 * Both halves of step 2 are load-bearing, and neither alone is enough:
 *
 *   - Ability alone splits Storehouse, because errata applies to every printing
 *     of a card and the index disagrees with itself across print runs
 *     ("Storehouse [IR]" protects the discard pile; "Storehouse (Promo)"
 *     predates that wording).
 *   - Reference alone splits Son of God, whose printings deliberately carry
 *     different verses, and fuses genuinely different cards that happen to
 *     share one — "Captain of the Host [II]" and "(Roots)" are both Joshua 5:14
 *     with unrelated abilities.
 *
 * `identifier` is excluded on purpose: it drifts across printings of one card
 * ("Son of God [Fundraiser]" gained a "Gospel" tag the others lack).
 *
 * Validated against the hand-built 2026 Nationals merge sheet — 128 multi-
 * printing groups reproduced at 90%, with one over-merge. See
 * `__tests__/cardIdentity.test.ts`.
 */

import { CARDS, findCard, type CardData } from './lookup';

const TRAILING_GROUP = /\s*(\([^()]*\)|\[[^\[\]]*\])\s*$/;
const TRAILING_NICKNAME = /\s*"[^"]*"\s*$/;

/**
 * How alike two ability texts must be before a shared verse is taken as
 * evidence of the same card. Tuned against the merge sheet: at 0.8 the added
 * "discard pile" clause is enough to split Storehouse from itself; below 0.5
 * nothing further merges, but the risk of fusing a redesign grows.
 */
const ERRATA_SIMILARITY = 0.6;

function isLostSoulType(type: string | undefined): boolean {
  return (type ?? '').toLowerCase().includes('lost soul');
}

/**
 * The card's name with printing decoration removed.
 *
 * Exported for display: it is the label a frequency table should show, rather
 * than whichever arbitrary printing happened to sort first.
 */
export function cardNameStem(name: string, type?: string): string {
  let stem = name.trim();

  // Repeat: "Son of God [Tomb] [2022 - Seasonal]" carries two.
  for (;;) {
    const match = TRAILING_GROUP.exec(stem);
    if (!match) break;
    const next = stem.slice(0, match.index).trim();
    // Never strip a name away to nothing — "Lost Soul (John 8:3-4)" would
    // otherwise become the empty string.
    if (!next) break;
    stem = next;
  }

  if (!isLostSoulType(type)) {
    const withoutNickname = stem.replace(TRAILING_NICKNAME, '').trim();
    if (withoutNickname) stem = withoutNickname;
  }

  return stem.replace(/\s+/g, ' ');
}

function normalize(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Lowercase, strip punctuation — absorbs "Rescue"/"rescue" and stray commas. */
function normalizeText(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9 ]/g, '');
}

function baseGroupKey(card: CardData): string {
  return [
    cardNameStem(card.name, card.type).toLowerCase(),
    normalizeText(card.type),
    normalizeText(card.brigade),
    normalizeText(card.alignment),
    normalizeText(card.class),
  ].join('|');
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

interface IdentityIndex {
  /** card name → identity key */
  keyByName: Map<string, string>;
  /** identity key → the printing chosen to represent it */
  representative: Map<string, CardData>;
  /** identity key → every printing name in the group, sorted */
  printings: Map<string, string[]>;
}

let index: IdentityIndex | null = null;

function buildIndex(): IdentityIndex {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) {
      const next = parent.get(root)!;
      parent.set(root, parent.get(next)!);
      root = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const groups = new Map<string, CardData[]>();
  for (const card of CARDS) {
    parent.set(card.name, card.name);
    const key = baseGroupKey(card);
    const bucket = groups.get(key);
    if (bucket) bucket.push(card);
    else groups.set(key, [card]);
  }

  for (const cards of groups.values()) {
    if (cards.length < 2) continue;

    // Identical ability text — the common case, and what holds the Son of God
    // printings together despite their differing verses.
    const byAbility = new Map<string, string[]>();
    for (const card of cards) {
      const ability = normalizeText(card.specialAbility);
      if (!ability) continue;
      const names = byAbility.get(ability);
      if (names) names.push(card.name);
      else byAbility.set(ability, [card.name]);
    }
    for (const names of byAbility.values()) {
      for (let i = 1; i < names.length; i += 1) union(names[0], names[i]);
    }

    // Shared verse — catches errata'd reprints whose text has since diverged.
    // Guarded by ability similarity so a redesign that reuses a verse stays put.
    const byReference = new Map<string, CardData[]>();
    for (const card of cards) {
      const reference = normalizeText(card.reference);
      if (!reference) continue;
      const bucket = byReference.get(reference);
      if (bucket) bucket.push(card);
      else byReference.set(reference, [card]);
    }
    for (const bucket of byReference.values()) {
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          const a = normalizeText(bucket[i].specialAbility);
          const b = normalizeText(bucket[j].specialAbility);
          const bothVanilla = !a && !b;
          if (bothVanilla || tokenOverlap(a, b) >= ERRATA_SIMILARITY) {
            union(bucket[i].name, bucket[j].name);
          }
        }
      }
    }
  }

  const keyByName = new Map<string, string>();
  const printings = new Map<string, string[]>();
  const representative = new Map<string, CardData>();

  for (const card of CARDS) {
    const key = `${baseGroupKey(card)}#${find(card.name)}`;
    keyByName.set(card.name, key);

    const names = printings.get(key);
    if (names) names.push(card.name);
    else printings.set(key, [card.name]);

    // Prefer a currently-legal printing, then the shortest name — which picks
    // the plain print ("Storehouse") over a decorated one ("Storehouse [IR]").
    const held = representative.get(key);
    if (!held) {
      representative.set(key, card);
      continue;
    }
    const heldLegal = held.legality === 'Rotation';
    const cardLegal = card.legality === 'Rotation';
    if (cardLegal !== heldLegal) {
      if (cardLegal) representative.set(key, card);
    } else if (card.name.length < held.name.length) {
      representative.set(key, card);
    }
  }

  for (const names of printings.values()) names.sort();

  return { keyByName, representative, printings };
}

function getIndex(): IdentityIndex {
  if (!index) index = buildIndex();
  return index;
}

/** Stable key identifying the game card behind a specific printing. */
export function cardIdentityKey(card: CardData): string {
  return getIndex().keyByName.get(card.name) ?? `unmatched|${normalize(card.name)}`;
}

/**
 * Identity key for a stored deck row, which holds only a name and set.
 *
 * Cards outside the public index — Forge cards, hand-typed names — get a key
 * derived from the raw name so they still count as themselves instead of all
 * collapsing into a single "unknown" bucket.
 */
export function identityKeyForName(name: string, set?: string, imgFile?: string): string {
  const card = findCard(name, set, imgFile);
  if (card) return cardIdentityKey(card);
  return `unmatched|${normalize(name)}`;
}

/** The printing chosen to stand for a merged group — its art, type, brigade. */
export function representativeCard(key: string): CardData | undefined {
  return getIndex().representative.get(key);
}

/** Every printing name folded into a merged group, sorted. */
export function printingsForKey(key: string): string[] {
  return getIndex().printings.get(key) ?? [];
}

/** The label a merged row should display. */
export function displayNameForKey(key: string, fallback: string): string {
  const card = representativeCard(key);
  return card ? cardNameStem(card.name, card.type) : cardNameStem(fallback);
}
