import { describe, it, expect } from "vitest";
import { buildTournamentName, isNameFrozen } from "../naming";
import { requireDecklistsDefault, categoryDefaults, STANDARD_CATEGORIES } from "../categoryDefaults";

describe("buildTournamentName", () => {
  const d = new Date(2026, 7, 2); // Aug 2, 2026
  it("formats date + category", () => {
    expect(buildTournamentName("Type 2", { date: d })).toBe("Aug 2, 2026 Type 2 Tournament");
  });
  it("appends listing city", () => {
    expect(buildTournamentName("Type 1 Limited", { date: d, city: "Wichita" }))
      .toBe("Aug 2, 2026 Type 1 Limited Tournament — Wichita");
  });
});

describe("isNameFrozen", () => {
  it("frozen for official categories, free for Unofficial and none", () => {
    expect(isNameFrozen("Type 2")).toBe(true);
    expect(isNameFrozen("Unofficial")).toBe(false);
    expect(isNameFrozen(null)).toBe(false);
  });
});

describe("requireDecklistsDefault", () => {
  it("on when the category RESOLVES to L/U/T2 (listing strings included)", () => {
    expect(requireDecklistsDefault("Type 1 Limited")).toBe(true);
    expect(requireDecklistsDefault("Type 1 Unlimited")).toBe(true);
    expect(requireDecklistsDefault("Type 2")).toBe(true);
    // Listing-derived categories resolve through categoryDefaults' fuzzy match:
    expect(requireDecklistsDefault("Type 1")).toBe(true); // -> Limited fallthrough
    expect(requireDecklistsDefault("T2 - 2P")).toBe(true);
    // "Closed Deck - 2 Player" is the 2nd-most-common listing format (46 in
    // prod) and previously fell through to Limited — it's sealed product,
    // never decklist-required:
    expect(requireDecklistsDefault("Closed Deck - 2 Player")).toBe(false);
  });
  it("off for Teams/Type A despite resolving to Limited, and all non-constructed", () => {
    for (const c of ["Paragon", "Teams", "Type A", "Booster Draft", "Sealed Deck", "Unofficial", null]) {
      expect(requireDecklistsDefault(c)).toBe(false);
    }
  });
});

describe("Unofficial category", () => {
  it("is offered and maps to Other", () => {
    expect(STANDARD_CATEGORIES).toContain("Unofficial");
    expect(categoryDefaults("Unofficial").deck_format).toBe("Other");
  });
});
