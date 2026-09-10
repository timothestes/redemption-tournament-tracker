/**
 * Canonical "default" card sort order, shared by every surface that lists
 * cards (deckbuilder, public deck view, exports, Forge, play-area reserve
 * browsing, collection). Pure and dependency-free — no card data imports —
 * so it can be bundled anywhere and mirrored 1:1 in the sister Python API.
 *
 * Order (the design team's print order): Dominants (neutral/dual, good,
 * evil), Artifacts, Covenants, Curses, Cities, Fortresses, Sites, Lost Souls
 * (biblical reference order), dual characters/enhancements (characters,
 * character+enhancement dual-types, enhancements — each strength
 * descending), Good brigades, Evil brigades, then everything else.
 *
 * Brigade-grouped sections (Covenants, Curses, Cities, Sites, Good, Evil)
 * put MULTI FIRST — any card with 2+ brigades or a literal "Multi" — then
 * single brigades alphabetically by color. Inside a Good/Evil brigade:
 * characters (strength descending) then enhancements (strength descending).
 * Covenants and Curses also sort strength descending inside a brigade;
 * Cities and Sites go straight to name. Same-strength ties go by toughness
 * descending, then name. Validated against Times to Come and Israel's
 * Inheritance, whose card-data file order is the print order.
 *
 * Alphabetical tie-breaks ignore a leading "The " (confirmed against real
 * print-number order in Times to Come, Revelation of John, and Israel's
 * Rebellion — e.g. "The Book of Knowledge" prints between "Abomination..."
 * and "Darius' Decree", i.e. alphabetized as "Book of Knowledge").
 *
 * `compareCardsEndOfTimes` is a validated one-off for that single set (real
 * print numbers, not a generalizable rule — see app/forge/lib/cardOrder.ts
 * for where it's applied): it counts a leading "The" as a real word ("The
 * Book of Life" prints after "Letters to Thessalonica", not before), and
 * Good Enhancements specifically break same-strength ties by toughness
 * ascending instead of descending (Risen by Christ 2/3 prints before Stand
 * Firm 2/5) — this does NOT extend to Evil Enhancements (Great Feast 0/6
 * still prints before Filled with Flesh 0/0), Heroes/Evil Characters (Seven
 * Trumpet Sounders 7/7 prints before The Third Creature 7/5), or any other
 * section — everything else keeps descending, same as compareCardsDefault.
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
  toughness?: string;
  reference?: string;
}

// Brigade orders: Multi first, then alphabetical by color. "Gold" covers
// Good Gold / Evil Gold per the list it appears in.
export const GOOD_BRIGADE_ORDER = [
  "Multi", "Blue", "Clay", "Gold", "Green", "Purple", "Red", "Silver", "Teal", "White",
] as const;

export const EVIL_BRIGADE_ORDER = [
  "Multi", "Black", "Brown", "Crimson", "Gold", "Gray", "Orange", "Pale Green",
] as const;

// Sections whose cards can carry either alignment's colors (Covenants, Curses,
// Cities, Sites) group by this merged order — the same rule, both palettes.
const ALL_BRIGADE_ORDER = [
  "Multi", "Black", "Blue", "Brown", "Clay", "Crimson", "Gold", "Gray", "Green",
  "Orange", "Pale Green", "Purple", "Red", "Silver", "Teal", "White",
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
const SECTION_CITY = 4;
const SECTION_FORTRESS = 5;
const SECTION_SITE = 6;
const SECTION_LOST_SOUL = 7;
const SECTION_DUAL = 8;
const SECTION_GOOD = 9;
const SECTION_EVIL = 10;
const SECTION_MISC = 11;

// Normalize a type/brigade token for matching: lowercase, drop spaces/hyphens.
// Handles both raw carddata forms ("Evil Character", "Lost Soul", "Pale Green")
// and Forge forms ("EvilCharacter", "LostSoul", "PaleGreen").
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, "");
}

// Lowercased alphabetization key for a card name, ignoring a leading "The "
// the way the designers do (see module docstring) unless `literalArticles`
// is set, in which case "The" sorts as a real word. "Theodore..." is left
// alone either way — only a standalone leading "The" article is stripped.
function alphaKey(name: string | undefined, literalArticles: boolean = false): string {
  const n = (name ?? "").toLowerCase();
  return literalArticles === true ? n : n.replace(/^the\s+/, "");
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

// Rank of the card's brigade group within an order array. Multi — a literal
// "Multi" token, or 2+ distinct recognized colors outside any parens — ranks
// first; a single color ranks by its position; unknown/dirty/empty → after all
// known brigades, tie-broken by raw string. Only recognized colors count, so a
// stray token ("Good/White") doesn't make a card multi.
function brigadeRank(brigade: string | undefined, side: "good" | "evil" | "any"): { rank: number; tie: string } {
  const order: readonly string[] =
    side === "good" ? GOOD_BRIGADE_ORDER : side === "evil" ? EVIL_BRIGADE_ORDER : ALL_BRIGADE_ORDER;
  const colors = new Set<string>();
  let literalMulti = false;
  for (const t of parseBrigade(brigade ?? "").tokens) {
    const canonical = CANONICAL_BRIGADE[norm(t)];
    if (canonical === "Multi") literalMulti = true;
    else if (canonical !== undefined) colors.add(canonical);
  }
  if (literalMulti === true || colors.size >= 2) return { rank: order.indexOf("Multi"), tie: "" };
  if (colors.size === 1) {
    const idx = order.indexOf([...colors][0]);
    if (idx !== -1) return { rank: idx, tie: "" };
  }
  return { rank: order.length, tie: (brigade ?? "").toLowerCase() };
}

// Numbered strength first (descending), then X / * / empty; same-strength
// ties by toughness — descending, the way every other validated set breaks
// them, except End of Times, which breaks them ascending (Risen by Christ
// 2/3 prints before Stand Firm 2/5).
function strengthKey(
  strength: string | undefined,
  toughness: string | undefined,
  toughnessAscending: boolean = false,
): [number, number, number, number] {
  const str = strengthValue(strength);
  const tough = strengthValue(toughness);
  const toughSign = toughnessAscending === true ? 1 : -1;
  return [str !== null ? 0 : 1, str !== null ? -str : 0, tough !== null ? 0 : 1, tough !== null ? toughSign * tough : 0];
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

// Covenants, Curses, Cities, Sites: brigade group (multi first), optionally
// strength descending (Covenants/Curses carry power), then name. Covenants
// and Curses aren't characters or enhancements, so End of Times' ascending
// toughness rule (see strengthKey) doesn't apply here — no evidence it does,
// and reversing it broke nothing validated, so it stays descending.
function brigadeGroupKey(section: number, card: SortableCard, byStrength: boolean, eot: boolean): SortKey {
  const { rank, tie } = brigadeRank(card.brigade, "any");
  return byStrength === true
    ? [section, rank, tie, ...strengthKey(card.strength, card.toughness), alphaKey(card.name, eot)]
    : [section, rank, tie, alphaKey(card.name, eot)];
}

// Dual section: characters, then character+enhancement dual-types
// (GE/Evil Character, Hero/EE), then enhancements — each strength
// descending. End of Times' ascending exception is confirmed for plain GE
// only (see strengthKey); no evidence it extends to a dual GE/EE pairing,
// so this stays descending under eot too.
function dualKey(card: SortableCard, parts: string[], eot: boolean): SortKey {
  const hasChar = parts.some((p) => GOOD_CHAR_TYPES.has(norm(p)) === true || EVIL_CHAR_TYPES.has(norm(p)) === true);
  const hasEnh = parts.some((p) => GOOD_ENH_TYPES.has(norm(p)) === true || EVIL_ENH_TYPES.has(norm(p)) === true);
  const group = hasChar === true && hasEnh === true ? 1 : hasChar === true ? 0 : 2;
  return [SECTION_DUAL, group, ...strengthKey(card.strength, card.toughness), alphaKey(card.name, eot)];
}

// `eot` bundles End of Times' validated deviations from every other set: a
// literal (not ignored) leading "The", and — for enhancements only, not
// characters — toughness ties broken ascending instead of descending. See
// compareCardsEndOfTimes and cardOrder.ts.
function buildKey(card: SortableCard, eot: boolean): SortKey {
  const name = alphaKey(card.name, eot);
  const type = card.type ?? "";
  const parts = typeParts(type);
  const first = parts.length > 0 ? parts[0] : "";
  const firstNorm = norm(first);

  if (firstNorm === "dominant" || firstNorm === "dom") {
    return [SECTION_DOMINANT, dominantAlignmentRank(card.alignment), name];
  }
  if (firstNorm === "artifact" || firstNorm === "art") return [SECTION_ARTIFACT, name];
  if (firstNorm === "covenant" || firstNorm === "cov") return brigadeGroupKey(SECTION_COVENANT, card, true, eot);
  if (firstNorm === "curse" || firstNorm === "cur") return brigadeGroupKey(SECTION_CURSE, card, true, eot);
  if (firstNorm === "city") return brigadeGroupKey(SECTION_CITY, card, false, eot);
  if (firstNorm === "fortress" || firstNorm === "fort") return [SECTION_FORTRESS, name];
  if (firstNorm === "site") return brigadeGroupKey(SECTION_SITE, card, false, eot);
  if (firstNorm === "lostsoul" || firstNorm === "ls") {
    const key = referenceKey(card.reference);
    return [SECTION_LOST_SOUL, key.book, key.chapter, key.verse, (card.reference ?? "").toLowerCase(), name];
  }

  const hasGoodType = parts.some(isGoodSideType);
  const hasEvilType = parts.some(isEvilSideType);
  // Dual: type parts span both sides (GE/EE, Hero/Evil Character, …), or a
  // character/enhancement whose brigades span both alignments
  // ("Green/White and Brown/Crimson").
  if (hasGoodType === true && hasEvilType === true) return dualKey(card, parts, eot);

  if (hasGoodType === true || hasEvilType === true) {
    if (brigadeSpansBothAlignments(parseBrigade(card.brigade ?? "")) === true) {
      return dualKey(card, parts, eot);
    }
    const side: "good" | "evil" = hasGoodType === true ? "good" : "evil";
    const { rank, tie } = brigadeRank(card.brigade, side);
    const isCharacter =
      side === "good" ? GOOD_CHAR_TYPES.has(firstNorm) : EVIL_CHAR_TYPES.has(firstNorm);
    // Under End of Times only Good Enhancements ascend (Risen by Christ 2/3
    // before Stand Firm 2/5). Heroes and Evil Characters keep descending
    // (Seven Trumpet Sounders 7/7 before The Third Creature 7/5), and so do
    // Evil Enhancements (Great Feast 0/6 before Filled with Flesh 0/0) —
    // this is a GE-only exception, not "enhancements" generally.
    const toughnessAscending = eot === true && side === "good" && isCharacter === false;
    return [
      side === "good" ? SECTION_GOOD : SECTION_EVIL,
      rank,
      tie,
      isCharacter === true ? 0 : 1,
      ...strengthKey(card.strength, card.toughness, toughnessAscending),
      name,
    ];
  }

  return [SECTION_MISC, type.toLowerCase(), name];
}

// Keys are pure functions of the card; cache per object so big lists don't
// rebuild them O(n log n) times. Separate caches per `eot` value — the same
// card object could otherwise return a stale key for the other variant.
const keyCache = new WeakMap<SortableCard, SortKey>();
const keyCacheEndOfTimes = new WeakMap<SortableCard, SortKey>();

function keyOf(card: SortableCard, eot: boolean): SortKey {
  const cache = eot === true ? keyCacheEndOfTimes : keyCache;
  let key = cache.get(card);
  if (key === undefined) {
    key = buildKey(card, eot);
    cache.set(card, key);
  }
  return key;
}

function compare(a: SortableCard, b: SortableCard, eot: boolean): number {
  const ka = keyOf(a, eot);
  const kb = keyOf(b, eot);
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

export function compareCardsDefault(a: SortableCard, b: SortableCard): number {
  return compare(a, b, false);
}

// One-off for End of Times (see module docstring) — counts a leading "The"
// as a real word, and breaks same-strength Good Enhancement ties by
// toughness ascending instead of descending (everything else, including
// Evil Enhancements, keeps descending).
export function compareCardsEndOfTimes(a: SortableCard, b: SortableCard): number {
  return compare(a, b, true);
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
  return alphaKey(a.name).localeCompare(alphaKey(b.name));
}
