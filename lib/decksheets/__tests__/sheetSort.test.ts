import { describe, it, expect } from "vitest";
import { sheetSort } from "../sheetSort";
import fixture from "./fixtures/sheet_sort.json";

describe("sheetSort", () => {
  it("matches sort.py's [type, alignment, brigade, name] order over the full catalog", () => {
    const map = new Map<string, any>();
    for (const [name, d] of Object.entries(fixture.input as Record<string, any>)) {
      map.set(name, { type: d.type, alignment: d.alignment, rawBrigade: d.raw_brigade });
    }
    expect(sheetSort(map).map(([name]) => name)).toEqual(fixture.expected_order);
  });
});
