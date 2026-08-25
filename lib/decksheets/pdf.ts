/**
 * Port of redemption-tournament-api/src/utilities/text_to_pdf.py's `make_pdf`
 * (797 lines), rendered with pdf-lib instead of reportlab/PyPDF2. pdf-lib and
 * reportlab share the same bottom-left-origin point space, so every
 * coordinate below is transcribed 1:1 from the Python — do NOT re-measure or
 * round anything.
 *
 * Font-state note: reportlab's `canvas.Canvas` keeps a *current* font across
 * `drawString` calls, defaulting to Helvetica 12 (`rl_config.canvas_basefontname`,
 * `_initialFontSize = 12`) until `setFont` is called. `place_section` (the
 * card-listing loop, used for every main-deck section AND the reserve list)
 * never calls `setFont` itself, so those lines render in that *default*
 * Helvetica 12 — never explicitly set in the Python source. pdf-lib has no
 * such canvas state; MAIN_TEXT_FONT_SIZE below reproduces that default
 * explicitly on every `drawText` call in `placeSection`.
 */
import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { cleanCardName } from "./cleanCardName";
import { formatCountValue } from "./deckImage";
import { renderSealPng } from "./seal";
import { sheetSort } from "./sheetSort";
import type { ResolvedCard, ResolvedDeck } from "./types";

const T1_TEMPLATE_PATH = path.join(process.cwd(), "assets", "decksheets", "t1_deck_check_v2.pdf");
const T2_TEMPLATE_PATH = path.join(process.cwd(), "assets", "decksheets", "t2_deck_check_v2.pdf");

// text_to_pdf.py:21-34 — cards whose type is NOT in this list count as "misc".
const NON_MISC_TYPES: readonly string[] = [
  "Dominant",
  "Hero",
  "GE",
  "Lost Soul",
  "Evil Character",
  "EE",
  "Artifact",
  "Fortress",
  "Site",
  "Curse",
  "Covenant",
  "City",
];

interface SectionCoord {
  x: number;
  y: number;
}
type SectionKey =
  | "Dominant"
  | "Hero"
  | "GE"
  | "Lost Soul"
  | "Evil Character"
  | "EE"
  | "Artifact"
  | "Fortress"
  | "Misc"
  | "Reserve";
interface SectionMapping {
  lists: Record<SectionKey, SectionCoord>;
  numbers: Record<SectionKey, SectionCoord>;
}

// text_to_pdf.py:418-443. On the v2 T1 sheet the Dominant/Lost Soul rows and
// the whole third column sit exactly where they did on v1, so only the Hero,
// Evil Character and Enhancement blocks move up.
const T1_SECTION_MAPPINGS: SectionMapping = {
  lists: {
    Dominant: { x: 57, y: 180 },
    Hero: { x: 57, y: 350 },
    GE: { x: 57, y: 766 },
    "Lost Soul": { x: 310, y: 180 },
    "Evil Character": { x: 310, y: 349 },
    EE: { x: 310, y: 766 },
    Artifact: { x: 560, y: 181 },
    Fortress: { x: 560, y: 474 },
    Misc: { x: 560, y: 700 },
    Reserve: { x: 580, y: 913 },
  },
  numbers: {
    Dominant: { x: 124, y: 153 },
    Hero: { x: 97, y: 335 },
    GE: { x: 189, y: 748 },
    "Lost Soul": { x: 381, y: 154 },
    "Evil Character": { x: 408, y: 335 },
    EE: { x: 439, y: 748 },
    Artifact: { x: 741, y: 153 },
    Fortress: { x: 710, y: 454 },
    Misc: { x: 596, y: 687 },
    Reserve: { x: 617, y: 875 },
  },
};

// text_to_pdf.py:444-472. The whole v2 T2 sheet is inset 5pt further right
// than v1, and every row moved, so both x and y differ from the v1 mapping
// throughout.
const T2_SECTION_MAPPINGS: SectionMapping = {
  lists: {
    Dominant: { x: 62, y: 186 },
    Hero: { x: 62, y: 519 },
    GE: { x: 62, y: 885 },
    "Lost Soul": { x: 315, y: 186 },
    "Evil Character": { x: 315, y: 520 },
    EE: { x: 315, y: 885 },
    Artifact: { x: 565, y: 186 },
    Fortress: { x: 565, y: 432 },
    Misc: { x: 565, y: 629 },
    Reserve: { x: 585, y: 753 },
  },
  numbers: {
    Dominant: { x: 129, y: 158 },
    Hero: { x: 101, y: 501 },
    GE: { x: 193, y: 873 },
    "Lost Soul": { x: 385, y: 158 },
    "Evil Character": { x: 413, y: 500 },
    EE: { x: 440, y: 874 },
    Artifact: { x: 749, y: 159 },
    Fortress: { x: 715, y: 411 },
    Misc: { x: 601, y: 615 },
    Reserve: { x: 617, y: 731 },
  },
};

