/**
 * Port of redemption-tournament-api/src/utilities/text_to_webp.py
 * (`make_webp` / `_generate_deck_image` / `_combine_deck_images` /
 * `_apply_legality_seal`), rendered with sharp instead of PIL.
 *
 * KNOWN DEVIATION (spec-mandated, see task-9 brief §Deviation): the Python
 * pastes each card image at its *native* size (sample-image-derived
 * card_width/card_height, defaulting to 315x441 only if the sample fails to
 * load) — every card in a given render shares one size because Lackey's
 * local `assets/cardimages` files are pre-normalized. Our Blob art is NOT
 * uniform (many ~344x512 but not guaranteed), so every fetched JPEG is
 * resized to a FIXED 345x495 cell with
 * `sharp(buf).resize(345, 495, { fit: "fill" })` before compositing —
 * un-resized overlays would overflow the canvas and make `composite()`
 * throw. This makes CARD_WIDTH/CARD_HEIGHT constants here instead of
 * per-render sample-derived values.
 *
 * Canvas math (transcribed from `_generate_deck_image`, per section):
 *   cardOverlap = floor(cardHeight * 0.10)              // 495*0.10 -> 49
 *   rows        = ceil(numCards / cardsPerRow)
 *   width       = cardWidth * cardsPerRow                // NO margin, ever
 *   height      = cardHeight*rows - cardOverlap*(rows-1)
 *
 * Combine math (transcribed from `_combine_deck_images`):
 *   - reserve exists:
 *       combinedWidth  = max(mainWidth, reserveWidth)     // NO margin
 *       combinedHeight = mainHeight + reserveHeight + LINE_HEIGHT(50) + PADDING(50)
 *       separator bar height = LINE_HEIGHT (50), text only if a count is given
 *       reserve pasted at y = mainHeight + LINE_HEIGHT + PADDING
 *   - no reserve, but a count value is given:
 *       enhancedLineHeight = LINE_HEIGHT * 2               // 100
 *       combinedWidth  = mainWidth
 *       combinedHeight = mainHeight + enhancedLineHeight
 *   - no reserve, no count value: combined = main deck image, unchanged size
 *   - seal (any branch): top-left, margin 20, sealSize = max(min(w,h)//12, 80)
 *     — composited within the already-sized canvas; it never grows it.
 * So width NEVER gets a margin added in the Python — only height does
 * (via LINE_HEIGHT/PADDING, or the doubled LINE_HEIGHT no-reserve case).
 *
 * "Print-and-skip" grid-position subtlety (from `_generate_deck_image`'s
 * per-card try/except): the x/y-offset advance is INSIDE the try block,
 * *after* the successful paste. So when a card image fails to load, the
 * position is NOT advanced — the next successfully-loaded card fills that
 * exact slot instead of leaving a gap, and the grid compacts. Trailing
 * cells (computed from the nominal card count, worst case) are left as
 * background. This is reproduced exactly below.
 */
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { sheetSort } from "./sheetSort";
import { renderSealPng } from "./seal";
import { renderSvgToPng } from "./svgText";
import type { ResolvedCard, ResolvedDeck } from "./types";

const CARD_WIDTH = 345;
const CARD_HEIGHT = 495;
const CARD_OVERLAP = Math.floor(CARD_HEIGHT * 0.1); // 49
const BACKGROUND = "#1e202b";
const SEPARATOR_COLOR = "#141621";
const LINE_HEIGHT = 50;
const PADDING = 50;
const SEAL_MARGIN = 20;

export interface GenerateDeckImageOptions {
  deckType: string;
  deck: ResolvedDeck;
  nCardColumns: number;
  mCountValue: number | null;
  aodCountValue: number | null;
  isLegal: boolean | null;
  /** Defaults to a Blob fetch via getCardImageUrl(). Tests inject a stub to stay network-free. */
  fetchImage?: (imgFile: string) => Promise<Buffer | null>;
}

/** Bounded-concurrency map, per the task-9 brief (no new deps). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function defaultFetchImage(imgFile: string): Promise<Buffer | null> {
  const url = getCardImageUrl(imgFile);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`Failed to fetch card image '${imgFile}': ${res.status} ${res.statusText}`);
    return null;
  }
  return Buffer.from(await res.arrayBuffer());
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Parity with Python: `"  |  ".join(["M Count: X", "AoD Count: Y"])`, either part optional. */
function buildCountText(mCountValue: number | null, aodCountValue: number | null): string | null {
  const parts: string[] = [];
  if (mCountValue !== null) parts.push(`M Count: ${mCountValue}`);
  if (aodCountValue !== null) parts.push(`AoD Count: ${aodCountValue}`);
  return parts.length > 0 ? parts.join("  |  ") : null;
}

function expandByQuantity(sorted: Array<[string, ResolvedCard]>): Array<[string, ResolvedCard]> {
  const out: Array<[string, ResolvedCard]> = [];
  for (const entry of sorted) {
    const [, card] = entry;
    for (let i = 0; i < card.quantity; i++) out.push(entry);
  }
  return out;
}

