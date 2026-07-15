/**
 * Canonical "default" card sort order, shared by every surface that lists
 * cards (deckbuilder, public deck view, exports, Forge, play-area reserve
 * browsing, collection). Pure and dependency-free — no card data imports —
 * so it can be bundled anywhere and mirrored 1:1 in the sister Python API.
 *
 * Order: Dominants, Artifacts, Covenants, Curses, Fortresses (+Cities),
 * Sites, Lost Souls (biblical reference order), dual-alignment
 * characters/enhancements, Good brigades (characters then enhancements,
 * strength descending), Evil brigades (same), then everything else.
 *
 * The comparator degrades gracefully: given only `name` + `type` it still
 * yields section order then alphabetical.
 */

export interface SortableCard {
  name: string;
  type: string;
  brigade?: string;
  alignment?: string;
  strength?: string;
  reference?: string;
}

// Alphabetical-by-color brigade orders. "Gold" covers Good Gold / Evil Gold
// per the list it appears in; "Multi" sorts alphabetically within each list.
export const GOOD_BRIGADE_ORDER = [
  "Blue", "Clay", "Gold", "Green", "Multi", "Purple", "Red", "Silver", "Teal", "White",
] as const;

export const EVIL_BRIGADE_ORDER = [
  "Black", "Brown", "Crimson", "Gold", "Gray", "Multi", "Orange", "Pale Green",
] as const;

// Books as they appear in card data (Roman numerals, "Psalms").
export const BIBLE_BOOK_ORDER = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
  "Judges", "Ruth", "I Samuel", "II Samuel", "I Kings", "II Kings",
  "I Chronicles", "II Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
  "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
  "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
  "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "I Corinthians", "II Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "I Thessalonians", "II Thessalonians",
  "I Timothy", "II Timothy", "Titus", "Philemon", "Hebrews", "James",
  "I Peter", "II Peter", "I John", "II John", "III John", "Jude",
  "Revelation",
] as const;

// ---------------------------------------------------------------------------
// Section ranks
// ---------------------------------------------------------------------------

const SECTION_DOMINANT = 0;
const SECTION_ARTIFACT = 1;
const SECTION_COVENANT = 2;
const SECTION_CURSE = 3;
const SECTION_FORTRESS = 4; // Fortresses and Cities interleave alphabetically
const SECTION_SITE = 5;
const SECTION_LOST_SOUL = 6;
const SECTION_DUAL = 7;
const SECTION_GOOD = 8;
const SECTION_EVIL = 9;
const SECTION_MISC = 10;

// Normalize a type/brigade token for matching: lowercase, drop spaces/hyphens.
// Handles both raw carddata forms ("Evil Character", "Lost Soul", "Pale Green")
// and Forge forms ("EvilCharacter", "LostSoul", "PaleGreen").
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, "");
}

const GOOD_CHAR_TYPES = new Set(["hero", "heroes", "herocharacter", "hc", "goodcharacter", "gc"]);
const GOOD_ENH_TYPES = new Set(["ge", "goodenhancement", "goodenhancements"]);
const EVIL_CHAR_TYPES = new Set(["evilcharacter", "evilcharacters", "ec"]);
const EVIL_ENH_TYPES = new Set(["ee", "evilenhancement", "evilenhancements"]);

function isGoodSideType(part: string): boolean {
  const n = norm(part);
  if (GOOD_CHAR_TYPES.has(n) === true) return true;
  return GOOD_ENH_TYPES.has(n);
}

function isEvilSideType(part: string): boolean {
  const n = norm(part);
  if (EVIL_CHAR_TYPES.has(n) === true) return true;
  return EVIL_ENH_TYPES.has(n);
}

function typeParts(type: string): string[] {
  // Split on "/" and trim — handles "Fortress / Evil Character".
  return type.split("/").map((p) => p.trim()).filter((p) => p !== "");
}