// text_to_pdf.py:48-58/60-70 — number of ruled writing lines each section has
// on the v2 templates (unique-card counts, not printed-line counts: reserve
// entries print one line per copy and are governed separately below).
type SectionLimitKey = Exclude<SectionKey, "Reserve">;
const T1_SECTION_LIMITS: Record<SectionLimitKey, number> = {
  Dominant: 9,
  Hero: 24,
  GE: 21,
  "Lost Soul": 9,
  "Evil Character": 24,
  EE: 21,
  Artifact: 16, // Combined: Artifact, Covenant, Curse
  Fortress: 13, // Combined: Fortress, Site, City
  Misc: 10,
};
const T2_SECTION_LIMITS: Record<SectionLimitKey, number> = {
  Dominant: 19,
  Hero: 21,
  GE: 13,
  "Lost Soul": 19,
  "Evil Character": 21,
  EE: 13,
  Artifact: 13, // Combined: Artifact, Covenant, Curse
  Fortress: 11, // Combined: Fortress, Site, City
  Misc: 6,
};

// text_to_pdf.py:72-75 — the v2 T2 template's Reserve box has exactly 20
// numbered lines, matching T2's reserve cap of 20, so a legal reserve always
// fits on the sheet. The split is kept as a guard only.
const T2_RESERVE_LINE_LIMIT = 20;

// text_to_pdf.py:220 (place_section_by_type) — line advance for every main
// section AND the reserve list.
const LINE_SPACING = 16;

// text_to_pdf.py:150-160 — alignment text colors; text_to_pdf.py:174-175
// resets to black after every colored entry, and canvas text is black by
// default otherwise.
const GOOD_COLOR = rgb(0, 0.5, 0);
const EVIL_COLOR = rgb(0.8, 0, 0);
const NEUTRAL_COLOR = rgb(0.3, 0.3, 0.3);
const BLACK = rgb(0, 0, 0);

// text_to_pdf.py's reportlab canvas default (see file-header note above).
const MAIN_TEXT_FONT_SIZE = 12;

// text_to_pdf.py:474-477 — the v2 T2 sheet places its entire top header
// block (Name, Event, Total Cards) 5pt right and 5pt lower than the v2 T1
// sheet; the fill-in offsets are measured against T1, so T2 gets nudged.
function headerNudge(deckType: string): { dx: number; dy: number } {
  return deckType === "type_2" ? { dx: 5, dy: 5 } : { dx: 0, dy: 0 };
}

// text_to_pdf.py's repeated `box_width = 50; box_height = 30` fill-in math
// (total count, M/AoD count, alignment counts, name, event).
const FIELD_BOX_WIDTH = 50;
const FIELD_BOX_HEIGHT = 30;
function fieldPosition(
  widthPoints: number,
  heightPoints: number,
  rightMargin: number,
  topMargin: number,
  dx: number,
  dy: number
): { x: number; y: number } {
  return {
    x: widthPoints - rightMargin - FIELD_BOX_WIDTH + 5 + dx,
    y: heightPoints - topMargin - FIELD_BOX_HEIGHT + 10 - dy,
  };
}

// text_to_pdf.py:746-754 — seal drawn at 65pt, centered (with a 40pt left
// nudge) near the top of the page. `generate_seal`'s default raster size
// (seal.py: `size: int = 200`) is what text_to_pdf.py's unparented call
// rasterizes before reportlab scales it down to 65x65pt.
const SEAL_SIZE_PT = 65;
const SEAL_RASTER_PX = 200;

// text_to_pdf.py:276-282 — overflow page layout (2 columns).
const OVERFLOW_MARGIN_X = 50;
const OVERFLOW_MARGIN_Y = 50;
const OVERFLOW_COL_GAP = 20;
const OVERFLOW_LINE_SPACING = 14;
const OVERFLOW_SECTION_GAP = 10;
const OVERFLOW_HEADER_H = 18;

