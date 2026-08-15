/**
 * Metagame aggregation for a tournament's published decklists.
 *
 * Pure functions over already-fetched rows — no Supabase, no React — so the
 * numbers can be tested directly.
 *
 * The payload deliberately ships a deck→card incidence list rather than
 * finished percentages. Top-cut representation is the one figure that depends
 * on where the cut is drawn, and that is a control the reader operates; sending
 * the incidence lets the client recompute for any cutoff without a round trip.
 * At tournament scale (62 decks, ~1000 distinct cards) that is a few thousand
 * integers.
 */

import { identityKeyForName, representativeCard, cardNameStem } from '@/lib/cards/cardIdentity';

export type DeckZone = 'main' | 'reserve' | 'maybeboard' | string;

export interface BreakdownCardInput {
  name: string;
  set: string | null;
  imgFile: string | null;
  quantity: number;
  zone: DeckZone;
}

export interface BreakdownDeckInput {
  deckId: string;
  playerName: string | null;
  place: number | null;
  /** Other players linked to this same decklist. Usually empty. */
  alsoPlayedBy?: string[];
  cards: BreakdownCardInput[];
}

export interface BreakdownDeck {
  deckId: string;
  playerName: string | null;
  place: number | null;
  alsoPlayedBy: string[];
  mainSize: number;
  reserveSize: number;
  lostSouls: number;
  distinctCards: number;
  /** Cards in this deck that no other deck in the field played. */
  uniqueCards: number;
  /** Share of the deck's distinct cards that are unique to it, 0–1. */
  spice: number;
  /** Closest decks by Jaccard overlap on distinct cards, nearest first. */
  neighbors: { deckId: string; playerName: string | null; similarity: number }[];
}

export interface BreakdownCard {
  key: string;
  name: string;
  type: string;
  brigade: string;
  alignment: string;
  imgFile: string;
  /** Indexes into `decks` for every deck playing this card. */
  deckIndexes: number[];
  copies: number;
  mainCopies: number;
  reserveCopies: number;
  /** Decks running at least one copy in the reserve. */
  reserveDecks: number;
  /** Distinct printings of this card that were actually played. */
  printings: string[];
}

export interface BreakdownSlice {
  label: string;
  decks: number;
  copies: number;
}

export interface TournamentBreakdown {
  deckCount: number;
  cardCount: number;
  distinctCards: number;
  totalCopies: number;
  medianMainSize: number;
  medianLostSouls: number;
  decks: BreakdownDeck[];
  cards: BreakdownCard[];
  brigades: BreakdownSlice[];
  types: BreakdownSlice[];
  alignments: BreakdownSlice[];
}

const CANONICAL_BRIGADE: Record<string, string> = {
  blue: 'Blue', clay: 'Clay', gold: 'Gold', goodgold: 'Gold', evilgold: 'Gold',
  green: 'Green', multi: 'Multi', purple: 'Purple', red: 'Red', silver: 'Silver',
  teal: 'Teal', white: 'White', black: 'Black', brown: 'Brown', crimson: 'Crimson',
  gray: 'Gray', orange: 'Orange', palegreen: 'Pale Green',
};

/** Brigade names printed as two words, collapsed before tokenising. */
const COMPOUND_BRIGADES: [RegExp, string][] = [
  [/\bpale\s+green\b/gi, 'palegreen'],
  [/\bgood\s+gold\b/gi, 'goodgold'],
  [/\bevil\s+gold\b/gi, 'evilgold'],
];

/**
 * Split a printed brigade string into canonical colours.
 *
 * A multi-brigade card belongs to every colour it names — a Green/Gold hero is
 * played by Green decks and Gold decks alike, so it counts toward both.
 *
 * The printed strings are messier than "Green/Gold" suggests: separators
 * include "/", "+", "and", commas and bare spaces ("Black/Crimson+Gold",
 * "Green/Teal Gold/Pale Green", "Crimson and White/Purple"), and three brigade
 * names are themselves two words. So compounds collapse first, then everything
 * else splits on any separator.
 *
 * Tokens that do not name a brigade are dropped rather than passed through.
 * Without that, alignment words leak in from strings like "Good Gold" and show
 * up as a brigade called "Good". The brigade set is closed and known, so an
 * unrecognised token is data noise, not a brigade this code hasn't heard of.
 */
