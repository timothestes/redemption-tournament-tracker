/**
 * Server-side tier list renderer.
 *
 * Composites real card art into a shareable PNG with `sharp`, the same way
 * `lib/decksheets/deckImage.ts` builds deck check images — card art is fetched
 * from Blob and pasted into a fixed grid, and all text is rendered as SVG
 * through the bundled DejaVu font. Doing this on the server (rather than
 * html2canvas in the browser) sidesteps the cross-origin canvas tainting that
 * rasterizing Blob-hosted art client-side would run into.
 */

import path from "path";

import sharp, { type OverlayOptions } from "sharp";
import { findCard } from "@/lib/cards/lookup";
import { mapLimit, fetchCardImageBuffer } from "@/lib/decksheets/deckImage";
import { renderSvgToPng } from "@/lib/decksheets/svgText";

// Card cells are smaller than the deck sheet's 345x495 — a tier list is read at
// a glance — but keep that scan's exact aspect so art is never distorted.
const CARD_WIDTH = 150;
const CARD_HEIGHT = 215;
const GAP = 8;
const PAD = 12;
const LABEL_WIDTH = 132;
/** Wider than GAP on purpose, so the label reads as its own column. */
const LABEL_GUTTER = 18;
const MIN_ROW_HEIGHT = CARD_HEIGHT + PAD * 2;
/** An empty tier still says something, but it doesn't need a card's height to say it. */
const EMPTY_ROW_HEIGHT = 88;
const MAX_COLUMNS = 10;
const MIN_COLUMNS = 3;
/** height/width ceiling — past this the export reads as a skinny column. */
const MAX_ASPECT = 1.6;
const TITLE_HEIGHT = 92;
const FOOTER_HEIGHT = 56;
/** Rendered height of the wordmark in the footer; width follows its aspect. */
const LOGO_HEIGHT = 32;

const MAX_LABEL_SIZE = 56;
const MIN_LABEL_SIZE = 15;
const MAX_TITLE_SIZE = 40;
const MIN_TITLE_SIZE = 18;
/** DejaVu Sans Bold averages ~0.60em per glyph. */
const GLYPH_RATIO = 0.6;

const BACKGROUND = "#15161d";
const ROW_BACKGROUND = "#242739";
const DIVIDER = "#0f1017";
const LABEL_TEXT = "#14161f";
const TITLE_TEXT = "#ffffff";
const FOOTER_TEXT = "#a3a9c0";
const FALLBACK_COLOR = "#4a4d5e";

export interface TierListImageRow {
  label: string;
  /** `#rrggbb`; anything else falls back to a neutral so client input can't inject SVG. */
  color: string;
  cards: Array<{ name: string; set: string }>;
}

export interface GenerateTierListImageOptions {
  title?: string | null;
  rows: TierListImageRow[];
  /** Defaults to the Blob fetch. Tests inject a stub to stay network-free. */
  fetchImage?: (imgFile: string) => Promise<Buffer | null>;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function safeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : FALLBACK_COLOR;
}

export function canvasWidth(columns: number): number {
  return LABEL_WIDTH + LABEL_GUTTER + columns * (CARD_WIDTH + GAP) - GAP + PAD;
}

export function rowHeight(cardCount: number, columns: number): number {
  if (cardCount === 0) return EMPTY_ROW_HEIGHT;
  const lines = Math.ceil(cardCount / columns);
  return Math.max(MIN_ROW_HEIGHT, lines * (CARD_HEIGHT + GAP) - GAP + PAD * 2);
}

export function canvasHeight(
  rows: Array<{ cards: unknown[] }>,
  columns: number,
  hasTitle: boolean,
): number {
  const body = rows.reduce((h, r) => h + rowHeight(r.cards.length, columns), 0);
  return (hasTitle ? TITLE_HEIGHT : 0) + body + FOOTER_HEIGHT;
}

/**
 * Columns are driven by the fullest row, then widened until the canvas stops
 * being taller than `MAX_ASPECT`. Both halves matter: without the first, a
 * sparse board renders acres of empty grid; without the second, a board of
 * mostly-empty rows renders as a tall skinny column. Widening never changes a
 * row's height unless that row was already wrapping, so the loop only ever
 * moves the aspect in one direction.
 */
