/**
 * Wraps card names already written in a deck description in `[[ ]]`, so the
 * prose an author typed before mentions existed starts rendering card links.
 *
 * Pure text surgery — the caller decides which names are fair game (see
 * candidates.ts: cards the deck actually plays, whose mention is known to
 * resolve). The rules below all exist to keep a backfill over someone else's
 * writing from ever changing what it says:
 *
 * - Case-sensitive. "Mayhem" is the card; "the mayhem of turn three" is prose.
 * - Whole words only, though a possessive may follow ("Son of God's").
 * - Longest candidate first, so "The Angel of the Lord" wins over "Angel".
 * - Once per paragraph per card: the reader gets the preview in the paragraph
 *   they are reading without the page turning into a field of underlines.
 * - Code, existing mentions, links, URLs, HTML and headings are off limits.
 * - A name followed by chapter:verse is scripture, not a card ("John 15:13").
 * - A name sitting inside a LONGER card name is left alone: an author writing
 *   "Faith of Samuel" or "Goliath's Curse" means that card, not the deck's
 *   "Faith" or "Goliath", and a link there would rename their card.
 */

const PROTECTED = new RegExp(
  [
    "```[\\s\\S]*?```", // fenced code
    "`[^`\\n]*`", // inline code
    "\\[\\[[^\\]]*\\]\\]", // an existing mention
    "!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)", // markdown link or image
    "<[^>\\n]+>", // html tag or autolink
    "(?:https?://|www\\.)\\S+", // bare url
  ].join("|"),
  "g",
);

const HEADING = /^\s{0,3}#{1,6}\s/;
/** "John 15:13" is the verse, not the card. */
const VERSE_AFTER = /^\s*\d+:\d+/;
/** A name may be followed by a possessive apostrophe, but not by more word. */
const WORD_AFTER = /[A-Za-z0-9-]/;
const WORD_BEFORE = /[A-Za-z0-9'’-]/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How far either side to look for a longer card name swallowing the match. */
const CONTEXT_WORDS = 5;
const TRIM = /^[^A-Za-z0-9]+|[^A-Za-z0-9)\]]+$/g;

/** Word-start offsets at or before `at`, nearest first, and word-end offsets at or after. */
function wordStarts(text: string, at: number): number[] {
  const out = [at];
  for (let i = at - 1; i >= 0 && out.length <= CONTEXT_WORDS; i--) {
    // The first word of the paragraph has no whitespace in front of it.
    if (i === 0 && !/\s/.test(text[0])) out.push(0);
    else if (/\s/.test(text[i]) && !/\s/.test(text[i + 1] ?? "")) out.push(i + 1);
  }
  return out;
}

function wordEnds(text: string, at: number): number[] {
  const out = [at];
  for (let i = at; i <= text.length && out.length <= CONTEXT_WORDS; i++) {
    if (i === text.length || (/\s/.test(text[i]) && !/\s/.test(text[i - 1] ?? ""))) out.push(i);
  }
  return out;
}

/**
 * True when some longer stretch of words around the match is itself a card
 * name. "Faith" inside "Faith of Samuel" must stay plain text.
 */
function insideLongerCardName(
  text: string,
  start: number,
  end: number,
  knownName: (candidate: string) => boolean,
): boolean {
  for (const from of wordStarts(text, start)) {
    for (const to of wordEnds(text, end)) {
      if (from === start && to === end) continue;
      const span = text.slice(from, to).replace(TRIM, "");
      if (span.length <= end - start) continue;
      if (knownName(span)) return true;
    }
  }
  return false;
}

/** Character ranges the linker must not touch, in order. */
function protectedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(PROTECTED)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

function overlaps(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([a, b]) => start < b && end > a);
}

function linkParagraph(
  para: string,
  candidates: string[],
  added: string[],
  knownName: (candidate: string) => boolean,
): string {
  if (HEADING.test(para)) return para;
  let text = para;
  for (const name of candidates) {
    const re = new RegExp(escapeRe(name), "g");
    const blocked = protectedRanges(text);
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      const end = start + name.length;
      if (WORD_BEFORE.test(text[start - 1] ?? "")) continue;
      if (WORD_AFTER.test(text[end] ?? "")) continue;
      if (overlaps(blocked, start, end)) continue;
      if (VERSE_AFTER.test(text.slice(end, end + 10))) continue;
      // "Faith of Abe" — a one-word card followed by "of" is nearly always the
      // author's shorthand for a longer card name the index does not know.
      if (!name.includes(" ") && /^\s+of\b/i.test(text.slice(end, end + 5))) continue;
      if (insideLongerCardName(text, start, end, knownName)) continue;
      text = `${text.slice(0, start)}[[${name}]]${text.slice(end)}`;
      added.push(name);
      break; // once per paragraph per card
    }
  }
  return text;
}

export interface LinkResult {
  markdown: string;
  /** Card names wrapped, in the order they were wrapped. */
  added: string[];
}

export interface LinkOptions {
  /** Tells the linker whether a stretch of text is itself a card name. */
  knownName?: (candidate: string) => boolean;
}

export function linkCardMentions(markdown: string, candidates: string[], options: LinkOptions = {}): LinkResult {
  const knownName = options.knownName ?? (() => false);
  const ordered = [...new Set(candidates)].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const added: string[] = [];
  // Split on blank lines, keeping the separators so the text round-trips byte
  // for byte when nothing matches.
  const parts = markdown.split(/(\n[ \t]*\n)/);
  const out = parts.map((p, i) => (i % 2 === 0 ? linkParagraph(p, ordered, added, knownName) : p));
  return { markdown: out.join(""), added };
}