export interface GenerateDeckCheckPdfOptions {
  deckType: string;
  deck: ResolvedDeck;
  name: string;
  event: string;
  showAlignment: boolean;
  mCountValue: number | null;
  aodCountValue: number | null;
  isLegal: boolean | null;
}

/**
 * WinAnsi sanitizer (spec §4/§4.1(5)): the standard-14 fonts throw on any
 * character outside WinAnsiEncoding. Applied to EVERY drawn string.
 */
function sanitizeWinAnsi(font: PDFFont, text: string): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return Array.from(text)
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return "?";
        }
      })
      .join("");
  }
}

type CardTypeSpec = string | string[];

/** Port of filter_section (text_to_pdf.py:110-119). */
function filterSection(deck: Map<string, ResolvedCard>, cardTypes: CardTypeSpec): Map<string, ResolvedCard> {
  const out = new Map<string, ResolvedCard>();
  if (cardTypes === "misc") {
    for (const [name, card] of deck) if (!NON_MISC_TYPES.includes(card.type)) out.set(name, card);
  } else if (cardTypes === "all") {
    return new Map(deck);
  } else if (typeof cardTypes === "string") {
    for (const [name, card] of deck) if (card.type === cardTypes) out.set(name, card);
  } else {
    for (const [name, card] of deck) if (cardTypes.includes(card.type)) out.set(name, card);
  }
  return out;
}

function alignmentColor(alignment: string | null | undefined) {
  const a = alignment ?? "Neutral";
  if (a === "Good") return GOOD_COLOR;
  if (a === "Evil") return EVIL_COLOR;
  if (a === "Neutral") return NEUTRAL_COLOR;
  return BLACK;
}

/**
 * Port of place_section (text_to_pdf.py:122-177): draws sorted entries at
 * (x, y) going down by lineSpacing per line, capping at maxItems UNIQUE
 * cards (returning the rest as overflow), and either one line per unique
 * card ("NxName", addQuantity) or one line per copy (addQuantity=false).
 */
function placeSection(
  page: PDFPage,
  font: PDFFont,
  sectionData: Map<string, ResolvedCard>,
  x: number,
  yStart: number,
  lineSpacing: number,
  addQuantity: boolean,
  colorAlignment: boolean,
  maxItems: number | null
): Map<string, ResolvedCard> {
  const sortedItems = sheetSort(sectionData);

  let visible = sortedItems;
  let overflowItems = new Map<string, ResolvedCard>();
  if (maxItems !== null && sortedItems.length > maxItems) {
    overflowItems = new Map(sortedItems.slice(maxItems));
    visible = sortedItems.slice(0, maxItems);
  }

  let y = yStart;
  for (const [cardName, card] of visible) {
    const displayName = cleanCardName(cardName, card);
    const color = colorAlignment ? alignmentColor(card.alignment) : BLACK;

    if (addQuantity) {
      const text = sanitizeWinAnsi(font, `${card.quantity}x ${displayName}`);
      page.drawText(text, { x, y, size: MAIN_TEXT_FONT_SIZE, font, color });
      y -= lineSpacing;
    } else {
      const text = sanitizeWinAnsi(font, displayName);
      for (let i = 0; i < card.quantity; i++) {
        page.drawText(text, { x, y, size: MAIN_TEXT_FONT_SIZE, font, color });
        y -= lineSpacing;
      }
    }
  }

  return overflowItems;
}

/** Port of place_section_by_type (text_to_pdf.py:203-232). */
function placeSectionByType(
  page: PDFPage,
  font: PDFFont,
  deck: Map<string, ResolvedCard>,
  heightPoints: number,
  cardTypes: CardTypeSpec,
  x: number,
  yTemplate: number,
  addQuantity: boolean,
  colorAlignment: boolean,
  maxItems: number | null
): Map<string, ResolvedCard> {
  const y = heightPoints - yTemplate;
  const filtered = filterSection(deck, cardTypes);
  return placeSection(page, font, filtered, x, y, LINE_SPACING, addQuantity, colorAlignment, maxItems);
}

/** Port of draw_count (text_to_pdf.py:235-264). Always Helvetica 12 (the caller never overrides it). */
function drawCount(
  page: PDFPage,
  font: PDFFont,
  cards: Map<string, ResolvedCard>,
  heightPoints: number,
  cardTypes: CardTypeSpec,
  x: number,
  yTemplate: number
): void {
  const y = heightPoints - yTemplate;
  let total = 0;
  for (const card of cards.values()) {
    if (cardTypes === "misc") {
      if (!NON_MISC_TYPES.includes(card.type)) total += card.quantity;
    } else if (card.type === cardTypes || cardTypes.includes(card.type)) {
      total += card.quantity;
    } else if (cardTypes === "all") {
      total += card.quantity;
    }
  }
  page.drawText(sanitizeWinAnsi(font, String(total)), { x, y, size: 12, font, color: BLACK });
}