export function columnCount(rows: Array<{ cards: unknown[] }>, hasTitle = false): number {
  const fullest = rows.reduce((max, r) => Math.max(max, r.cards.length), 0);
  let columns = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, fullest));
  while (
    columns < MAX_COLUMNS &&
    canvasHeight(rows, columns, hasTitle) / canvasWidth(columns) > MAX_ASPECT
  ) {
    columns += 1;
  }
  return columns;
}

/**
 * Split a custom label across two lines at its most central space, so
 * "Never Playable" doesn't have to shrink to fit the label column on one line.
 * Short labels (the S/A/B ramp) and single words are never split.
 */
export function labelLines(label: string): string[] {
  const text = label.trim();
  if (text.length <= 3 || !text.includes(" ")) return [text];
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") continue;
    if (best < 0 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2)) best = i;
  }
  return best < 0 ? [text] : [text.slice(0, best), text.slice(best + 1)];
}

export function labelFontSize(lines: string[]): number {
  const longest = Math.max(...lines.map((l) => l.length), 1);
  if (lines.length === 1 && longest <= 2) return MAX_LABEL_SIZE;
  return Math.max(
    MIN_LABEL_SIZE,
    Math.min(MAX_LABEL_SIZE, Math.floor((LABEL_WIDTH - 20) / (GLYPH_RATIO * longest))),
  );
}

/**
 * Titles are free text, so they get shrunk to fit and then hard-truncated —
 * an SVG `<text>` has no wrapping and would otherwise run straight off the canvas.
 */
export function fitTitle(title: string, width: number): { text: string; fontSize: number } {
  const available = width - PAD * 4;
  const fontSize = Math.max(
    MIN_TITLE_SIZE,
    Math.min(MAX_TITLE_SIZE, Math.floor(available / (GLYPH_RATIO * Math.max(title.length, 1)))),
  );
  const maxChars = Math.floor(available / (GLYPH_RATIO * fontSize));
  const text =
    title.length > maxChars ? `${title.slice(0, Math.max(maxChars - 1, 1)).trimEnd()}…` : title;
  return { text, fontSize };
}