// ---------------------------------------------------------------------------
// Brigade parsing
// ---------------------------------------------------------------------------

// Unambiguously good/evil brigade tokens (normalized). "gold" and "multi"
// appear in both alignments so they can't prove dual-ness on their own.
const GOOD_ONLY_TOKENS = new Set(["blue", "clay", "goodgold", "green", "purple", "red", "silver", "teal", "white"]);
const EVIL_ONLY_TOKENS = new Set(["black", "brown", "crimson", "evilgold", "gray", "orange", "palegreen"]);

// Normalized token → canonical name as it appears in the order arrays.
const CANONICAL_BRIGADE: Record<string, string> = {
  blue: "Blue", clay: "Clay", gold: "Gold", goodgold: "Gold", evilgold: "Gold",
  green: "Green", multi: "Multi", purple: "Purple", red: "Red", silver: "Silver",
  teal: "Teal", white: "White", black: "Black", brown: "Brown", crimson: "Crimson",
  gray: "Gray", orange: "Orange", palegreen: "Pale Green",
};

interface BrigadeInfo {
  tokens: string[]; // trimmed raw tokens, paren segments stripped
  spansAnd: boolean; // remainder contained " and " → spans both alignments
}

function parseBrigade(raw: string): BrigadeInfo {
  const parenMatch = /\(([^)]*)\)/.exec(raw);
  let stripped = raw.replace(/\([^)]*\)/g, "").trim();
  // "(Gold/Red)" alone → fall back to the paren content.
  if (stripped === "" && parenMatch !== null) stripped = parenMatch[1].trim();
  const spansAnd = / and /i.test(stripped);
  const tokens = stripped
    .split(/\/|\band\b/i)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  return { tokens, spansAnd };
}

function brigadeSpansBothAlignments(info: BrigadeInfo): boolean {
  if (info.spansAnd === true) return true;
  let anyGood = false;
  let anyEvil = false;
  for (const t of info.tokens) {
    const n = norm(t);
    if (GOOD_ONLY_TOKENS.has(n) === true) anyGood = true;
    if (EVIL_ONLY_TOKENS.has(n) === true) anyEvil = true;
  }
  return anyGood === true && anyEvil === true;
}

// ---------------------------------------------------------------------------
// Per-section subkeys
// ---------------------------------------------------------------------------

// First integer in the strength string ("4 (0)" → 4, "-1" → -1);
// null for "X" / "*" / "" — those sort after all numbered cards.
function strengthValue(strength: string | undefined): number | null {
  const m = /-?\d+/.exec(strength ?? "");
  if (m === null) return null;
  return parseInt(m[0], 10);
}

// Longest-prefix book match — required so "II Kings" doesn't half-match
// "I Kings"-style confusions and "I John"/"II John"/"III John" win over "John".
function referenceKey(reference: string | undefined): { book: number; chapter: number; verse: number } {
  const ref = (reference ?? "").trim();
  const refLower = ref.toLowerCase();
  let bookIdx = -1;
  let matchLen = 0;
  for (let i = 0; i < BIBLE_BOOK_ORDER.length; i++) {
    const book = BIBLE_BOOK_ORDER[i].toLowerCase();
    if (refLower.startsWith(book) === true && book.length > matchLen) {
      bookIdx = i;
      matchLen = book.length;
    }
  }
  // Singular "Psalm 23:1" counts as Psalms (only when "Psalms" itself missed).
  if (bookIdx === -1 && refLower.startsWith("psalm") === true) {
    bookIdx = BIBLE_BOOK_ORDER.indexOf("Psalms");
    matchLen = "psalm".length;
  }
  if (bookIdx === -1) {
    // Unknown book / empty reference → after all known books.
    return { book: BIBLE_BOOK_ORDER.length, chapter: 0, verse: 0 };
  }
  const m = /(\d+)\s*:\s*(\d+)/.exec(ref.slice(matchLen));
  return {
    book: bookIdx,
    chapter: m !== null ? parseInt(m[1], 10) : 0,
    verse: m !== null ? parseInt(m[2], 10) : 0,
  };
}

