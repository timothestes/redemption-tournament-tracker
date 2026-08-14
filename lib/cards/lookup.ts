/**
 * Canonical access point for Redemption CCG card data.
 *
 * All callers — server and client — should import from this module.
 * The underlying generated artifact (`./generated/cardData`) is private.
 */

import { CARDS } from './generated/cardData';
import abMap from './generated/abMap.json';

export { CARDS, type CardData } from './generated/cardData';

import type { CardData } from './generated/cardData';

// `name|set` keys of the standard prints that have an AB (alternate-art booster)
// reprint. Derived from the generated AB→original map (abMap.json), which pairs
// each AB card to its original print. Used by the deckbuilder's "Prefer AB"
// filter to hide an original when its AB version is available.
const ORIGINAL_KEYS_WITH_AB: ReadonlySet<string> = new Set(
  Object.values(abMap as Record<string, string>),
);

/** Does this exact print (by name + set) have an AB reprint of the same card? */
export function hasAbReprint(name: string, set: string): boolean {
  return ORIGINAL_KEYS_WITH_AB.has(`${name}|${set}`);
}

// Lookup maps are built once at module load from CARDS rather than serialized
// into the generated artifact — keeping the giant card literal out of the .ts
// source (it lives in cardData.json) so the build never type-checks it.
// Last-wins on collision, matching the legacy deckcheck behavior.
const CARD_BY_KEY = new Map<string, CardData>();
const CARD_BY_NAME_SET = new Map<string, CardData>();
const CARD_BY_NAME = new Map<string, CardData>();
const CARD_BY_NAME_LOWER = new Map<string, CardData>();

// Card-data errata, keyed `name|set`. Deck Construction & Format Specific
// Rules 2.0 (8/13/2026) unbanned Ephesian Widow, but the generated data still
// carries the pre-2.0 flag from upstream (set "TPC [Ban]", legality "Banned"),
// and legality !== 'Rotation' is exactly what keeps a card out of the Limited
// and T2 pools — so without this the card stays unplayable no matter what the
// ban lists say. It lives here rather than in the generated artifact so it
// survives `make update-cards`; delete the entry once upstream re-flags it.
//
// Only cards whose pool membership actually changed belong here. Samuel (RoA)
// and the Proverbs 22:14 Lost Souls were unbanned too, but they are
// old-format printings that were never in the Limited/T2 pool to begin with,
// so their legality flag is not what excludes them.
const LEGALITY_OVERRIDES: Readonly<Record<string, string>> = {
  'Ephesian Widow|TPC [Ban]': 'Rotation',
};

for (const card of CARDS) {
  const override = LEGALITY_OVERRIDES[`${card.name}|${card.set}`];
  if (override !== undefined) card.legality = override;
  CARD_BY_KEY.set(`${card.name}|${card.set}|${card.imgFile}`, card);
  CARD_BY_NAME_SET.set(`${card.name}|${card.set}`, card);
  CARD_BY_NAME.set(card.name, card);
  CARD_BY_NAME_LOWER.set(card.name.toLowerCase(), card);
}

export function findCard(
  name: string,
  set?: string,
  imgFile?: string,
): CardData | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();

  if (set && imgFile) {
    return (
      CARD_BY_KEY.get(`${name}|${set}|${imgFile}`)
      ?? CARD_BY_NAME_SET.get(`${name}|${set}`)
      ?? CARD_BY_NAME.get(name)
      ?? CARD_BY_NAME_LOWER.get(lower)
    );
  }

  if (set) {
    return (
      CARD_BY_NAME_SET.get(`${name}|${set}`)
      ?? CARD_BY_NAME.get(name)
      ?? CARD_BY_NAME_LOWER.get(lower)
    );
  }

  return CARD_BY_NAME.get(name) ?? CARD_BY_NAME_LOWER.get(lower);
}

function classTokens(cls: string | undefined): string[] {
  if (!cls) return [];
  // Class strings use ',', '/', or ' / ' as separators — split on any run of
  // commas, slashes, or whitespace, then lowercase for case-insensitive matching.
  return cls
    .split(/[,\/\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Warrior/Weapon tests against a raw class string. Forge cards carry their
 *  class this way (they're not in the public index), so callers holding a
 *  class string — rather than a CardData — use these directly. */
export function classIsWarrior(cls: string | undefined): boolean {
  return classTokens(cls).includes('warrior');
}

export function classIsWeapon(cls: string | undefined): boolean {
  return classTokens(cls).includes('weapon');
}

export function isWarrior(card: CardData | undefined): boolean {
  return classIsWarrior(card?.class);
}

export function isWeapon(card: CardData | undefined): boolean {
  return classIsWeapon(card?.class);
}

export function isSite(card: CardData | undefined): boolean {
  if (!card?.type) return false;
  const tokens = card.type
    .split(/[,\/\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return tokens.includes('site') || tokens.includes('city');
}
