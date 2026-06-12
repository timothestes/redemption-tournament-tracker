import { describe, it, expect } from "vitest";
import {
  normalizeEpisode,
  isNumericEpisode,
  pickPreviousEpisode,
  sortDraftsForList,
} from "../episodes";

describe("normalizeEpisode", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEpisode("  100 ")).toBe("100");
  });
  it("rejects empty and whitespace-only values", () => {
    expect(normalizeEpisode("")).toBeNull();
    expect(normalizeEpisode("   ")).toBeNull();
  });
  it("rejects values containing a slash", () => {
    expect(normalizeEpisode("10/0")).toBeNull();
  });
  it("rejects values longer than 100 chars", () => {
    expect(normalizeEpisode("x".repeat(101))).toBeNull();
  });
  it("allows free text like 'draft'", () => {
    expect(normalizeEpisode("draft")).toBe("draft");
  });
});

describe("isNumericEpisode", () => {
  it("accepts integers and decimals", () => {
    expect(isNumericEpisode("100")).toBe(true);
    expect(isNumericEpisode("100.5")).toBe(true);
  });
  it("rejects non-numeric and partial-numeric values", () => {
    expect(isNumericEpisode("draft")).toBe(false);
    expect(isNumericEpisode("Ep100")).toBe(false);
    expect(isNumericEpisode("100.")).toBe(false);
    expect(isNumericEpisode("")).toBe(false);
  });
});

describe("pickPreviousEpisode", () => {
  const eps = ["98", "draft", "100", "99.5", "Ep97"];
  it("returns the highest numeric episode strictly below the target", () => {
    expect(pickPreviousEpisode(eps, "100")).toBe("99.5");
    expect(pickPreviousEpisode(eps, "99.5")).toBe("98");
  });
  it("ignores non-numeric stored episodes", () => {
    expect(pickPreviousEpisode(["draft", "Ep97"], "100")).toBeNull();
  });
  it("returns null when nothing is below the target", () => {
    expect(pickPreviousEpisode(eps, "98")).toBeNull();
  });
  it("returns null for a non-numeric target", () => {
    expect(pickPreviousEpisode(eps, "draft")).toBeNull();
  });
});

describe("sortDraftsForList", () => {
  it("sorts numeric episodes descending first, then non-numeric by updated_at desc", () => {
    const rows = [
      { episode_number: "draft", updated_at: "2026-06-01T00:00:00Z" },
      { episode_number: "99", updated_at: "2026-05-01T00:00:00Z" },
      { episode_number: "notes", updated_at: "2026-06-10T00:00:00Z" },
      { episode_number: "100", updated_at: "2026-04-01T00:00:00Z" },
    ];
    expect(sortDraftsForList(rows).map((r) => r.episode_number)).toEqual([
      "100", "99", "notes", "draft",
    ]);
  });
});