async function buildRowChrome(
  width: number,
  height: number,
  label: string,
  color: string,
): Promise<Buffer> {
  const lines = labelLines(label);
  const fontSize = labelFontSize(lines);
  const text = lines
    .map((line, i) => {
      const y = height / 2 + (i - (lines.length - 1) / 2) * fontSize * 1.16;
      return `<text x="${LABEL_WIDTH / 2}" y="${y}" dominant-baseline="central" text-anchor="middle"`
        + ` font-family="DejaVu Sans" font-weight="bold" font-size="${fontSize}" fill="${LABEL_TEXT}">${escapeXml(line)}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="${ROW_BACKGROUND}" />`
    + `<rect width="${LABEL_WIDTH}" height="${height}" fill="${safeColor(color)}" />`
    + text
    + `<rect x="0" y="${height - 2}" width="${width}" height="2" fill="${DIVIDER}" />`
    + `</svg>`;
  return renderSvgToPng(svg);
}

async function buildTitleBar(width: number, title: string): Promise<Buffer> {
  const { text, fontSize } = fitTitle(title, width);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${TITLE_HEIGHT}">`
    + `<rect width="${width}" height="${TITLE_HEIGHT}" fill="${BACKGROUND}" />`
    + `<text x="${width / 2}" y="${TITLE_HEIGHT / 2}" dominant-baseline="central" text-anchor="middle"`
    + ` font-family="DejaVu Sans" font-weight="bold" font-size="${fontSize}" fill="${TITLE_TEXT}">${escapeXml(text)}</text>`
    + `</svg>`;
  return renderSvgToPng(svg);
}

async function buildFooterPlate(width: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${FOOTER_HEIGHT}">`
    + `<rect width="${width}" height="${FOOTER_HEIGHT}" fill="${BACKGROUND}" />`
    + `</svg>`;
  return renderSvgToPng(svg);
}

/**
 * The app wordmark for the footer. The dark-mode asset is the right one — the
 * footer plate is near-black — and it carries an alpha channel, so it composites
 * straight onto the plate. Returns null if the file can't be read (a tracing
 * miss in a future deploy), and the caller falls back to plain text so an
 * export never loses its attribution.
 */
async function buildFooterLogo(): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  try {
    const file = path.join(process.cwd(), "public", "darkmode_redemptionccgapp.webp");
    const buffer = await sharp(file).resize({ height: LOGO_HEIGHT }).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    return { buffer, width: meta.width, height: meta.height };
  } catch {
    console.warn("tier list: footer wordmark unavailable, falling back to text");
    return null;
  }
}

async function buildFooterText(width: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${FOOTER_HEIGHT}">`
    + `<text x="${width - PAD}" y="${FOOTER_HEIGHT / 2}" dominant-baseline="central" text-anchor="end"`
    + ` font-family="DejaVu Sans" font-size="20" fill="${FOOTER_TEXT}">RedemptionCCG.app</text>`
    + `</svg>`;
  return renderSvgToPng(svg);
}

/**
 * Renders the tier list to PNG bytes.
 *
 * Cards whose art can't be resolved or fetched are dropped from the layout
 * before positions are computed, so a missing image never leaves a hole or
 * shifts the rest of the row.
 */
export async function generateTierListImage(
  opts: GenerateTierListImageOptions,
): Promise<Uint8Array> {
  const fetchImage = opts.fetchImage ?? fetchCardImageBuffer;
  const title = opts.title?.trim() || null;

  // Resolve every distinct card once — the same card can't appear twice on a
  // board, but a stray duplicate in a hand-built payload shouldn't double-fetch.
  const wanted = new Map<string, string>(); // `name|set` -> imgFile
  for (const row of opts.rows) {
    for (const c of row.cards) {
      const key = `${c.name}|${c.set}`;
      if (wanted.has(key)) continue;
      const card = findCard(c.name, c.set);
      if (card?.imgFile) wanted.set(key, card.imgFile);
    }
  }

  const keys = [...wanted.keys()];
  const fetched = await mapLimit(keys, 8, async (key) => {
    // One unreachable image costs that card its slot, never the whole export.
    try {
      const buf = await fetchImage(wanted.get(key)!);
      if (!buf) return null;
      return await sharp(buf).resize(CARD_WIDTH, CARD_HEIGHT, { fit: "fill" }).toBuffer();
    } catch {
      console.warn(`tier list: could not render art for '${key}'`);
      return null;
    }
  });
  const art = new Map<string, Buffer>();
  keys.forEach((key, i) => {
    const buf = fetched[i];
    if (buf) art.set(key, buf);
  });

  // Drop unrenderable cards up front so the grid math sees only what will paste.
  const rows = opts.rows.map((row) => ({
    label: row.label,
    color: row.color,
    cards: row.cards.filter((c) => art.has(`${c.name}|${c.set}`)),
  }));

  const columns = columnCount(rows, title !== null);
  const width = canvasWidth(columns);
  const heights = rows.map((r) => rowHeight(r.cards.length, columns));
  const height = canvasHeight(rows, columns, title !== null);

  const composites: OverlayOptions[] = [];
  let y = 0;

  if (title) {
    composites.push({ input: await buildTitleBar(width, title), left: 0, top: 0 });
    y += TITLE_HEIGHT;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowH = heights[i];
    composites.push({ input: await buildRowChrome(width, rowH, row.label, row.color), left: 0, top: y });

    row.cards.forEach((card, idx) => {
      const col = idx % columns;
      const line = Math.floor(idx / columns);
      composites.push({
        input: art.get(`${card.name}|${card.set}`)!,
        left: LABEL_WIDTH + LABEL_GUTTER + col * (CARD_WIDTH + GAP),
        top: y + PAD + line * (CARD_HEIGHT + GAP),
      });
    });

    y += rowH;
  }

  composites.push({ input: await buildFooterPlate(width), left: 0, top: y });
  const logo = await buildFooterLogo();
  if (logo) {
    composites.push({
      input: logo.buffer,
      left: width - PAD - logo.width,
      top: y + Math.round((FOOTER_HEIGHT - logo.height) / 2),
    });
  } else {
    composites.push({ input: await buildFooterText(width), left: 0, top: y });
  }

  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
      .composite(composites)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
}