/** Port of split_reserve_by_line_count (text_to_pdf.py:180-200). */
function splitReserveByLineCount(
  reserve: Map<string, ResolvedCard>,
  maxLines: number
): [Map<string, ResolvedCard>, Map<string, ResolvedCard>] {
  const sortedItems = sheetSort(reserve);
  const visible = new Map<string, ResolvedCard>();
  const overflow = new Map<string, ResolvedCard>();
  let linesUsed = 0;
  for (const [cardName, card] of sortedItems) {
    if (overflow.size === 0 && linesUsed + card.quantity <= maxLines) {
      visible.set(cardName, card);
      linesUsed += card.quantity;
    } else {
      overflow.set(cardName, card);
    }
  }
  return [visible, overflow];
}

/**
 * Port of draw_overflow_page (text_to_pdf.py:267-352): a plain 2-column
 * overflow page. The Python drives one reportlab canvas across pages with
 * `c.showPage()`; pdf-lib pages are discrete objects, so `currentPage` here
 * tracks whichever page is currently being drawn on, reassigned by
 * `advance()` exactly where the Python calls `c.showPage()`.
 */
function drawOverflowPage(
  doc: PDFDocument,
  firstPage: PDFPage,
  overflowSections: Array<[string, Map<string, ResolvedCard>]>,
  widthPoints: number,
  heightPoints: number,
  name: string,
  event: string,
  regularFont: PDFFont,
  boldFont: PDFFont
): void {
  const colWidth = (widthPoints - 2 * OVERFLOW_MARGIN_X - OVERFLOW_COL_GAP) / 2;
  const bottomLimit = OVERFLOW_MARGIN_Y;
  const contentTop = heightPoints - OVERFLOW_MARGIN_Y - 26;

  let headerText = "OVERFLOW";
  if (name) headerText += `  —  ${name}`;
  if (event) headerText += `  |  ${event}`;

  let currentPage = firstPage;

  function drawPageHeader() {
    currentPage.drawText(sanitizeWinAnsi(boldFont, headerText), {
      x: OVERFLOW_MARGIN_X,
      y: heightPoints - OVERFLOW_MARGIN_Y,
      size: 14,
      font: boldFont,
      color: BLACK,
    });
    currentPage.drawLine({
      start: { x: OVERFLOW_MARGIN_X, y: heightPoints - OVERFLOW_MARGIN_Y - 5 },
      end: { x: widthPoints - OVERFLOW_MARGIN_X, y: heightPoints - OVERFLOW_MARGIN_Y - 5 },
      thickness: 1,
      color: BLACK,
    });
  }

  drawPageHeader();

  let col = 0;
  let x = OVERFLOW_MARGIN_X;
  let y = contentTop;

  function advance() {
    if (col === 0) {
      col = 1;
      x = OVERFLOW_MARGIN_X + colWidth + OVERFLOW_COL_GAP;
      y = contentTop;
    } else {
      currentPage = doc.addPage([widthPoints, heightPoints]);
      drawPageHeader();
      col = 0;
      x = OVERFLOW_MARGIN_X;
      y = contentTop;
    }
  }

  for (const [label, items] of overflowSections) {
    if (items.size === 0) continue;

    // Ensure room for at least the section header + one card line.
    if (y - OVERFLOW_HEADER_H - OVERFLOW_LINE_SPACING < bottomLimit) advance();

    currentPage.drawText(sanitizeWinAnsi(boldFont, label.toUpperCase()), {
      x,
      y,
      size: 10,
      font: boldFont,
      color: BLACK,
    });
    y -= OVERFLOW_HEADER_H;

    for (const [cardName, card] of items) {
      if (y - OVERFLOW_LINE_SPACING < bottomLimit) {
        advance();
        currentPage.drawText(sanitizeWinAnsi(boldFont, `${label.toUpperCase()} (cont.)`), {
          x,
          y,
          size: 10,
          font: boldFont,
          color: BLACK,
        });
        y -= OVERFLOW_HEADER_H;
      }

      const displayName = cleanCardName(cardName, card);
      const text = sanitizeWinAnsi(regularFont, `${card.quantity}x ${displayName}`);
      currentPage.drawText(text, { x: x + 8, y, size: 9, font: regularFont, color: BLACK });
      y -= OVERFLOW_LINE_SPACING;
    }

    y -= OVERFLOW_SECTION_GAP;
  }
}

