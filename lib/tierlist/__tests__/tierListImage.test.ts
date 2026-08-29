import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  generateTierListImage,
  canvasWidth,
  canvasHeight,
  columnCount,
  rowHeight,
  labelLines,
  labelFontSize,
  fitTitle,
} from "../tierListImage";

const fakeCard = () =>
  sharp({ create: { width: 344, height: 512, channels: 3, background: "#888" } }).jpeg().toBuffer();

// Real prints, so findCard() resolves an imgFile the way it will in production.
const CARD_A = { name: "A Child is Born", set: "Pmo-P1" };
const CARD_B = { name: "A Look Back", set: "Wom" };

const CARD_HEIGHT = 215;
const GAP = 8;
const PAD = 12;
const EMPTY_ROW_HEIGHT = 88;
const FOOTER_HEIGHT = 40;
const TITLE_HEIGHT = 92;
const MAX_ASPECT = 1.6;

const rows = (...counts: number[]) => counts.map((n) => ({ cards: new Array(n).fill(0) }));

describe("columnCount", () => {
  it("holds a floor so a one-card board is not a single narrow column", () => {
    expect(columnCount(rows(0, 1))).toBe(3);
  });

  it("widens to the fullest row", () => {
    expect(columnCount(rows(6, 0))).toBe(6);
  });

  it("caps the width so one stuffed row cannot blow up the canvas", () => {
    expect(columnCount(rows(40))).toBe(10);
  });

  it("widens a tall sparse board until it is no longer a skinny column", () => {
    // Six rows at the 3-column floor would be ~2.2:1; widening fixes it without
    // changing any row's height.
    const board = rows(3, 2, 2, 1, 0, 1);
    expect(columnCount(board, true)).toBeGreaterThan(3);
    expect(canvasHeight(board, columnCount(board, true), true) / canvasWidth(columnCount(board, true)))
      .toBeLessThanOrEqual(MAX_ASPECT);
  });

  it("never exceeds the column cap while chasing the aspect ratio", () => {
    expect(columnCount(rows(...new Array(20).fill(0)), true)).toBeLessThanOrEqual(10);
  });
});

describe("rowHeight", () => {
  it("gives an empty row a short band rather than a card's height", () => {
    expect(rowHeight(0, 6)).toBe(EMPTY_ROW_HEIGHT);
    expect(rowHeight(0, 6)).toBeLessThan(rowHeight(1, 6));
  });

  it("keeps one line of cards at the single-card height", () => {
    expect(rowHeight(6, 6)).toBe(CARD_HEIGHT + PAD * 2);
  });

  it("grows by a card plus a gap for each wrapped line", () => {
    expect(rowHeight(7, 6)).toBe(2 * (CARD_HEIGHT + GAP) - GAP + PAD * 2);
    expect(rowHeight(13, 6)).toBe(3 * (CARD_HEIGHT + GAP) - GAP + PAD * 2);
  });
});

describe("labelLines", () => {
  it("leaves the classic single-letter tiers alone", () => {
    expect(labelLines("S")).toEqual(["S"]);
    expect(labelLines("S+")).toEqual(["S+"]);
  });

  it("never splits a single word", () => {
    expect(labelLines("Banned")).toEqual(["Banned"]);
  });

  it("splits a two-word label at its space", () => {
    expect(labelLines("Never Playable")).toEqual(["Never", "Playable"]);
  });

  it("splits a longer label at its most central space", () => {
    expect(labelLines("only in a mirror")).toEqual(["only in", "a mirror"]);
  });

  it("trims surrounding whitespace", () => {
    expect(labelLines("  Top  ")).toEqual(["Top"]);
  });
});

describe("labelFontSize", () => {
  it("uses the full size for classic one- and two-character tiers", () => {
    expect(labelFontSize(["S"])).toBe(56);
    expect(labelFontSize(["S+"])).toBe(56);
  });

  it("keeps a wrapped custom label readable rather than shrinking it to nothing", () => {
    // The whole point of wrapping: this was 13px on one line.
    expect(labelFontSize(labelLines("Never Playable"))).toBeGreaterThanOrEqual(20);
  });

  it("never returns an unreadable size, however long the label", () => {
    expect(labelFontSize(["x".repeat(200)])).toBe(15);
  });
});

