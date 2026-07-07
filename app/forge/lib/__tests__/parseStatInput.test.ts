import { describe, it, expect } from "vitest";
import { parseStatInput } from "../designCard";

describe("parseStatInput", () => {
  it("returns null for empty / whitespace / junk", () => {
    expect(parseStatInput("")).toBeNull();
    expect(parseStatInput("   ")).toBeNull();
    expect(parseStatInput("abc")).toBeNull();
    expect(parseStatInput("6-0")).toBeNull();
  });

  it("passes plain numbers through as numbers", () => {
    expect(parseStatInput("6")).toBe(6);
    expect(parseStatInput(" 12 ")).toBe(12);
    expect(parseStatInput("0")).toBe(0);
  });

  it("normalizes a variable stat to X", () => {
    expect(parseStatInput("x")).toBe("X");
    expect(parseStatInput("X")).toBe("X");
  });

  it("normalizes canonical parenthesized dual-side stats", () => {
    expect(parseStatInput("6 (0)")).toBe("6 (0)");
    expect(parseStatInput("3(2)")).toBe("3 (2)");
    expect(parseStatInput("x(0)")).toBe("X (0)");
  });

  it("accepts slash-separated dual-side stats and normalizes to N (M)", () => {
    expect(parseStatInput("6/0")).toBe("6 (0)");
    expect(parseStatInput("6 / 0")).toBe("6 (0)");
    expect(parseStatInput("x/0")).toBe("X (0)");
    expect(parseStatInput("6/x")).toBe("6 (X)");
  });
});