// Rank of the card's primary brigade within its alignment's order array.
// Unknown/dirty/empty → after all known brigades, tie-broken by raw string.
function brigadeRank(card: SortableCard, side: "good" | "evil"): { rank: number; tie: string } {
  const order: readonly string[] = side === "good" ? GOOD_BRIGADE_ORDER : EVIL_BRIGADE_ORDER;
  const info = parseBrigade(card.brigade ?? "");
  const primary = info.tokens.length > 0 ? info.tokens[0] : "";
  const canonical = CANONICAL_BRIGADE[norm(primary)];
  if (canonical !== undefined) {
    const idx = order.indexOf(canonical);
    if (idx !== -1) return { rank: idx, tie: "" };
  }
  return { rank: order.length, tie: (card.brigade ?? "").toLowerCase() };
}

function dominantAlignmentRank(alignment: string | undefined): number {
  if (alignment === "Good") return 1;
  if (alignment === "Evil") return 2;
  return 0; // Neutral / dual / missing first
}

// ---------------------------------------------------------------------------
// Sort key
// ---------------------------------------------------------------------------

type SortKey = (string | number)[];

function buildKey(card: SortableCard): SortKey {
  const name = (card.name ?? "").toLowerCase();
  const type = card.type ?? "";
  const parts = typeParts(type);
  const first = parts.length > 0 ? parts[0] : "";
  const firstNorm = norm(first);

  if (firstNorm === "dominant" || firstNorm === "dom") {
    return [SECTION_DOMINANT, dominantAlignmentRank(card.alignment), name];
  }
  if (firstNorm === "artifact" || firstNorm === "art") return [SECTION_ARTIFACT, name];
  if (firstNorm === "covenant" || firstNorm === "cov") return [SECTION_COVENANT, name];
  if (firstNorm === "curse" || firstNorm === "cur") return [SECTION_CURSE, name];
  if (firstNorm === "fortress" || firstNorm === "fort" || firstNorm === "city") {
    return [SECTION_FORTRESS, name];
  }
  if (firstNorm === "site") return [SECTION_SITE, name];
  if (firstNorm === "lostsoul" || firstNorm === "ls") {
    const key = referenceKey(card.reference);
    return [SECTION_LOST_SOUL, key.book, key.chapter, key.verse, (card.reference ?? "").toLowerCase(), name];
  }

  const hasGoodType = parts.some(isGoodSideType);
  const hasEvilType = parts.some(isEvilSideType);
  // Dual: type parts span both sides (GE/EE, Hero/Evil Character, …), or a
  // character/enhancement whose brigades span both alignments
  // ("Green/White and Brown/Crimson").
  if (hasGoodType === true && hasEvilType === true) return [SECTION_DUAL, name];

  if (hasGoodType === true || hasEvilType === true) {
    if (brigadeSpansBothAlignments(parseBrigade(card.brigade ?? "")) === true) {
      return [SECTION_DUAL, name];
    }
    const side: "good" | "evil" = hasGoodType === true ? "good" : "evil";
    const { rank, tie } = brigadeRank(card, side);
    const isCharacter =
      side === "good" ? GOOD_CHAR_TYPES.has(firstNorm) : EVIL_CHAR_TYPES.has(firstNorm);
    const str = strengthValue(card.strength);
    return [
      side === "good" ? SECTION_GOOD : SECTION_EVIL,
      rank,
      tie,
      isCharacter === true ? 0 : 1,
      str !== null ? 0 : 1, // numbered strength before X/*/empty
      str !== null ? -str : 0, // strength descending
      name,
    ];
  }

  return [SECTION_MISC, type.toLowerCase(), name];
}

// Keys are pure functions of the card; cache per object so big lists don't
// rebuild them O(n log n) times.
const keyCache = new WeakMap<SortableCard, SortKey>();

