/**
 * Canonical deck/tournament format model. Single source of truth for format
 * ids, rules constants, card pools, ban lists, and display names.
 * Spec: docs/superpowers/specs/2026-07-25-format-restructure-design.md
 */

export type FormatId = 'Limited' | 'Unlimited' | 'Teams' | 'T2' | 'Paragon';
export type PoolId = 'rotation' | 'all' | 'paragon';

export interface BannedCardDef {
  name: string;
  set?: string;       // TSV set code (e.g. "CoW [Ban]"), NOT the full set name
  reference?: string; // scripture reference match (all printings)
  note: string;
}

export interface FormatDef {
  id: FormatId;
  label: string;
  badge: string;
  family: 'T1' | 'T2' | 'Paragon';
  main: { min: number; max: number };
  reserveMax: number;
  pool: PoolId;
  banList: BannedCardDef[];
}

// Baseline exclusion is data-driven: legality !== 'Rotation' fails the
// Limited/T2 pool test; Paragon's excluded sets cover the rest. banList adds
// explicit, print-specific bans on top of that (see BannedCardDef).
//
// Ban lists follow Deck Construction & Format Specific Rules 2.0 (published
// 8/13/2026), which replaced 1.3's single global list with one per category.
// Two things that changed here:
//
//   - Unlimited and T2 are no longer empty. "In Unlimited play, all cards are
//     legal" except Daniel, and T2's list is Limited's plus Harvest Time.
//   - The lists no longer mirror the card data's legality:'Banned' flag.
//     Some banned cards are Rotation-legal printings that only an explicit
//     entry stops (the Imitate Lost Soul, Harvest Time), and some
//     legality:'Banned' rows are no longer banned anywhere — Samuel (RoA)
//     and the Proverbs 22:14 Lost Souls are simply old-format cards outside
//     the Limited/T2 pool, which the pool test already handles.
//
// Entries match on name+set, or on reference to catch every printing. Prefer
// name+set unless the verse belongs to one card only: III John 1:11 is shared
// with Imitating Evil and John 4:35 with the "Harvest" Lost Soul, so those
// list their printings individually.

// Banned in every constructed category.
const DANIEL_COW: BannedCardDef[] = [
  { name: 'Daniel (CoW)', set: 'CoW [Ban]', note: 'Daniel (Cloud of Witnesses)' },
  { name: 'Daniel (CoW AB)', set: 'CoW (AB)', note: 'Daniel (Cloud of Witnesses, AB)' },
];

// Type 1 Limited ban list.
const LIMITED_BAN_LIST: BannedCardDef[] = [
  ...DANIEL_COW,
  { name: 'Endless Treasures (Banned)', set: 'PoC [Ban]', note: 'Endless Treasures with the draw ability (Prophecies of Christ) — the errata printing stays legal' },
  { name: 'Lost Soul "Imitate" [III John 1:11]', set: 'RoJ', note: 'Lost Soul "Imitate" (Revelation of John)' },
  { name: 'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]', set: 'RoJ (AB)', note: 'Lost Soul "Imitate" (Revelation of John, AB)' },
  { name: 'Mourn and Weep', set: 'PoC [Ban]', note: 'Mourn and Weep (Prophecies of Christ)' },
  { name: 'The Foretelling Angel (PC)', set: 'TPC', note: 'The Foretelling Angel (Persecuted Church)' },
];

// Type 2 Limited ban list: Type 1's, plus Harvest Time. The Fundraiser
// printing carries the same name and the same ability text as the Gospel of
// Christ one, so the ban covers both.
const T2_BAN_LIST: BannedCardDef[] = [
  ...LIMITED_BAN_LIST,
  { name: 'Harvest Time (GoC)', set: 'GoC', note: 'Harvest Time (Gospel of Christ)' },
  { name: 'Harvest Time [Fundraiser]', set: 'Fund', note: 'Harvest Time (Gospel of Christ, fundraiser printing)' },
];

// Type 1 Teams Limited ban list: Type 1's, plus Burial and High Places. As
// with Harvest Time, the Fundraiser printing of Burial carries the same name
// and ability text as the Gospel of Christ one, so the ban covers both.
const TEAMS_BAN_LIST: BannedCardDef[] = [
  ...LIMITED_BAN_LIST,
  { name: 'Burial (GoC)', set: 'GoC', note: 'Burial (Gospel of Christ)' },
  { name: 'Burial [Fundraiser]', set: 'Fund', note: 'Burial (Gospel of Christ, fundraiser printing)' },
  { name: 'High Places (LoC)', set: 'LoC', note: 'High Places (Lineage of Christ)' },
];

