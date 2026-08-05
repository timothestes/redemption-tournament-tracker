import { describe, it, expect } from "vitest";
import { pgrestInList } from "../helpers";

describe("pgrestInList", () => {
  it("quotes every value", () => {
    expect(pgrestInList(["a", "b"])).toBe('("a","b")');
  });

  it("escapes embedded double quotes (the Lost Soul case that corrupted previewSale)", () => {
    expect(pgrestInList(['Lost Soul "Contempt" [Daniel 12:2]|T2C|x'])).toBe(
      '("Lost Soul \\"Contempt\\" [Daniel 12:2]|T2C|x")',
    );
  });

  it("escapes backslashes before quotes", () => {
    expect(pgrestInList(['a\\b"c'])).toBe('("a\\\\b\\"c")');
  });

  it("commas and parens ride safely inside quotes", () => {
    expect(pgrestInList(["Belshazzar's 1,000|T2C|119", "Abed-nego (Azariah) (PoC)|PoC|150"])).toBe(
      '("Belshazzar\'s 1,000|T2C|119","Abed-nego (Azariah) (PoC)|PoC|150")',
    );
  });

  it("empty input yields () — callers must guard non-empty", () => {
    expect(pgrestInList([])).toBe("()");
  });
});
