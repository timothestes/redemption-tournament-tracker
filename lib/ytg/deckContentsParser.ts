/**
 * Pure parser: YTG deck-product description HTML → decklist lines resolved
 * against carddata (spec §Decks tab). No DB, no I/O — aliasCandidates is
 * injected (reversed set_aliases + carddata set-code identities).
 *
 * Precedence rule (spec, verbatim): a trailing parenthetical is a set ONLY
 * if it resolves via aliasCandidates; otherwise it stays part of the name;
 * if BOTH parses resolve to different cards → 'ambiguous', never auto-pick.
 */
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { normalize, stripEmbeddedSet } from "@/lib/pricing/helpers";

export interface ParsedCandidate {
  cardKey: string;   // `${name}|${set}|${imgFile}`
  cardName: string;
  setCode: string;
  confidence: number;
}

export interface ParsedLine {
  raw: string;
  qty: number;
  name: string;
  setAbbrev: string | null;
  candidates: ParsedCandidate[];
  status: "resolved" | "ambiguous" | "unresolved";
  section: string | null;
}

/* ------------------------------------------------------------------ */
/*  HTML → lines                                                       */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", hellip: "…",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/* ------------------------------------------------------------------ */
/*  Section headers                                                    */
/* ------------------------------------------------------------------ */

const SECTION_WORDS = new Set([
  "dominants", "dominant", "lost souls", "lost soul",
  "artifacts", "artifact", "covenants", "covenant", "curses", "curse",
  "fortresses", "fortress", "sites", "site", "cities", "city",
  "heroes", "hero", "good enhancements", "evil enhancements", "enhancements",
  "evil characters", "evil character", "dual-alignment", "dual alignment",
  "reserve", "misc",
]);

export function sectionHeader(line: string): string | null {
  const stripped = line.replace(/:\s*$/, "").trim();
  if (!stripped || stripped.length > 60) return null;
  const parts = stripped.split("/").map((p) => p.trim().toLowerCase());
  const isSectionWord = (p: string): boolean => {
    if (SECTION_WORDS.has(p)) return true;
    // "Dual-Alignment Cards", "Heroes Card List" — trailing filler word.
    const t = p.replace(/\s+(?:cards?( list)?)$/, "").trim();
    return t !== p && t.length > 0 && SECTION_WORDS.has(t);
  };
  return parts.every(isSectionWord) ? stripped : null;
}

/* ------------------------------------------------------------------ */
/*  Post-decklist cutoff                                               */
/* ------------------------------------------------------------------ */

/** Headings that start the post-decklist tail in Andy's descriptions
 *  ("Deck strategy and tips:", "Deck tips and strategies:", "YTG
 *  recommends the below cards…", "OVERVIEW", "THE OFFENSE", "THE
 *  DEFENSE"). Everything from the first marker on is strategy prose and
 *  per-line HYPERLINKED card names that resolve as real cards — without a
 *  hard stop those become phantom deck entries (audit: 525 resolving tail
 *  lines across 71 of 93 decks). Prefix match, case-insensitive; trailing
 *  colons/formatting tolerated. */
const CUTOFF_PREFIXES = [
  "deck strategy", "deck tips", "ytg recommends",
  "overview", "the offense", "the defense",
];

export function isDecklistCutoff(line: string): boolean {
  const t = normalize(line);
  return CUTOFF_PREFIXES.some((p) => t.startsWith(p));
}

/* ------------------------------------------------------------------ */
/*  Alias candidates                                                   */
/* ------------------------------------------------------------------ */

/** Multi-set store abbreviations that can never live in set_aliases: the
 *  table is strictly 1:1 (unique index on carddata_code, and the importer's
 *  forward lookup depends on that direction), so these are parser-side only.
 *  The usual containment disambiguation applies — e.g. "Son of God (I/J)"
 *  resolves because only set I contains the card. */
const SUPPLEMENTAL_ALIASES: Record<string, string[]> = {
  "I/J": ["I", "J"],
  "I/J/L": ["I", "J", "L"],
  "I/J decks": ["I", "J"],
  "P": ["Pmo-P1", "Pmo-P2", "Pmo-P3"],
};