function keyOf(card: SortableCard): SortKey {
  let key = keyCache.get(card);
  if (key === undefined) {
    key = buildKey(card);
    keyCache.set(card, key);
  }
  return key;
}

export function compareCardsDefault(a: SortableCard, b: SortableCard): number {
  const ka = keyOf(a);
  const kb = keyOf(b);
  const len = Math.min(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const x = ka[i];
    const y = kb[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    const r = String(x).localeCompare(String(y));
    if (r !== 0) return r;
  }
  return ka.length - kb.length;
}

// ---------------------------------------------------------------------------
// Grouped ("by type") views — bucket ordering
// ---------------------------------------------------------------------------

// Rank for a type-group bucket name. Accepts the various bucket keys the app
// uses: pretty names ("Hero", "Good Enhancement"), merged buckets
// ("Artifact/Covenant/Curse", "Fortress/Site"), dual buckets ("Dual-Type",
// raw "GE/EE"), and raw type strings from the deck builder ("GE", "Lost Soul").
// Unranked buckets get the same trailing rank; compareTypeGroups breaks ties
// alphabetically.
export function defaultTypeGroupRank(groupName: string): number {
  const g = (groupName ?? "").toLowerCase();
  const gNorm = norm(g);
  if (g.includes("dominant") === true) return 0;
  if (g.includes("artifact") === true || g.includes("covenant") === true || g.includes("curse") === true) return 1;
  if (g.includes("fortress") === true || g.includes("site") === true || g.includes("city") === true) return 2;
  // Exact match so "Lost Soul Token" buckets stay in the trailing misc rank.
  if (gNorm === "lostsoul" || gNorm === "lostsouls" || gNorm === "ls") return 3;
  if (g.includes("dual") === true) return 4;
  const parts = typeParts(groupName ?? "");
  const hasGood = parts.some(isGoodSideType);
  const hasEvil = parts.some(isEvilSideType);
  if (hasGood === true && hasEvil === true) return 4; // raw dual types ("GE/EE")
  const first = parts.length > 0 ? norm(parts[0]) : "";
  if (GOOD_CHAR_TYPES.has(first) === true) return 5;
  if (GOOD_ENH_TYPES.has(first) === true) return 6;
  if (EVIL_CHAR_TYPES.has(first) === true) return 7;
  if (EVIL_ENH_TYPES.has(first) === true) return 8;
  return 9;
}

export function compareTypeGroups(a: string, b: string): number {
  const diff = defaultTypeGroupRank(a) - defaultTypeGroupRank(b);
  if (diff !== 0) return diff;
  return a.localeCompare(b);
}

// ---------------------------------------------------------------------------
// "By type" deck-presentation order
// ---------------------------------------------------------------------------

function alignmentRank(alignment: string | undefined): number {
  const a = alignment ?? "";
  if (a === "Good") return 0;
  if (a === "Evil") return 1;
  if (a === "Neutral" || a === "") return 2;
  return 3;
}

/**
 * Classic decklist order for viewing whole decks: raw type alphabetically,
 * then alignment (Good > Evil > Neutral), then brigade, then name. Mirrors
 * the sister API's ["type", "alignment", "brigade", "name"] sort used for
 * PDF/image output. Card-browsing surfaces (search results, collection,
 * Forge set browser, play-area reserve browsing) use compareCardsDefault.
 */
export function compareCardsByType(a: SortableCard, b: SortableCard): number {
  const typeDiff = (a.type ?? "").localeCompare(b.type ?? "");
  if (typeDiff !== 0) return typeDiff;
  const alignDiff = alignmentRank(a.alignment) - alignmentRank(b.alignment);
  if (alignDiff !== 0) return alignDiff;
  const brigadeDiff = (a.brigade ?? "").localeCompare(b.brigade ?? "");
  if (brigadeDiff !== 0) return brigadeDiff;
  return (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase());
}
