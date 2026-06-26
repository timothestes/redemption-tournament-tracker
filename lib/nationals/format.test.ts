import { describe, it, expect } from "vitest";
import { fmtClass, placeBadgeClass, stateAbbr, parseKey, buildKey, shuffle } from "./format";

describe("fmtClass", () => {
  it("maps known formats", () => {
    expect(fmtClass("T1 2-Player")).toBe("fmt-T1");
    expect(fmtClass("T2 2-Player")).toBe("fmt-T2");
    expect(fmtClass("Sealed")).toBe("fmt-Sealed");
    expect(fmtClass("Booster Draft")).toBe("fmt-Booster");
    expect(fmtClass("Teams")).toBe("fmt-Teams");
    expect(fmtClass("Type A")).toBe("fmt-TypeA");
    expect(fmtClass("")).toBe("fmt-default");
  });
});
describe("placeBadgeClass", () => {
  it("medals + fallback", () => {
    expect(placeBadgeClass(1)).toBe("place-1");
    expect(placeBadgeClass(4)).toBe("place-n");
  });
});
describe("stateAbbr", () => {
  it("extracts trailing 2-letter state", () => {
    expect(stateAbbr("Rogers, AR")).toBe("AR");
    expect(stateAbbr("Somewhere")).toBeNull();
  });
});
describe("key helpers", () => {
  it("round-trips", () => {
    expect(buildKey(2025, "Sealed")).toBe("2025_Sealed");
    expect(parseKey("2025_Sealed")).toEqual({ year: 2025, format: "Sealed" });
  });
});
describe("shuffle", () => {
  it("preserves members", () => {
    expect(shuffle([1, 2, 3]).sort()).toEqual([1, 2, 3]);
  });
});
