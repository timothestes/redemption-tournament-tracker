// Text-box fit: wraps the ability and the verse the way the browser will (Arimo advance
// widths, greedy breaks at spaces and after hyphens) at the sizes printed cards use, and
// reports whether the ability collides with the verse. Pure — usable server-side for a
// set-wide pass as well as by the preview. Metrics were measured off printed Roots /
// Roots 2 / Israel's Inheritance / Times to Come cards; see the design spec's "Text fit"
// section for the numbers behind each constant.
import { BOLD_ADVANCES, ITALIC_ADVANCES, FONT_UPEM } from "@/app/forge/lib/fontMetrics";
import { RECTS } from "@/app/forge/lib/frameGeometry";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";

/** Canvas px, offsets from the top of RECTS.textBox. */
export const TEXT_METRICS = {
  // Bold, centered, top-anchored: the first line's cap tops sit 24 px below the box top on a
  // 31.6 px pitch, and printed cards never shrink it to make room. 30.9 px is the one size
  // that reproduces every line break on six printed cards (30.8 < size <= 30.99).
  ability: { size: 30.9, pitch: 31.6, top: 19.6, paragraphGap: 10 },
  // Italic, justified, stacked upward so its last line box ends 257.5 px below the box top.
  // 22.9 px reproduces the breaks on seven of eight printed verses (the print kerns the
  // italic, which this table cannot see); its 23 px pitch is tighter than the face's height.
  verse: { size: 22.9, pitch: 23, bottom: 257.5 },
  // Bold, right-aligned, fixed: cap tops 256 px below the box top (12 px above its bottom).
  reference: { size: 19, top: 253.5, pitch: 19 },
  // The light-to-dark gradient sits BETWEEN the ability and the verse: recent sets (Roots 2
  // onward) are fully dark by the first verse line, with the transition in the ~28 px above
  // it — not across the first row as Roots / IR printed. `minGap` is the room the ability
  // must leave above the verse (the tightest printed card leaves 22 px).
  gradient: { above: 2, span: 28 },
  minGap: 18,
} as const;
export const TEXT_WIDTH = RECTS.textInset.w;

export type Face = "bold" | "italic";
const FALLBACK_ADVANCE = 556;

export function textWidth(text: string, face: Face, size: number): number {
  const table = face === "bold" ? BOLD_ADVANCES : ITALIC_ADVANCES;
  let units = 0;
  for (const ch of text) units += table.get(ch) ?? FALLBACK_ADVANCE;
  return (units * size) / FONT_UPEM;
}

/** Break opportunities the browser takes with `white-space: pre-line`: at spaces and after a
 *  hyphen inside a word. Returns [token, joinedToPrevious]. */
function tokens(line: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  for (const word of line.split(/ +/).filter(Boolean)) {
    const parts = word.split(/(?<=-)(?=[^-])/);
    parts.forEach((p, i) => out.push([p, i > 0]));
  }
  return out;
}

/** Greedy word wrap of `text` at `width` px. Explicit newlines start a new line; runs of
 *  spaces collapse (the preview renders with `white-space: pre-line`). "" → []. */
export function wrapLines(text: string, face: Face, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const [tok, joined] of tokens(raw)) {
      const candidate = line ? (joined ? line + tok : `${line} ${tok}`) : tok;
      if (!line || textWidth(candidate, face, size) <= width) line = candidate;
      else { lines.push(line); line = tok; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Paragraphs of an ability: explicit newlines, plus the " / " that separates the halves of
 *  a dual-type ability ("GE: … / A: …") — printed cards set each half on its own lines. */
export function abilityParagraphs(text: string): string[] {
  return text
    .split(/\n+|\s*\/\s*(?=[A-Z]{1,3}:\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export type TextFit = {
  /** Wrapped ability lines, per paragraph. */
  paragraphs: string[][];
  abilityLines: number;
  verseLines: string[];
  /** Bottom of the last ability line box, offset from the box top. */
  abilityBottom: number;
  /** Top of the first verse line box (the verse floor when there is no verse). */
  verseTop: number;
  /** Ability lines that collide with the verse (or its `minGap`); 0 means it fits as printed. */
  over: number;
  /** Where the box wash stops being light and where it is fully dark, offsets from the box top. */
  gradient: { light: number; dark: number };
};

export function textFit(card: DesignCard): TextFit {
  const M = TEXT_METRICS;
  const paragraphs = abilityParagraphs(cardRawText(card)).map((p) => wrapLines(p, "bold", M.ability.size, TEXT_WIDTH));
  const abilityLines = paragraphs.reduce((n, p) => n + p.length, 0);
  const abilityBottom = M.ability.top + abilityLines * M.ability.pitch + Math.max(0, paragraphs.length - 1) * M.ability.paragraphGap;
  const verseLines = wrapLines((card.scripture ?? "").trim(), "italic", M.verse.size, TEXT_WIDTH);
  const verseTop = M.verse.bottom - verseLines.length * M.verse.pitch;
  const over = abilityLines ? Math.max(0, Math.ceil((abilityBottom + M.minGap - verseTop) / M.ability.pitch)) : 0;
  const dark = verseTop - M.gradient.above;
  return { paragraphs, abilityLines, verseLines, abilityBottom, verseTop, over, gradient: { light: dark - M.gradient.span, dark } };
}
