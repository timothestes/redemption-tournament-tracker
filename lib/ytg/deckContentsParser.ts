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
  return parts.every((p) => SECTION_WORDS.has(p)) ? stripped : null;
}

/* ------------------------------------------------------------------ */
/*  Alias candidates                                                   */
/* ------------------------------------------------------------------ */

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
  return map;
}

/* ------------------------------------------------------------------ */
/*  Card name index (built once from CARDS)                            */
/* ------------------------------------------------------------------ */

function loose(s: string): string {
  return s.replace(/[.,'"‘’“”]/g, "").replace(/\s+/g, " ").trim();
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

/** Full ladder, most-specific → loosest. Shared by the index and queries. */
function nameKeyVariants(name: string): string[] {
  const folded = name.replace(/''/g, '"');
  const paren = bracketsToParens(folded);
  return [...new Set([
    normalize(folded),
    normalize(paren),
    normalize(stripEmbeddedSet(folded)),
    normalize(stripEmbeddedSet(paren)),
    loose(normalize(stripEmbeddedSet(paren))),
  ])].filter(Boolean);
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

function cardIndex(): CardIndex {
  if (INDEX) return INDEX;
  const bySet = new Map<string, Map<string, CardData[]>>();
  const global = new Map<string, CardData[]>();
  for (const card of CARDS) {
    if (!card.name) continue;
    let setMap = bySet.get(card.set);
    if (!setMap) { setMap = new Map(); bySet.set(card.set, setMap); }
    for (const key of nameKeyVariants(card.name)) {
      pushKey(setMap, key, card);
      pushKey(global, key, card);
    }
  }
  INDEX = { bySet, global };
  return INDEX;
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
/*  Line grammar + resolution                                          */
/* ------------------------------------------------------------------ */

function parseQty(line: string): { qty: number; rest: string } {
  let m = /^\((\d+)\)\s+(.+)$/.exec(line);
  if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
  m = /^(\d+)\s*[xX]\s+(.+)$/.exec(line);
  if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
  m = /^[xX](\d+)\s+(.+)$/.exec(line);
  if (m) return { qty: parseInt(m[1], 10), rest: m[2] };
  return { qty: 1, rest: line };
}

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

function resolveLine(
  rest: string,
  aliasCandidates: Map<string, string[]>,
  idx: CardIndex,
): Resolution {
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
    aliasHits = [...new Set(aliasHits)];
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
    const fallback = fullHits.length > 0 ? fullHits : lookup(idx.global, nameKeyVariants(rest));
    const cands = toCandidates(fallback, fallback.length === 1 ? 0.7 : 0.4);
    return { name: innerName, setAbbrev: abbrev, candidates: cands, status: statusFor(cands.length) };
  }

  // No trailing paren, or the paren is not a known set → whole line is the name.
  const hits = lookup(idx.global, nameKeyVariants(rest));
  const cands = toCandidates(hits, hits.length === 1 ? 0.7 : 0.4);
  return { name: rest, setAbbrev: null, candidates: cands, status: statusFor(cands.length) };
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
    const header = sectionHeader(line);
    if (header) { section = header; continue; }
    // Prose/flavor-text heuristic: long sentence with no trailing paren.
    if (line.length > 90 && !/\)$/.test(line)) continue;
    if (!/[a-zA-Z]/.test(line)) continue;

    const { qty, rest } = parseQty(line);
    const res = resolveLine(rest, aliasCandidates, idx);
    // Intro junk ("And check out these videos…") sits before the first
    // section header; anything there that doesn't look like a card is
    // dropped outright — same consumption semantics as the prose heuristic.
    // Lines that DO resolve (or are ambiguous) as cards are kept.
    if (hasSections && section === null && res.candidates.length === 0) continue;
    out.push({ raw: line, qty, section, ...res });
  }
  return out;
}
