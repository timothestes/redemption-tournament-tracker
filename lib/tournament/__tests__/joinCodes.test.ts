import { describe, it, expect } from "vitest";
import { generateJoinCode, normalizeJoinCode } from "../joinCodes";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("generateJoinCode", () => {
  it("returns 6 chars from the Crockford alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(ALPHABET).toContain(ch);
    }
  });
  it("varies between calls", () => {
    const s = new Set(Array.from({ length: 50 }, () => generateJoinCode()));
    expect(s.size).toBeGreaterThan(45);
  });
});

describe("normalizeJoinCode", () => {
  it("uppercases and maps Crockford aliases", () => {
    // i/l -> 1, o -> 0, u -> V is NOT a Crockford alias — u is simply invalid.
    expect(normalizeJoinCode("abio1l")).toBe("AB1011");
  });
  it("strips whitespace and hyphens", () => {
    expect(normalizeJoinCode(" ab-c 123 ")).toBe("ABC123"); // cleans to 6 valid chars
    expect(normalizeJoinCode("abc-123")).toBe("ABC123");
  });
  it("rejects wrong length or invalid chars", () => {
    expect(normalizeJoinCode("ABCDE")).toBe(null);
    expect(normalizeJoinCode("ABCDEFG")).toBe(null);
    expect(normalizeJoinCode("ABC12U")).toBe(null);
    expect(normalizeJoinCode("")).toBe(null);
  });
});