describe("fitTitle", () => {
  it("uses the largest size for a short title", () => {
    expect(fitTitle("Nationals 2026", 1000).fontSize).toBe(40);
  });

  it("shrinks a long title before truncating it", () => {
    const { text, fontSize } = fitTitle("Every Dominant Ranked For The 2026 Season", 1000);
    expect(fontSize).toBeLessThan(40);
    expect(text).not.toContain("…");
  });

  it("truncates a title that cannot fit even at the minimum size", () => {
    const { text, fontSize } = fitTitle("x".repeat(400), 700);
    expect(fontSize).toBe(18);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(400);
  });

  it("keeps the fitted title inside the canvas", () => {
    const width = 900;
    const { text, fontSize } = fitTitle("A Really Quite Long Tier List Title Here", width);
    expect(text.length * 0.6 * fontSize).toBeLessThanOrEqual(width - PAD * 4);
  });
});

describe("generateTierListImage", () => {
  it("renders a PNG sized to the grid, footer included", async () => {
    const board = [
      { label: "S", color: "#de7b72", cards: [CARD_A, CARD_B] },
      { label: "A", color: "#dea267", cards: [] },
    ];
    const png = await generateTierListImage({ rows: board, fetchImage: async () => fakeCard() });
    const meta = await sharp(png).metadata();
    const cols = columnCount(board);
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(canvasWidth(cols));
    expect(meta.height).toBe(rowHeight(2, cols) + EMPTY_ROW_HEIGHT + FOOTER_HEIGHT);
  });

  it("adds a title bar only when a title is given", async () => {
    const board = [{ label: "S", color: "#de7b72", cards: [CARD_A] }];
    const untitled = await sharp(
      await generateTierListImage({ rows: board, fetchImage: async () => fakeCard() }),
    ).metadata();
    const titled = await sharp(
      await generateTierListImage({ rows: board, title: "EoT Lost Souls", fetchImage: async () => fakeCard() }),
    ).metadata();
    expect(titled.height! - untitled.height!).toBe(TITLE_HEIGHT);
  });

  it("treats a blank title as no title", async () => {
    const board = [{ label: "S", color: "#de7b72", cards: [CARD_A] }];
    const blank = await sharp(
      await generateTierListImage({ rows: board, title: "   ", fetchImage: async () => fakeCard() }),
    ).metadata();
    const none = await sharp(
      await generateTierListImage({ rows: board, fetchImage: async () => fakeCard() }),
    ).metadata();
    expect(blank.height).toBe(none.height);
  });

  it("drops a card whose art will not load instead of leaving a hole", async () => {
    const png = await generateTierListImage({
      rows: [{ label: "S", color: "#de7b72", cards: [CARD_A, CARD_B] }],
      fetchImage: async (imgFile) => (imgFile.startsWith("A_Child") ? fakeCard() : null),
    });
    const meta = await sharp(png).metadata();
    expect(meta.height).toBe(rowHeight(1, columnCount([{ cards: [CARD_A] }])) + FOOTER_HEIGHT);
  });

  it("survives a fetch that throws rather than failing the whole export", async () => {
    const png = await generateTierListImage({
      rows: [{ label: "S", color: "#de7b72", cards: [CARD_A, CARD_B] }],
      fetchImage: async (imgFile) => {
        if (imgFile.startsWith("A_Child")) return fakeCard();
        throw new Error("network down");
      },
    });
    expect((await sharp(png).metadata()).format).toBe("png");
  });

  it("skips a card that is not in the catalog at all", async () => {
    const png = await generateTierListImage({
      rows: [{ label: "S", color: "#de7b72", cards: [{ name: "Not A Real Card", set: "ZZ" }] }],
      fetchImage: async () => fakeCard(),
    });
    const meta = await sharp(png).metadata();
    expect(meta.height).toBe(EMPTY_ROW_HEIGHT + FOOTER_HEIGHT);
  });

  it("renders a label containing XML-significant characters", async () => {
    const png = await generateTierListImage({
      rows: [{ label: '<A & "B">', color: "#de7b72", cards: [CARD_A] }],
      fetchImage: async () => fakeCard(),
    });
    expect((await sharp(png).metadata()).format).toBe("png");
  });

  it("falls back to a neutral header when the colour is not a hex triplet", async () => {
    const png = await generateTierListImage({
      rows: [{ label: "S", color: '" onload="alert(1)', cards: [CARD_A] }],
      fetchImage: async () => fakeCard(),
    });
    expect((await sharp(png).metadata()).format).toBe("png");
  });

  it("fetches each distinct card's art once", async () => {
    let fetches = 0;
    await generateTierListImage({
      rows: [
        { label: "S", color: "#de7b72", cards: [CARD_A] },
        { label: "A", color: "#dea267", cards: [CARD_A, CARD_B] },
      ],
      fetchImage: async () => {
        fetches += 1;
        return fakeCard();
      },
    });
    expect(fetches).toBe(2);
  });
});
