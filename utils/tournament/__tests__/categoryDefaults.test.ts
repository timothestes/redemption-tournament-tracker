import { describe, it, expect } from "vitest";
import { categoryDefaults, STANDARD_CATEGORIES } from "../categoryDefaults";

describe("categoryDefaults", () => {
  it.each([
    ["Type 1 Limited", "Limited"],
    ["Type 1 Unlimited", "Unlimited"],
    ["Type 2", "T2"],
    ["Teams", "Teams"],
    ["Type 1 - Teams", "Teams"],
    ["Paragon", "Paragon"],
    ["Booster Draft (GoC x3)", "Other"],
    ["Type A 2-Player", "Limited"],
  ])("%s → %s", (cat, fmt) => {
    expect(categoryDefaults(cat).deck_format).toBe(fmt);
  });

  it("lists both T1 categories", () => {
    expect(STANDARD_CATEGORIES).toContain("Type 1 Unlimited");
  });
});