interface SectionImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Port of `_generate_deck_image`: one grid, one section (main or reserve), fixed 345x495 cells. */
async function buildSectionImage(
  deckMap: Map<string, ResolvedCard>,
  cardsPerRow: number,
  resized: Map<string, Buffer | null>
): Promise<SectionImage | null> {
  const expanded = expandByQuantity(sheetSort(deckMap));
  if (expanded.length === 0) return null;

  const rows = Math.ceil(expanded.length / cardsPerRow);
  const width = CARD_WIDTH * cardsPerRow;
  const height = CARD_HEIGHT * rows - CARD_OVERLAP * (rows - 1);

  const composites: OverlayOptions[] = [];
  let x = 0;
  let y = 0;
  for (const [name, card] of expanded) {
    const imgFile = card.imgFile;
    if (!imgFile) {
      console.warn(`Warning: No image file specified for card '${name}'`);
      continue; // no position advance — matches the Python's early `continue`
    }
    const img = resized.get(imgFile);
    if (!img) {
      console.warn(`Warning: Image for card '${name}' not found`);
      continue; // no position advance — the try/except only advances after a successful paste
    }
    composites.push({ input: img, left: x, top: y });
    x += CARD_WIDTH;
    if (x >= width) {
      x = 0;
      y += CARD_HEIGHT - CARD_OVERLAP;
    }
  }

  const buffer = await sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
    .composite(composites)
    .png()
    .toBuffer();

  return { buffer, width, height };
}

/** A background-filled bar with optional left-aligned white bold text, composited as one overlay. */
async function buildSeparatorStrip(
  width: number,
  height: number,
  text: string | null,
  fontSize: number
): Promise<Buffer> {
  const textEl = text
    ? `<text x="20" y="${height / 2}" dominant-baseline="central" text-anchor="start" font-family="DejaVu Sans" font-weight="bold" font-size="${fontSize}" fill="#ffffff">${escapeXml(text)}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${SEPARATOR_COLOR}" />${textEl}</svg>`;
  return renderSvgToPng(svg);
}

export async function generateDeckImage(opts: GenerateDeckImageOptions): Promise<Buffer> {
  const {
    deckType,
    deck,
    nCardColumns,
    mCountValue,
    aodCountValue,
    isLegal,
    fetchImage = defaultFetchImage,
  } = opts;

  const cardsPerRow = deckType === "type_2" ? 15 : nCardColumns;

  // Dedupe imgFiles across both sections so a card appearing in main and
  // reserve (or repeated by quantity) is only fetched once.
  const uniqueImgFiles = new Set<string>();
  for (const card of deck.main.values()) if (card.imgFile) uniqueImgFiles.add(card.imgFile);
  for (const card of deck.reserve.values()) if (card.imgFile) uniqueImgFiles.add(card.imgFile);
  const imgFileList = Array.from(uniqueImgFiles);

  const fetchedAndResized = await mapLimit(imgFileList, 8, async (imgFile) => {
    const raw = await fetchImage(imgFile);
    if (!raw) return null;
    try {
      return await sharp(raw).resize(CARD_WIDTH, CARD_HEIGHT, { fit: "fill" }).toBuffer();
    } catch (e) {
      console.warn(`Warning: failed to process image for '${imgFile}': ${e}`);
      return null;
    }
  });
  const resized = new Map<string, Buffer | null>();
  imgFileList.forEach((f, i) => resized.set(f, fetchedAndResized[i]));

  const mainImage = await buildSectionImage(deck.main, cardsPerRow, resized);
  if (!mainImage) {
    throw new Error("No cards found in 'main_deck' deck.");
  }
  const reserveImage = await buildSectionImage(deck.reserve, cardsPerRow, resized);

  const countText = buildCountText(mCountValue, aodCountValue);

  const overlays: OverlayOptions[] = [{ input: mainImage.buffer, left: 0, top: 0 }];
  let combinedWidth: number;
  let combinedHeight: number;

  if (!reserveImage) {
    if (countText !== null) {
      const enhancedLineHeight = LINE_HEIGHT * 2;
      combinedWidth = mainImage.width;
      combinedHeight = mainImage.height + enhancedLineHeight;
      const fontSize = Math.floor(enhancedLineHeight * 0.6);
      const strip = await buildSeparatorStrip(combinedWidth, enhancedLineHeight, countText, fontSize);
      overlays.push({ input: strip, left: 0, top: mainImage.height });
    } else {
      combinedWidth = mainImage.width;
      combinedHeight = mainImage.height;
    }
  } else {
    combinedWidth = Math.max(mainImage.width, reserveImage.width);
    combinedHeight = mainImage.height + reserveImage.height + LINE_HEIGHT + PADDING;
    const fontSize = Math.floor(LINE_HEIGHT * 2.1);
    const strip = await buildSeparatorStrip(combinedWidth, LINE_HEIGHT, countText, fontSize);
    overlays.push({ input: strip, left: 0, top: mainImage.height });
    overlays.push({ input: reserveImage.buffer, left: 0, top: mainImage.height + LINE_HEIGHT + PADDING });
  }

  if (isLegal !== null) {
    const sealSize = Math.max(Math.floor(Math.min(combinedWidth, combinedHeight) / 12), 80);
    const seal = await renderSealPng({ deckType, isLegal, sizePx: sealSize });
    overlays.push({ input: seal, left: SEAL_MARGIN, top: SEAL_MARGIN });
  }

  return sharp({ create: { width: combinedWidth, height: combinedHeight, channels: 3, background: BACKGROUND } })
    .composite(overlays)
    .webp({ quality: 80 })
    .toBuffer();
}