export function splitBrigades(raw: string | undefined): string[] {
  const value = (raw ?? '').trim();
  if (!value) return [];

  // "(Gold/Red)" alone → use the parenthesised content; otherwise drop it,
  // since it qualifies rather than adds ("Gold (Green)" is a Gold card).
  const paren = /\(([^)]*)\)/.exec(value);
  let stripped = value.replace(/\([^)]*\)/g, '').trim();
  if (!stripped && paren) stripped = paren[1].trim();

  for (const [pattern, replacement] of COMPOUND_BRIGADES) {
    stripped = stripped.replace(pattern, replacement);
  }

  const seen = new Set<string>();
  for (const token of stripped.split(/[\/+,\s]+|\band\b/i)) {
    const normalized = token.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!normalized) continue;
    const canonical = CANONICAL_BRIGADE[normalized];
    if (canonical) seen.add(canonical);
  }
  return [...seen];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isLostSoul(type: string): boolean {
  const lower = type.toLowerCase();
  // "Lost Soul Token" is not a deck card — only the real thing counts.
  return lower === 'lost soul';
}

export function buildBreakdown(input: BreakdownDeckInput[]): TournamentBreakdown {
  // Maybeboard is a scratchpad, never part of a submitted list.
  const decksInput = input.map((deck) => ({
    ...deck,
    cards: deck.cards.filter((c) => c.zone !== 'maybeboard' && c.quantity > 0),
  }));

  interface Accumulator {
    key: string;
    name: string;
    type: string;
    brigade: string;
    alignment: string;
    imgFile: string;
    deckIndexes: number[];
    copies: number;
    mainCopies: number;
    reserveCopies: number;
    reserveDecks: number;
    printings: Set<string>;
  }

  const byKey = new Map<string, Accumulator>();
  const deckCardKeys: Set<string>[] = [];
  const deckStats = decksInput.map(() => ({ mainSize: 0, reserveSize: 0, lostSouls: 0 }));

  decksInput.forEach((deck, deckIndex) => {
    const keysInDeck = new Set<string>();
    const reserveKeysInDeck = new Set<string>();

    for (const row of deck.cards) {
      const key = identityKeyForName(row.name, row.set ?? undefined, row.imgFile ?? undefined);
      const representative = representativeCard(key);
      const type = representative?.type ?? '';

      if (row.zone === 'reserve') {
        deckStats[deckIndex].reserveSize += row.quantity;
        reserveKeysInDeck.add(key);
      } else {
        deckStats[deckIndex].mainSize += row.quantity;
      }
      if (isLostSoul(type)) deckStats[deckIndex].lostSouls += row.quantity;

      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          key,
          name: representative
            ? cardNameStem(representative.name, representative.type)
            : cardNameStem(row.name),
          type,
          brigade: representative?.brigade ?? '',
          alignment: representative?.alignment ?? '',
          imgFile: representative?.imgFile ?? row.imgFile ?? '',
          deckIndexes: [],
          copies: 0,
          mainCopies: 0,
          reserveCopies: 0,
          reserveDecks: 0,
          printings: new Set<string>(),
        };
        byKey.set(key, entry);
      }

      entry.copies += row.quantity;
      if (row.zone === 'reserve') entry.reserveCopies += row.quantity;
      else entry.mainCopies += row.quantity;
      entry.printings.add(row.name);

      // A deck counts once toward a card no matter how many copies or zones it
      // spreads them across.
      if (!keysInDeck.has(key)) {
        keysInDeck.add(key);
        entry.deckIndexes.push(deckIndex);
      }
    }

    for (const key of reserveKeysInDeck) {
      const entry = byKey.get(key);
      if (entry) entry.reserveDecks += 1;
    }

    deckCardKeys.push(keysInDeck);
  });

  const cards: BreakdownCard[] = [...byKey.values()]
    .map((entry) => ({
      key: entry.key,
      name: entry.name,
      type: entry.type,
      brigade: entry.brigade,
      alignment: entry.alignment,
      imgFile: entry.imgFile,
      deckIndexes: entry.deckIndexes,
      copies: entry.copies,
      mainCopies: entry.mainCopies,
      reserveCopies: entry.reserveCopies,
      reserveDecks: entry.reserveDecks,
      printings: [...entry.printings].sort(),
    }))
    .sort((a, b) => b.deckIndexes.length - a.deckIndexes.length || a.name.localeCompare(b.name));

  // Cards played by exactly one deck — the raw material for a spice score.
  const singletonKeys = new Set(
    cards.filter((c) => c.deckIndexes.length === 1).map((c) => c.key),
  );

  const decks: BreakdownDeck[] = decksInput.map((deck, index) => {
    const keys = deckCardKeys[index];
    let uniqueCards = 0;
    for (const key of keys) if (singletonKeys.has(key)) uniqueCards += 1;

    const neighbors = decksInput
      .map((other, otherIndex) => {
        if (otherIndex === index) return null;
        const otherKeys = deckCardKeys[otherIndex];
        let shared = 0;
        for (const key of keys) if (otherKeys.has(key)) shared += 1;
        const union = keys.size + otherKeys.size - shared;
        return {
          deckId: other.deckId,
          playerName: other.playerName,
          similarity: union === 0 ? 0 : shared / union,
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    return {
      deckId: deck.deckId,
      playerName: deck.playerName,
      place: deck.place,
      alsoPlayedBy: deck.alsoPlayedBy ?? [],
      mainSize: deckStats[index].mainSize,
      reserveSize: deckStats[index].reserveSize,
      lostSouls: deckStats[index].lostSouls,
      distinctCards: keys.size,
      uniqueCards,
      spice: keys.size === 0 ? 0 : uniqueCards / keys.size,
      neighbors,
    };
  });

  const brigadeTally = new Map<string, { decks: Set<number>; copies: number }>();
  const typeTally = new Map<string, { decks: Set<number>; copies: number }>();
  const alignmentTally = new Map<string, { decks: Set<number>; copies: number }>();

  const tally = (
    target: Map<string, { decks: Set<number>; copies: number }>,
    label: string,
    card: BreakdownCard,
  ) => {
    let entry = target.get(label);
    if (!entry) {
      entry = { decks: new Set<number>(), copies: 0 };
      target.set(label, entry);
    }
    entry.copies += card.copies;
    for (const deckIndex of card.deckIndexes) entry.decks.add(deckIndex);
  };

  for (const card of cards) {
    for (const brigade of splitBrigades(card.brigade)) tally(brigadeTally, brigade, card);
    if (card.type) tally(typeTally, card.type, card);
    const alignment = card.alignment.trim();
    if (alignment) tally(alignmentTally, alignment, card);
  }

  const toSlices = (source: Map<string, { decks: Set<number>; copies: number }>): BreakdownSlice[] =>
    [...source.entries()]
      .map(([label, value]) => ({ label, decks: value.decks.size, copies: value.copies }))
      .sort((a, b) => b.copies - a.copies || a.label.localeCompare(b.label));

  return {
    deckCount: decksInput.length,
    cardCount: cards.length,
    distinctCards: cards.length,
    totalCopies: cards.reduce((sum, c) => sum + c.copies, 0),
    medianMainSize: median(deckStats.map((d) => d.mainSize)),
    medianLostSouls: median(deckStats.map((d) => d.lostSouls)),
    decks,
    cards,
    brigades: toSlices(brigadeTally),
    types: toSlices(typeTally),
    alignments: toSlices(alignmentTally),
  };
}