export function buildAliasCandidates(
  rows: { carddata_code: string; shopify_abbrev: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (abbrev: string, code: string) => {
    const key = normalize(abbrev);
    if (!key) return;
    const arr = map.get(key);
    if (arr) { if (!arr.includes(code)) arr.push(code); }
    else map.set(key, [code]);
  };
  for (const r of rows) add(r.shopify_abbrev, r.carddata_code);
  // Identity entries: store lines often use the carddata code itself —
  // "(K)", "(PoC)", "(I/J+)" — which set_aliases doesn't key (it maps
  // carddata → store abbrev, not the reverse).
  for (const card of CARDS) add(card.set, card.set);
  for (const [abbrev, codes] of Object.entries(SUPPLEMENTAL_ALIASES)) {
    for (const code of codes) add(abbrev, code);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Card name index (built once from CARDS)                            */
/* ------------------------------------------------------------------ */

function loose(s: string): string {
  return s.replace(/[.,'"‘’“”]/g, "").replace(/\s+/g, " ").trim();
}
/** Loosest fold: &↔and, slash/dash/comma to space, trailing ?/* stripped.
 *  Applied symmetrically (index + query) on top of loose(). */
function fold(s: string): string {
  return s
    .replace(/&/g, " and ")
    .replace(/[/–—-]/g, " ")
    .replace(/[?*]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
function bracketsToParens(s: string): string {
  return s.replace(/\[/g, "(").replace(/\]/g, ")");
}

/** Strict variants keep any parenthetical text — used for the "name-with-
 *  paren exists as a card" parse so it can't collapse into the set parse. */
function strictVariants(name: string): string[] {
  const folded = name.replace(/''/g, '"');
  return [...new Set([normalize(folded), normalize(bracketsToParens(folded))])].filter(Boolean);
}

function baseKeyVariants(folded: string, paren: string): string[] {
  const loosest = loose(normalize(stripEmbeddedSet(paren)));
  return [
    normalize(folded),
    normalize(paren),
    normalize(stripEmbeddedSet(folded)),
    normalize(stripEmbeddedSet(paren)),
    loosest,
    fold(loosest),
  ];
}

/** Split on "/" outside any paren/bracket — dual-sided card names, not
 *  scripture multi-refs ("[James 4:6 / Proverbs 3:34]") or set codes
 *  ("(I/J+)"). */
function splitTopLevelSlash(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "/" && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Full ladder, most-specific → loosest. Shared by the index and queries. */
function nameKeyVariants(name: string): string[] {
  const folded = name.replace(/''/g, '"');
  const paren = bracketsToParens(folded);
  const keys = baseKeyVariants(folded, paren);
  // Dual-sided names ("Jehoshaphat, the Seeker / Jehoshaphat, the Meek"):
  // an order-insensitive both-halves key (the store sometimes reverses
  // carddata's side order), then each half on its own (the store usually
  // lists just one side). Per-half embedded sets are stripped so
  // "… the Builder (LoC)" folds to "… the Builder".
  const halves = splitTopLevelSlash(paren);
  if (halves.length > 1) {
    keys.push(halves.map((h) => normalize(stripEmbeddedSet(h))).sort().join(" / "));
    for (const h of halves) keys.push(...baseKeyVariants(h, h));
  }
  // Loosest: every parenthetical dropped — "Meshach (Mishael) (PoC)"
  // becomes findable as plain "Meshach". Skipped when any paren holds a
  // scripture ref: for Lost Souls the paren IS the card's identity, and
  // dropping it would flatten every epithet-less soul onto one key.
  const parenContents = paren.match(/\(([^()]*)\)/g) ?? [];
  if (!parenContents.some((p) => /\d+:\d+/.test(p))) {
    keys.push(normalize(paren.replace(/\s*\([^()]*\)/g, " ")));
  }
  return [...new Set(keys)].filter(Boolean);
}

interface CardIndex {
  bySet: Map<string, Map<string, CardData[]>>;
  global: Map<string, CardData[]>;
}

let INDEX: CardIndex | null = null;

function pushKey(map: Map<string, CardData[]>, key: string, card: CardData) {
  const arr = map.get(key);
  if (arr) { if (!arr.includes(card)) arr.push(card); }
  else map.set(key, [card]);
}

/** Strip a trailing paren/bracket that is exactly the card's OWN set code.
 *  stripEmbeddedSet only handles short alphanumeric codes; names like
 *  "New Jerusalem (I/J+)" (set I/J+) slip through and would otherwise never
 *  be findable by their bare name within their set. */
function ownSetStripped(name: string, set: string): string | null {
  const esc = set.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\s*[(\\[]${esc}[)\\]]\\s*$`);
  if (!re.test(name)) return null;
  const stripped = name.replace(re, "").trim();
  return stripped || null;
}

const ERRATA_SUFFIX_RE = /\s*\((?:errata|banned)\)\s*$/i;

function cardIndex(): CardIndex {
  if (INDEX) return INDEX;
  const bySet = new Map<string, Map<string, CardData[]>>();
  const global = new Map<string, CardData[]>();
  for (const card of CARDS) {
    if (!card.name) continue;
    let setMap = bySet.get(card.set);
    if (!setMap) { setMap = new Map(); bySet.set(card.set, setMap); }
    const keys = nameKeyVariants(card.name);
    const own = ownSetStripped(card.name, card.set);
    if (own) keys.push(...nameKeyVariants(own));
    if (ERRATA_SUFFIX_RE.test(card.name)) {
      keys.push(...nameKeyVariants(card.name.replace(ERRATA_SUFFIX_RE, "")));
    }
    for (const key of new Set(keys)) {
      pushKey(setMap, key, card);
      pushKey(global, key, card);
    }
  }
  INDEX = { bySet, global };
  return INDEX;
}

/** When hits differ only by an (Errata)/(Banned) suffix, the store sells and
 *  ships the errata printing — prefer it. */
function preferErrata(hits: CardData[]): CardData[] {
  if (hits.length < 2) return hits;
  const errata = hits.filter((c) => /\(errata\)\s*$/i.test(c.name));
  if (errata.length === 1 && hits.every((c) => ERRATA_SUFFIX_RE.test(c.name))) {
    return errata;
  }
  return hits;
}

/** THE one sanctioned exception to never-auto-pick: several PRINTS of the
 *  same card name within the SAME set — e.g. LoC carries both "Book of the
 *  Law (LoC)" and "Book of the Law (Promo)". Prefer the print whose own-set
 *  suffix strips clean to the queried name, else the suffix-less base
 *  printing. Genuinely different same-set cards (disambiguators like
 *  "(Sky)"/"(River)", dual variants) never collapse — the stripped name
 *  must equal the queried name exactly. */
function narrowSameSetTwins(hits: CardData[], innerName: string): CardData[] {
  const set = hits[0].set;
  if (!hits.every((c) => c.set === set)) return hits;
  const want = normalize(innerName);
  const ownSuffix = hits.filter((c) => {
    const stripped = ownSetStripped(c.name, c.set);
    return stripped !== null && normalize(stripped) === want;
  });
  if (ownSuffix.length === 1) return ownSuffix;
  const base = hits.filter((c) => normalize(c.name) === want);
  if (base.length === 1) return base;
  return hits;
}

function lookup(map: Map<string, CardData[]> | undefined, variants: string[]): CardData[] {
  if (!map) return [];
  for (const v of variants) {
    const hits = map.get(v);
    if (hits && hits.length > 0) return hits;
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Lost Soul scripture-reference matching                             */
/* ------------------------------------------------------------------ */

/** Book word + chapter:verse(-range). Book capture is deliberately just the
 *  immediately-preceding word (plus optional 1-3 / I-III numeral, folded to
 *  digits: carddata's L/Ki souls write "II Chronicles 28:13") so extraction
 *  is consistent between store lines ("(Daniel 9:5)") and carddata names
 *  ("[Daniel 9:5]", "Lost Soul Jeremiah 13:10 (Color Guard)"). */
const SCRIPTURE_RE = /(?:\b([1-3]|III|II|I)\s+)?([A-Za-z][A-Za-z.]*)\s+(\d+):(\d+(?:\s*[-–]\s*\d+)?)/g;
const ROMAN_BOOK_NUM: Record<string, string> = { I: "1", II: "2", III: "3" };

function scriptureRefs(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(SCRIPTURE_RE)) {
    const num = m[1] ? `${ROMAN_BOOK_NUM[m[1]] ?? m[1]} ` : "";
    const book = `${num}${m[2].toLowerCase().replace(/\./g, "")}`;
    const verse = m[4].replace(/\s*[-–]\s*/g, "-");
    out.push(`${book} ${m[3]}:${verse}`);
  }
  return out;
}

/** First quoted span, quote styles folded ('' doubled-singles, smart quotes). */
function epithetOf(s: string): string | null {
  const m = /"([^"]+)"/.exec(normalize(s.replace(/''/g, '"')));
  return m ? m[1].trim() : null;
}

/** Card-side epithet: quoted span, else the Ki/Pri-era paren form —
 *  "Lost Soul II Chronicles 28:13 (Hopper)" — skipping scripture refs and
 *  short set-code suffixes like "(Ki)". */
function cardEpithetOf(name: string): string | null {
  const quoted = epithetOf(name);
  if (quoted !== null) return quoted;
  for (const m of name.matchAll(/\(([^()]+)\)/g)) {
    const inner = m[1].trim();
    if (/\d/.test(inner)) continue; // scripture ref / year
    if (/^[A-Z][A-Za-z0-9]{0,4}$/.test(inner)) continue; // set-code-ish
    return normalize(inner);
  }
  return null;
}

interface LostSoulEntry { card: CardData; refs: string[]; epithet: string | null }

let LS_INDEX: LostSoulEntry[] | null = null;

function lostSoulIndex(): LostSoulEntry[] {
  if (LS_INDEX) return LS_INDEX;
  LS_INDEX = [];
  for (const card of CARDS) {
    if (!card.name || !/^lost soul/i.test(card.name)) continue;
    const refs = scriptureRefs(card.name);
    const epithet = cardEpithetOf(card.name);
    if (refs.length > 0 || epithet !== null) LS_INDEX.push({ card, refs, epithet });
  }
  return LS_INDEX;
}

/* ------------------------------------------------------------------ */
/*  Line grammar + resolution                                          */
/* ------------------------------------------------------------------ */

function parseQty(line: string): { qty: number; rest: string } {
  let m = /^\((\d+)\)\s+(.+)$/.exec(line);
  if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
  m = /^(\d+)\s*[xX]\s+(.+)$/.exec(line);
  if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
  m = /^[xX](\d+)\s+(.+)$/.exec(line);
  if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
  m = /^(.+?)\s+[xX]\s*(\d+)$/.exec(line); // "Meek (J) x3"
  if (m) return { qty: parseInt(m[2], 10), rest: m[1] };
  return { qty: 1, rest: line };
}

/** " - $3.00" style price tails some store lines carry. */
const PRICE_SUFFIX_RE = /\s*[-–—]\s*\$\d+(?:\.\d{1,2})?\s*$/;

const TRAILING_PAREN = /^(.*?)\s*\(([^()]+)\)$/;

function toCandidates(hits: CardData[], confidence: number): ParsedCandidate[] {
  return hits.map((c) => ({
    cardKey: `${c.name}|${c.set}|${c.imgFile}`,
    cardName: c.name,
    setCode: c.set,
    confidence,
  }));
}

function dedupeCandidates(cands: ParsedCandidate[]): ParsedCandidate[] {
  const seen = new Map<string, ParsedCandidate>();
  for (const c of cands) {
    const prev = seen.get(c.cardKey);
    if (!prev || c.confidence > prev.confidence) seen.set(c.cardKey, c);
  }
  return [...seen.values()];
}

type Resolution = Omit<ParsedLine, "raw" | "qty" | "section">;

function statusFor(n: number): ParsedLine["status"] {
  return n === 1 ? "resolved" : n > 1 ? "ambiguous" : "unresolved";
}

/** Scripture-ref rescue for otherwise-unresolved "Lost Soul …" lines.
 *  Store descriptions freely reorder epithet/scripture and swap () for []
 *  ("Lost Soul (Daniel 9:5) ''Covenant Breakers''" vs carddata's
 *  'Lost Soul "Covenant Breakers" [Daniel 9:5]'), so name-shape matching
 *  fails; the scripture ref is the stable token. Match primarily by ref
 *  (within poolSets when a set abbrev parsed, else all sets); epithet is
 *  only a tiebreaker. One hit → resolved; several → ambiguous (never
 *  auto-pick); none → keep the base resolution. */
function withLostSoulScripture(
  base: Resolution,
  rest: string,
  poolSets: string[] | null,
): Resolution {
  if (base.status !== "unresolved") return base;
  if (!/^lost soul/i.test(rest.trim())) return base;
  const lineRefs = scriptureRefs(rest);
  if (lineRefs.length === 0) return base;

  let hits = lostSoulIndex().filter(
    (e) =>
      (poolSets === null || poolSets.includes(e.card.set)) &&
      lineRefs.every((r) => e.refs.includes(r)),
  );
  if (hits.length === 0) return base;
  if (hits.length > 1) {
    const epithet = epithetOf(rest);
    if (epithet !== null) {
      const narrowed = hits.filter((e) => e.epithet === epithet);
      if (narrowed.length === 1) hits = narrowed;
    }
  }
  const cards = hits.map((e) => e.card);
  return {
    ...base,
    candidates: toCandidates(cards, cards.length === 1 ? 0.9 : 0.5),
    status: statusFor(cards.length),
  };
}

/** Bare-epithet rescue, only inside a Lost Souls section: store lines there
 *  are mostly epithet + set — "Remnant (PoC)", "Hopper (Ki)", "Contempt
 *  (TtC)" — while carddata writes 'Lost Soul "Remnant" [Jeremiah 31:8]'.
 *  Match the line's name as an epithet among Lost Soul cards within the
 *  aliased candidate sets. One hit → resolved; several → ambiguous (never
 *  auto-pick); none → keep the base resolution.
 *
 *  Runs when the base is unresolved, and ALSO when the base only found
 *  cards outside the aliased sets: "Escape (PC)" would otherwise
 *  cross-set-fall-back to the AW dominant "Escape" and shadow TPC's
 *  'Lost Soul "Escape" [II Timothy 2:26 - TPC]' — in a Lost Souls section
 *  with an explicit set, the in-set soul is the stronger read. In-pool base
 *  resolutions are never overridden. */
function withLostSoulEpithet(
  base: Resolution,
  innerName: string,
  poolSets: string[],
  inLostSoulSection: boolean,
): Resolution {
  if (!inLostSoulSection) return base;
  const outOfPool =
    base.candidates.length > 0 &&
    base.candidates.every((c) => !poolSets.includes(c.setCode));
  if (base.status !== "unresolved" && !outOfPool) return base;
  if (/^lost soul/i.test(innerName.trim())) return base;
  const epithet = normalize(innerName);
  if (!epithet) return base;
  const hits = lostSoulIndex().filter(
    (e) => poolSets.includes(e.card.set) && e.epithet === epithet,
  );
  if (hits.length === 0) return base;
  const cards = hits.map((e) => e.card);
  return {
    ...base,
    candidates: toCandidates(cards, cards.length === 1 ? 0.9 : 0.5),
    status: statusFor(cards.length),
  };
}

/** "Or"-option parens: "(I & J+ or Promo)", "(I/J)". The whole paren failed
 *  as one alias; split it into tokens and alias-resolve each independently.
 *  Top-level separators first (or, comma) so multi-word aliases like
 *  "I & J+" resolve whole before the tighter &// split. Tokens that don't
 *  resolve are ignored. */
function splitParenSets(
  abbrev: string,
  aliasCandidates: Map<string, string[]>,
): string[] {
  const sets: string[] = [];
  for (const token of abbrev.split(/\s+or\s+|,/i).map((t) => t.trim()).filter(Boolean)) {
    const whole = aliasCandidates.get(normalize(token));
    if (whole) { sets.push(...whole); continue; }
    for (const sub of token.split(/[&/]/).map((s) => s.trim()).filter(Boolean)) {
      const subSets = aliasCandidates.get(normalize(sub));
      if (subSets) sets.push(...subSets);
    }
  }
  return [...new Set(sets)];
}

function resolveLine(
  rest: string,
  aliasCandidates: Map<string, string[]>,
  idx: CardIndex,
  section: string | null = null,
): Resolution {
  const inLostSoulSection = section !== null && /lost soul/i.test(section);
  const paren = TRAILING_PAREN.exec(rest);
  const abbrev = paren ? paren[2].trim() : null;
  const aliasSets = abbrev ? aliasCandidates.get(normalize(abbrev)) : undefined;

  if (paren && aliasSets) {
    const innerName = paren[1].trim();
    // Parse A — trailing paren is a set: look the name up in each candidate set.
    let aliasHits: CardData[] = [];
    for (const setCode of aliasSets) {
      aliasHits.push(...lookup(idx.bySet.get(setCode), nameKeyVariants(innerName)));
    }
    aliasHits = preferErrata([...new Set(aliasHits)]);
    if (aliasHits.length > 1) aliasHits = narrowSameSetTwins(aliasHits, innerName);
    // Parse B — the whole line (paren included) is itself a card name.
    // Strict variants only: stripping variants would just re-derive parse A.
    const fullHits = lookup(idx.global, strictVariants(rest));

    if (aliasHits.length > 0) {
      const union = dedupeCandidates([
        ...toCandidates(aliasHits, aliasHits.length === 1 ? 0.95 : 0.5),
        ...toCandidates(fullHits, 0.6),
      ]);
      // If both parses agree on one card it's simply resolved; different
      // cards → ambiguous, both candidates listed (spec: never auto-pick).
      return { name: innerName, setAbbrev: abbrev, candidates: union, status: statusFor(union.length) };
    }

    // Set abbrev resolved but no candidate set contains the name — fall back
    // to a global search (full line first, then the paren-stripped name).
    const fallback = preferErrata(
      fullHits.length > 0 ? fullHits : lookup(idx.global, nameKeyVariants(rest)),
    );
    const cands = toCandidates(fallback, fallback.length === 1 ? 0.7 : 0.4);
    let res: Resolution = { name: innerName, setAbbrev: abbrev, candidates: cands, status: statusFor(cands.length) };
    res = withLostSoulScripture(res, rest, aliasSets);
    res = withLostSoulEpithet(res, innerName, aliasSets, inLostSoulSection);
    return res;
  }

  // Paren is not a single known set — maybe it's an option list of sets.
  let orSets: string[] = [];
  if (paren && abbrev !== null) {
    orSets = splitParenSets(abbrev, aliasCandidates);
    if (orSets.length > 0) {
      const innerName = paren[1].trim();
      let orHits: CardData[] = [];
      for (const setCode of orSets) {
        orHits.push(...lookup(idx.bySet.get(setCode), nameKeyVariants(innerName)));
      }
      orHits = [...new Set(orHits)];
      const fullHits = lookup(idx.global, strictVariants(rest));
      if (orHits.length > 0) {
        // The source line itself offers alternatives — surface every print
        // for a one-click pick, and NEVER auto-resolve (even a single hit
        // still needs the admin to confirm which option the store meant).
        const union = dedupeCandidates([
          ...toCandidates(orHits, 0.5),
          ...toCandidates(fullHits, 0.6),
        ]);
        return { name: innerName, setAbbrev: abbrev, candidates: union, status: "ambiguous" };
      }
      // No option-set contains the name → fall through to current behavior
      // (paren stays part of the name).
    }
  }

  // No trailing paren, or the paren is not a known set → whole line is the name.
  const hits = preferErrata(lookup(idx.global, nameKeyVariants(rest)));
  const cands = toCandidates(hits, hits.length === 1 ? 0.7 : 0.4);
  return withLostSoulScripture(
    { name: rest, setAbbrev: null, candidates: cands, status: statusFor(cands.length) },
    rest,
    orSets.length > 0 ? orSets : null,
  );
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export function parseDeckContents(
  bodyHtml: string,
  aliasCandidates: Map<string, string[]>,
): ParsedLine[] {
  const idx = cardIndex();
  const out: ParsedLine[] = [];
  let section: string | null = null;
  const lines = htmlToLines(bodyHtml);
  // Pre-section prose drop only applies when the description actually has
  // section headers; otherwise everything is "before the first section".
  const hasSections = lines.some((l) => sectionHeader(l) !== null);

  for (const line of lines) {
    // HARD STOP at the first post-decklist marker: the tail's hyperlinked
    // card names resolve as real cards and would silently corrupt the deck.
    // Gated on being inside the decklist (section seen) so an intro line
    // that happens to start with a marker word can't wipe the whole parse.
    if (section !== null && isDecklistCutoff(line)) break;
    const header = sectionHeader(line);
    if (header) { section = header; continue; }
    // Bare "Card List" layout noise: consume without changing the section.
    if (/^cards? list:?$/i.test(line.trim())) continue;
    // Prose/flavor-text heuristic: long sentence with no trailing paren.
    if (line.length > 90 && !/\)$/.test(line)) continue;
    if (!/[a-zA-Z]/.test(line)) continue;

    let { qty, rest } = parseQty(line);
    rest = rest.replace(PRICE_SUFFIX_RE, "");
    let res = resolveLine(rest, aliasCandidates, idx, section);
    // Leading bare number as qty ("3 N.T. Meek (I/J)") — but only when the
    // full text resolves to nothing, so digit-leading card names like
    // "7 Years of Famine" always win.
    if (res.candidates.length === 0) {
      const bare = /^(\d{1,2})\s+(.+)$/.exec(rest);
      if (bare) {
        const retry = resolveLine(bare[2], aliasCandidates, idx, section);
        if (retry.candidates.length > 0) {
          qty *= parseInt(bare[1], 10);
          res = retry;
        }
      }
    }
    // Intro junk ("And check out these videos…") sits before the first
    // section header; anything there that doesn't look like a card is
    // dropped outright — same consumption semantics as the prose heuristic.
    // Lines that DO resolve (or are ambiguous) as cards are kept.
    if (hasSections && section === null && res.candidates.length === 0) continue;
    out.push({ raw: line, qty, section, ...res });
  }
  return out;
}