// Teams is one of the six categories DBR 2.0 recognizes, and decks are built
// to Type 1 Limited rules — same sizes, same pool, same validator (dispatch is
// by `family`) — differing only in the ban list. The Teams-specific rules in
// the guide ("All Lost Souls are considered meek for Teams play", shared Land
// of Redemption, one Dominant per team) govern play, not construction, so
// nothing in the rules engine changes.
export const FORMATS: Record<FormatId, FormatDef> = {
  Limited:   { id: 'Limited',   label: 'Limited',   badge: 'L',  family: 'T1',      main: { min: 50,  max: 70 },  reserveMax: 10, pool: 'rotation', banList: LIMITED_BAN_LIST },
  Unlimited: { id: 'Unlimited', label: 'Unlimited', badge: 'U',  family: 'T1',      main: { min: 50,  max: 70 },  reserveMax: 10, pool: 'all',      banList: DANIEL_COW },
  Teams:     { id: 'Teams',     label: 'Teams',     badge: 'TM', family: 'T1',      main: { min: 50,  max: 70 },  reserveMax: 10, pool: 'rotation', banList: TEAMS_BAN_LIST },
  T2:        { id: 'T2',        label: 'T2',        badge: 'T2', family: 'T2',      main: { min: 100, max: 140 }, reserveMax: 20, pool: 'rotation', banList: T2_BAN_LIST },
  Paragon:   { id: 'Paragon',   label: 'Paragon',   badge: 'P',  family: 'Paragon', main: { min: 40,  max: 40 },  reserveMax: 10, pool: 'paragon',  banList: [] },
};

export const FORMAT_IDS: FormatId[] = ['Limited', 'Unlimited', 'Teams', 'T2', 'Paragon'];

/**
 * Predicate satisfied by both ResolvedCard (deckcheck) and CardData (raw card
 * database) — the 3 fields a ban-list entry can match on.
 */
export type BanMatchable = { name: string; set: string; reference: string };

/**
 * Match a card against a single ban-list entry. Reference entries (covering
 * all printings of a scripture reference) match on card.reference alone;
 * name+set entries match name AND set case-insensitively with EXACT
 * equality — no startsWith/canonicalName fuzzing, since each entry is keyed
 * directly to a real row in the card database (see the regression guard in
 * lib/__tests__/formats.test.ts).
 */
export function matchesBanListEntry(
  card: BanMatchable,
  entry: BannedCardDef
): boolean {
  if (entry.reference !== undefined) {
    return card.reference === entry.reference;
  }
  return (
    card.name.toLowerCase() === entry.name.toLowerCase() &&
    card.set.toLowerCase() === (entry.set ?? '').toLowerCase()
  );
}

/**
 * Is this card banned in the given format? Since DBR 2.0 the answer depends on
 * the format — the Imitate Lost Soul is banned in Limited and T2 but legal in
 * Unlimited, Harvest Time only in T2 — so the card browser has to ask per
 * format rather than reading the card's own legality flag.
 */
export function isBannedInFormat(card: BanMatchable, id: FormatId): boolean {
  return FORMATS[id].banList.some((entry) => matchesBanListEntry(card, entry));
}

/**
 * Map any historical or current format string to a canonical FormatId.
 * Precedence is load-bearing: paragon → teams → type 2 → unlimited/classic →
 * Limited. ('Classic' was the old name for the all-cards pool.) Unlike the
 * matchmaking normalizer in lib/deck-format.ts (untouched), this does NOT treat
 * 'multi' as T2 — no stored value needs it and it would misclassify "Type 1
 * Multiplayer".
 *
 * Teams sits above type 2 and unlimited because the listing strings that carry
 * it read "Type 1 - Teams": matching on 'teams' first keeps the category from
 * falling through to plain Limited.
 */
export function normalizeFormat(s: string | null | undefined): FormatId {
  const fmt = (s ?? '').toLowerCase();
  if (fmt.includes('paragon')) return 'Paragon';
  if (fmt.includes('teams')) return 'Teams';
  if (fmt.includes('type 2') || fmt.includes('type2') || fmt === 't2') return 'T2';
  if (fmt.includes('unlimited') || fmt.includes('classic')) return 'Unlimited';
  return 'Limited';
}

export function getFormatDef(s: string | null | undefined): FormatDef {
  return FORMATS[normalizeFormat(s)];
}

/**
 * Tournament-side normalization. Unlike decks, tournaments may legitimately
 * have no constructed format: null stays null and 'Other'/draft/sealed stay
 * 'Other' — both mean "do not gate deck attachment" (spec §6).
 */
export function normalizeTournamentFormat(
  s: string | null | undefined
): FormatId | 'Other' | null {
  if (s == null || s.trim() === '') return null;
  const fmt = s.toLowerCase();
  if (fmt === 'other' || fmt.includes('draft') || fmt.includes('sealed')) return 'Other';
  return normalizeFormat(s);
}

// Paragon card pool: sets NOT legal in Paragon, matched against
// CardData.officialSet. Moved verbatim from app/decklist/card-search/client.tsx
// (~line 1023); that file and its two duplicates import from here (Task 6).
export const PARAGON_EXCLUDED_SETS: ReadonlySet<string> = new Set([
  '10th Anniversary',
  '1st Edition',
  '1st Edition Unlimited',
  '2nd Edition',
  '2nd Edition Revised',
  '3rd Edition',
  'Angel Wars',
  'Apostles',
  'Cloud of Witnesses',
  'Cloud of Witnesses (Alternate Border)',
  'Disciples',
  'Early Church',
  'Faith of Our Fathers',
  'Fall of Man',
  'Fundraiser',
  'Gospel of Christ',
  'Gospel of Christ Token',
  'Kings',
  'Lineage of Christ',
  'Main',
  'Main Unlimited',
  'Patriarchs',
  'Persecuted Church',
  'Priests',
  'Promo',
  'Promo Token',
  'Prophecies of Christ',
  'Prophecies of Christ Token',
  'Prophets',
  'Revelation of John',
  'Revelation of John (Alternate Border)',
  'Rock of Ages',
  'Thesaurus ex Preteritus',
  'Warriors',
  'Women',
]);
