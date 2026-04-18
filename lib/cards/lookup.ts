/**
 * Canonical access point for Redemption CCG card data.
 *
 * All callers — server and client — should import from this module.
 * The underlying generated artifact (`./generated/cardData`) is private.
 */

import {
  CARD_BY_KEY,
  CARD_BY_NAME_SET,
  CARD_BY_NAME,
  CARD_BY_NAME_LOWER,
} from './generated/cardData';

export { CARDS, type CardData } from './generated/cardData';

import type { CardData } from './generated/cardData';

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

function classTokens(card: CardData | undefined): string[] {
  if (!card?.class) return [];
  // Class strings use ',', '/', or ' / ' as separators — split on any run of
  // commas, slashes, or whitespace, then lowercase for case-insensitive matching.
  return card.class
    .split(/[,\/\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function isWarrior(card: CardData | undefined): boolean {
  return classTokens(card).includes('warrior');
}

export function isWeapon(card: CardData | undefined): boolean {
  return classTokens(card).includes('weapon');
}

export function isSite(card: CardData | undefined): boolean {
  if (!card?.type) return false;
  const tokens = card.type
    .split(/[,\/\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return tokens.includes('site') || tokens.includes('city');
}
