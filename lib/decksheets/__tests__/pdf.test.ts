import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import { parseDecklistText } from "../parse";
import { resolveDeck } from "../resolve";
import { generateDeckCheckPdf } from "../pdf";

const load = (f: string) =>
  resolveDeck(parseDecklistText(fs.readFileSync(path.join(__dirname, "fixtures/decks", f), "utf8")));

describe("generateDeckCheckPdf", () => {
  it("renders a T1 sheet on the template (single page when nothing overflows)", async () => {
    const bytes = await generateDeckCheckPdf({
      deckType: "type_1",
      deck: load("t1_multi_brigade.txt"),
      name: "Test Player",
      event: "Test Event",
      showAlignment: true,
      mCountValue: 3.2,
      aodCountValue: 1.1,
      isLegal: true,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(850);
    expect(Math.round(height)).toBe(1100);
  });

  it("renders a T2 sheet on the template (single page when nothing overflows)", async () => {
    const bytes = await generateDeckCheckPdf({
      deckType: "type_2",
      deck: load("t2_with_reserve.txt"),
      name: "Test Player",
      event: "Test Event",
      showAlignment: true,
      mCountValue: 3.2,
      aodCountValue: 1.1,
      isLegal: true,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(850);
    expect(Math.round(height)).toBe(1100);
  });

  // t2_overflow.txt is a purpose-built deck (8 unique GE/EE-type "misc"
  // cards, exceeding T2_SECTION_LIMITS.Misc = 6) — kept separate from the
  // t2_with_reserve.txt counts.json battery deck so it doesn't perturb the
  // Monte Carlo M/AoD fixture parity in counts.test.ts.
  it("adds an overflow page for a T2 deck that exceeds section limits", async () => {
    const bytes = await generateDeckCheckPdf({
      deckType: "type_2",
      deck: load("t2_overflow.txt"),
      name: "",
      event: "",
      showAlignment: false,
      mCountValue: null,
      aodCountValue: null,
      isLegal: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("sanitizes non-WinAnsi user text instead of throwing", async () => {
    await expect(
      generateDeckCheckPdf({
        deckType: "type_1",
        deck: load("t1_multi_brigade.txt"),
        name: "Player 😀 Ω",
        event: "Ünïcode Event ✓",
        showAlignment: false,
        mCountValue: null,
        aodCountValue: null,
        isLegal: null,
      })
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
