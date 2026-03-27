/**
 * Budget pricing utilities for finding the cheapest equivalent printing
 * of a card by looking across duplicate groups (same canonical card, same ability).
 */

import {
  findGroup,
  normalize,
  stripSetSuffix,
} from '../duplicateCards';
import type { DuplicateGroupIndex } from '../duplicateCards';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetCard {
  name: string;
  set: string;
  imgFile: string;
  specialAbility: string;
}

export interface CheapestResult {
  cheapestPrice: number | null;
  cheapestCardKey: string | null;
  ownPrice: number | null;
}

/** Map from normalized base name → all printings with that base name */
export type CardNameIndex = Map<string, BudgetCard[]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a card's lookup key */
function toKey(card: BudgetCard): string {
  return `${card.name}|${card.set}|${card.imgFile}`;
}

/**
 * Hardcoded ability overrides for cards with equivalent effects but different wording.
 * Key: normalized ability text → canonical form.
 */
const ABILITY_OVERRIDES: Record<string, string> = {
  // Lost Soul "Humble" — three printings with same effect, different wording
  "during battle, while opponent has hand advantage, your cards cannot be prevented by opponents' cards.":
    "during battle, while opponent has more cards in hand than you, your cards cannot be prevented by opponents' cards.",
  "during battle, if opponent has more cards in hand than you, your cards cannot be prevented by opponents' cards.":
    "during battle, while opponent has more cards in hand than you, your cards cannot be prevented by opponents' cards.",
  // Lost Soul "Darkness" — 2019 promo reworded "search...for...and put it in hand or play" → "take or play...from"
  "if put in play by an opponent's special ability (or if you have no evil characters in territory when drawn), you may take or play an evil character from deck or reserve.":
    "if put in play by an opponent's special ability (or if you have no evil characters in territory when drawn), you may search deck or reserve for an evil character and put it in hand or play.",
  // Foreign Wives — 2022 Side Event promo reworded ability
  "take household idols from discard pile. if opponent has drawn 5 or more cards this turn, protect this card from cards used by opponent. cannot be negated.":
    "search discard pile for household idols. if opponent has draw 5 or more cards this turn, protect foreign wives from cards used by opponent. cannot be negated.",
  // Lost Soul "Hopper" — RR/Matthew 18:12 say "this card", LR/Fundraiser say "this Lost Soul"
  "if drawn, give this lost soul to an opponent's territory.":
    "if drawn, give this card to an opponent's territory.",
};

/**
 * Normalize special ability text for comparison.
 * Lowercase, normalize smart quotes (single → ', double → "),
 * em/en dashes → -, collapse whitespace, trim.
 */
export function normalizeAbility(ability: string): string {
  const text = ability
    .replace(/[\u2018\u2019]/g, "'")   // smart single quotes → '
    .replace(/[\u201c\u201d]/g, '"')   // smart double quotes → "
    .replace(/[\u2013\u2014]/g, '-')   // en dash / em dash → -
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return ABILITY_OVERRIDES[text] ?? text;
}

// ---------------------------------------------------------------------------
// CardNameIndex
// ---------------------------------------------------------------------------

/**
 * Build an index from normalized base card name → list of BudgetCards.
 * Uses normalize() + stripSetSuffix() from duplicateCards.ts for consistent keys.
 * Build once per session for O(1) lookups instead of O(n) scans.
 */
export function buildCardNameIndex(allCards: BudgetCard[]): CardNameIndex {
  const index: CardNameIndex = new Map();

  for (const card of allCards) {
    // Index by the stripped, normalized name (e.g., "angel (pr)" → "angel")
    const baseKey = normalize(stripSetSuffix(card.name));

    const existing = index.get(baseKey);
    if (existing) {
      existing.push(card);
    } else {
      index.set(baseKey, [card]);
    }

    // Also index by the full normalized name (in case stripSetSuffix doesn't strip)
    const fullKey = normalize(card.name);
    if (fullKey !== baseKey) {
      const existingFull = index.get(fullKey);
      if (existingFull) {
        existingFull.push(card);
      } else {
        index.set(fullKey, [card]);
      }
    }
  }

  return index;
}

// ---------------------------------------------------------------------------
// findCheapestEquivalent
// ---------------------------------------------------------------------------

/**
 * Find the cheapest pricing for a card, considering equivalent printings
 * in the same duplicate group that share the same special ability text.
 *
 * @param card - The card being priced
 * @param allCards - All cards (used if cardNameIndex is not provided)
 * @param dupIndex - Duplicate group lookup index
 * @param getPrice - Function returning price (or null) for a card key "name|set|imgFile"
 * @param cardNameIndex - Optional pre-built index for O(1) candidate lookup
 */
export function findCheapestEquivalent(
  card: BudgetCard,
  allCards: BudgetCard[],
  dupIndex: DuplicateGroupIndex,
  getPrice: (cardKey: string) => number | null,
  cardNameIndex?: CardNameIndex,
): CheapestResult {
  const ownKey = toKey(card);
  const ownPrice = getPrice(ownKey);

  // Step 1: Look up the duplicate group for this card
  const group = findGroup(card.name, dupIndex);

  if (!group) {
    // No group → only candidate is the card itself
    return {
      ownPrice,
      cheapestPrice: ownPrice,
      cheapestCardKey: ownPrice !== null ? ownKey : null,
    };
  }

  // Step 2: Build a set of normalized names for all group members
  const memberNormalized = new Set<string>();
  for (const member of group.members) {
    memberNormalized.add(normalize(member.cardName));
    memberNormalized.add(normalize(stripSetSuffix(member.cardName)));
  }

  // Step 3: Gather candidate cards from the index or allCards
  let candidates: BudgetCard[];

  if (cardNameIndex) {
    // O(1) lookups via index
    const seen = new Set<string>();
    candidates = [];
    for (const normName of memberNormalized) {
      const bucket = cardNameIndex.get(normName);
      if (bucket) {
        for (const c of bucket) {
          const key = toKey(c);
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push(c);
          }
        }
      }
    }
  } else {
    // O(n) fallback: scan allCards
    candidates = allCards.filter((c) => {
      const normName = normalize(c.name);
      const normBase = normalize(stripSetSuffix(c.name));
      return memberNormalized.has(normName) || memberNormalized.has(normBase);
    });
  }

  // Step 4: Filter candidates to those with matching ability text
  const targetAbility = normalizeAbility(card.specialAbility);
  const equivalents = candidates.filter(
    (c) => normalizeAbility(c.specialAbility) === targetAbility
  );

  // Step 5: Find cheapest among equivalents
  let cheapestPrice: number | null = null;
  let cheapestCardKey: string | null = null;

  for (const equiv of equivalents) {
    const key = toKey(equiv);
    const price = getPrice(key);
    if (price !== null && (cheapestPrice === null || price < cheapestPrice)) {
      cheapestPrice = price;
      cheapestCardKey = key;
    }
  }

  return { ownPrice, cheapestPrice, cheapestCardKey };
}