export async function generateDeckCheckPdf(opts: GenerateDeckCheckPdfOptions): Promise<Uint8Array> {
  const { deckType, deck, name, event, showAlignment, mCountValue, aodCountValue, isLegal } = opts;

  const templatePath = deckType === "type_2" ? T2_TEMPLATE_PATH : T1_TEMPLATE_PATH;
  const templateBytes = fs.readFileSync(templatePath);
  const doc = await PDFDocument.load(templateBytes);
  const page = doc.getPage(0);
  const { width: widthPoints, height: heightPoints } = page.getSize();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);

  const mapping = deckType === "type_2" ? T2_SECTION_MAPPINGS : T1_SECTION_MAPPINGS;
  const limits = deckType === "type_2" ? T2_SECTION_LIMITS : T1_SECTION_LIMITS;
  const { dx: headerDx, dy: headerDy } = headerNudge(deckType);

  const overflowSections: Array<[string, Map<string, ResolvedCard>]> = [];

  function drawSection(label: SectionLimitKey, cardTypes: CardTypeSpec, sectionKey: SectionKey) {
    const coord = mapping.lists[sectionKey];
    const overflow = placeSectionByType(
      page,
      helvetica,
      deck.main,
      heightPoints,
      cardTypes,
      coord.x,
      coord.y,
      true,
      showAlignment,
      limits[label]
    );
    if (overflow.size > 0) overflowSections.push([label, overflow]);
  }

  drawSection("Dominant", "Dominant", "Dominant");
  drawSection("Hero", "Hero", "Hero");
  drawSection("GE", "GE", "GE");
  drawSection("Lost Soul", "Lost Soul", "Lost Soul");
  drawSection("Evil Character", "Evil Character", "Evil Character");
  drawSection("EE", "EE", "EE");
  drawSection("Artifact", ["Artifact", "Covenant", "Curse"], "Artifact");
  drawSection("Fortress", ["Fortress", "Site", "City"], "Fortress");
  drawSection("Misc", "misc", "Misc");

  // Reserve has no printed limit for type_1/paragon (10 always fits the
  // template box), but T2's reserve cap of 20 exceeds what the template's
  // Reserve box can print, so its overflow routes to the OVERFLOW page.
  let reserveToDraw = deck.reserve;
  if (deckType === "type_2") {
    const [visible, reserveOverflow] = splitReserveByLineCount(deck.reserve, T2_RESERVE_LINE_LIMIT);
    reserveToDraw = visible;
    if (reserveOverflow.size > 0) overflowSections.push(["Reserve", reserveOverflow]);
  }

  placeSectionByType(
    page,
    helvetica,
    reserveToDraw,
    heightPoints,
    "all",
    mapping.lists.Reserve.x,
    mapping.lists.Reserve.y,
    false,
    showAlignment,
    null
  );

  // Section counts (numbers only; positions are fully controlled).
  drawCount(page, helvetica, deck.main, heightPoints, "Dominant", mapping.numbers.Dominant.x, mapping.numbers.Dominant.y);
  drawCount(page, helvetica, deck.main, heightPoints, "Hero", mapping.numbers.Hero.x, mapping.numbers.Hero.y);
  drawCount(page, helvetica, deck.main, heightPoints, "GE", mapping.numbers.GE.x, mapping.numbers.GE.y);
  drawCount(page, helvetica, deck.main, heightPoints, "Lost Soul", mapping.numbers["Lost Soul"].x, mapping.numbers["Lost Soul"].y);
  drawCount(
    page,
    helvetica,
    deck.main,
    heightPoints,
    "Evil Character",
    mapping.numbers["Evil Character"].x,
    mapping.numbers["Evil Character"].y
  );
  drawCount(page, helvetica, deck.main, heightPoints, "EE", mapping.numbers.EE.x, mapping.numbers.EE.y);
  drawCount(
    page,
    helvetica,
    deck.main,
    heightPoints,
    ["Artifact", "Covenant", "Curse"],
    mapping.numbers.Artifact.x,
    mapping.numbers.Artifact.y
  );
  drawCount(
    page,
    helvetica,
    deck.main,
    heightPoints,
    ["Fortress", "Site", "City"],
    mapping.numbers.Fortress.x,
    mapping.numbers.Fortress.y
  );
  drawCount(page, helvetica, deck.main, heightPoints, "misc", mapping.numbers.Misc.x, mapping.numbers.Misc.y);
  // Reserve count reflects the FULL reserve (including anything routed to
  // overflow), not just what fit on the sheet.
  drawCount(page, helvetica, deck.reserve, heightPoints, "all", mapping.numbers.Reserve.x, mapping.numbers.Reserve.y);

  // Total card count, top right.
  {
    const { x, y } = fieldPosition(widthPoints, heightPoints, 41, 97, headerDx, headerDy);
    page.drawText(sanitizeWinAnsi(helveticaBold, String(deck.mainSize)), {
      x,
      y,
      size: 18,
      font: helveticaBold,
      color: BLACK,
    });
  }

  if (mCountValue !== null) {
    const { x, y } = fieldPosition(widthPoints, heightPoints, 85, 14, headerDx, headerDy);
    page.drawText(sanitizeWinAnsi(helvetica, `M Count: ${formatCountValue(mCountValue)}`), {
      x,
      y,
      size: 12,
      font: helvetica,
      color: BLACK,
    });
  }

  if (aodCountValue !== null) {
    const { x, y } = fieldPosition(widthPoints, heightPoints, 85, 4, headerDx, headerDy);
    page.drawText(sanitizeWinAnsi(helvetica, `AoD Count: ${formatCountValue(aodCountValue)}`), {
      x,
      y,
      size: 12,
      font: helvetica,
      color: BLACK,
    });
  }

  if (showAlignment) {
    let totalGood = 0;
    let totalEvil = 0;
    let totalNeutral = 0;
    for (const card of deck.main.values()) {
      if (card.alignment === "Good") totalGood += card.quantity;
      else if (card.alignment === "Evil") totalEvil += card.quantity;
      else if (card.alignment === "Neutral") totalNeutral += card.quantity;
    }

    {
      const { x, y } = fieldPosition(widthPoints, heightPoints, 85, 34, headerDx, headerDy);
      page.drawText(sanitizeWinAnsi(helvetica, `Good Count: ${totalGood}`), {
        x,
        y,
        size: 10,
        font: helvetica,
        color: GOOD_COLOR,
      });
    }
    {
      const { x, y } = fieldPosition(widthPoints, heightPoints, 85, 44, headerDx, headerDy);
      page.drawText(sanitizeWinAnsi(helvetica, `Evil Count: ${totalEvil}`), {
        x,
        y,
        size: 10,
        font: helvetica,
        color: EVIL_COLOR,
      });
    }
    {
      const { x, y } = fieldPosition(widthPoints, heightPoints, 85, 54, headerDx, headerDy);
      page.drawText(sanitizeWinAnsi(helvetica, `Neutral Count: ${totalNeutral}`), {
        x,
        y,
        size: 10,
        font: helvetica,
        color: NEUTRAL_COLOR,
      });
    }
  }

  // Player name.
  {
    const { x, y } = fieldPosition(widthPoints, heightPoints, 290, 16, headerDx, headerDy);
    page.drawText(sanitizeWinAnsi(timesRoman, name), { x, y, size: 24, font: timesRoman, color: BLACK });
  }

  // Event name.
  {
    const { x, y } = fieldPosition(widthPoints, heightPoints, 290, 56, headerDx, headerDy);
    page.drawText(sanitizeWinAnsi(timesRoman, event), { x, y, size: 20, font: timesRoman, color: BLACK });
  }

  // Legality seal, near center-top of the page.
  if (isLegal !== null) {
    const sealPng = await renderSealPng({ deckType, isLegal, sizePx: SEAL_RASTER_PX });
    const sealImage = await doc.embedPng(sealPng);
    page.drawImage(sealImage, {
      x: (widthPoints - SEAL_SIZE_PT) / 2 - 40 + headerDx,
      y: heightPoints - SEAL_SIZE_PT - 10 - headerDy,
      width: SEAL_SIZE_PT,
      height: SEAL_SIZE_PT,
    });
  }

  if (overflowSections.length > 0) {
    const overflowPage = doc.addPage([widthPoints, heightPoints]);
    drawOverflowPage(doc, overflowPage, overflowSections, widthPoints, heightPoints, name, event, helvetica, helveticaBold);
  }

  return doc.save();
}
