import { describe, it, expect } from "vitest";
import { fmtClass, placeBadgeClass, stateAbbr, parseKey, buildKey, shuffle, ordinal } from "./format";

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
describe("ordinal", () => {
  it("handles 1st/2nd/3rd", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
  });
  it("handles the 11-13 exception", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
  });
  it("handles double digits and beyond by last digit", () => {
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(61)).toBe("61st");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(112)).toBe("112th");
    expect(ordinal(121)).toBe("121st");
  });
  it("handles everything else", () => {
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(20)).toBe("20th");
  });
});
