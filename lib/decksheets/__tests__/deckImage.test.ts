import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { parseDecklistText } from "../parse";
import { resolveDeck } from "../resolve";
import { generateDeckImage, formatCountValue } from "../deckImage";
import fs from "fs";
import path from "path";

const fakeCard = () =>
  sharp({ create: { width: 344, height: 512, channels: 3, background: "#888" } }).jpeg().toBuffer();

describe("formatCountValue", () => {
  it.each([
    [0, "0.0"],
    [4, "4.0"],
    [3.42, "3.42"],
    [2.5, "2.5"],
  ])("formats %p as Python's f-string float would: %p", (input, expected) => {
    expect(formatCountValue(input)).toBe(expected);
  });
});

describe("generateDeckImage", () => {
  it("renders a WebP grid; 10-col layout for type_1", async () => {
    const deck = resolveDeck(
      parseDecklistText(fs.readFileSync(path.join(__dirname, "fixtures/decks/t1_multi_brigade.txt"), "utf8"))
    );
    const webp = await generateDeckImage({
      deckType: "type_1",
      deck,
      nCardColumns: 10,
      mCountValue: 3.2,
      aodCountValue: null,
      isLegal: true,
      fetchImage: async () => fakeCard(),
    });
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe("webp");
    // text_to_webp.py's output_width = card_width * cards_per_row, with no
    // margin ever added to width (margins/padding only ever grow the height,
    // for the separator bar and the main/reserve gap) — so the brief's
    // original assertion already matches the transcribed formula exactly:
    // combinedWidth = mainImage.width = CARD_WIDTH(345) * cardsPerRow(10).
    expect(meta.width).toBe(10 * 345);
  });

  it("skips missing images without throwing (print-and-skip parity)", async () => {
    // Brief used bare "Son of God" / "Burial", which aren't exact catalog
    // names (only bracketed/parenthetical print variants exist, e.g.
    // "Burial (GoC)") — swapped for real card names so the deck actually
    // resolves and this test exercises the print-and-skip path for real,
    // not an empty-main-deck error. "Burial (GoC)"'s imgFile
    // ("006-Burial-R") still contains "Burial", so the stub's filter still
    // makes it (and only it) fail to fetch.
    const deck = resolveDeck(parseDecklistText("1\tAbednego (Azariah)\n2\tBurial (GoC)\n"));
    const webp = await generateDeckImage({
      deckType: "type_1",
      deck,
      nCardColumns: 10,
      mCountValue: null,
      aodCountValue: null,
      isLegal: null,
      fetchImage: async (f) => (f.includes("Burial") ? null : fakeCard()),
    });
    expect((await sharp(webp).metadata()).format).toBe("webp");
  });
});
