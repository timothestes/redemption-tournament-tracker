import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseDecklistText } from "../parse";
import { resolveDeck } from "../resolve";
import { calculateMCount, calculateAodBreakdown } from "../counts";
import expected from "./fixtures/counts.json";

const load = (f: string) =>
  resolveDeck(parseDecklistText(fs.readFileSync(path.join(__dirname, "fixtures/decks", f), "utf8")));

describe("counts parity vs Python fixture", () => {
  for (const [file, exp] of Object.entries(expected as Record<string, any>)) {
    it(`${file}: m_count within ±0.15`, () => {
      expect(Math.abs(calculateMCount(load(file).main) - exp.m_count)).toBeLessThanOrEqual(0.15);
    });
    it(`${file}: aod breakdown within tolerance`, () => {
      const b = calculateAodBreakdown(load(file).main);
      expect(Math.abs(b.aod_count - exp.aod_count)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(b.soul_aod_count - exp.soul_aod_count)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(b.whiff_percentage - exp.whiff_percentage)).toBeLessThanOrEqual(2);
    });
  }
  it("tiny_8.txt: aod breakdown is all zeros (<9 cards)", () => {
    expect(calculateAodBreakdown(load("tiny_8.txt").main)).toEqual(
      { aod_count: 0, soul_aod_count: 0, whiff_percentage: 0 });
  });
});
