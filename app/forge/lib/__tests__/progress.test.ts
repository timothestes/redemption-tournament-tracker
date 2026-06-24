import { describe, it, expect } from "vitest";
import { computeProgress } from "../progress";

const card = (cardType: string[], brigades: string[] | undefined, status = "draft") => ({
  snapshot: { cardType, brigades }, status,
});

describe("computeProgress", () => {
  it("headline counts distinct non-archived cards against target total", () => {
    const m = computeProgress(
      [card(["Hero"], ["Blue"]), card(["LostSoul"], undefined), card(["Hero"], ["Green"], "archived")],
      { total: 10 }
    );
    expect(m.headline).toEqual({ actual: 2, target: 10, pct: 20 });
  });

  it("a dual-brigade card counts in each brigade cell but once in the headline", () => {
    const m = computeProgress([card(["Hero"], ["Blue", "Green"])], { total: 5, cells: { Hero: { Blue: 1, Green: 1 } } });
    expect(m.headline.actual).toBe(1);
    const blue = m.cells.find((c) => c.type === "Hero" && c.brigade === "Blue");
    const green = m.cells.find((c) => c.type === "Hero" && c.brigade === "Green");
    expect(blue?.actual).toBe(1);
    expect(green?.actual).toBe(1);
  });

  it("brigade-less types use the 'none' bucket", () => {
    const m = computeProgress([card(["LostSoul"], undefined), card(["Artifact"], [])], { cells: { LostSoul: { none: 3 }, Artifact: { none: 2 } } });
    expect(m.cells.find((c) => c.type === "LostSoul" && c.brigade === "none")?.actual).toBe(1);
    expect(m.cells.find((c) => c.type === "Artifact" && c.brigade === "none")?.actual).toBe(1);
  });

  it("byStatus groups non-archived cards by status", () => {
    const m = computeProgress(
      [card(["Hero"], ["Blue"], "draft"), card(["Hero"], ["Blue"], "playtesting"), card(["Hero"], ["Blue"], "archived")],
      {}
    );
    expect(m.byStatus).toEqual({ draft: 1, playtesting: 1 });
  });

  it("checklist lists per-cell remaining where target exceeds actual", () => {
    const m = computeProgress([card(["Hero"], ["Blue"])], { cells: { Hero: { Blue: 3, Green: 2 } } });
    const blue = m.checklist.find((c) => c.type === "Hero" && c.brigade === "Blue");
    const green = m.checklist.find((c) => c.type === "Hero" && c.brigade === "Green");
    expect(blue?.remaining).toBe(2);
    expect(green?.remaining).toBe(2);
  });

  it("graceful degrade: total-only targets still render actuals with target 0 cells", () => {
    const m = computeProgress([card(["Hero"], ["Blue"])], { total: 4 });
    expect(m.headline.target).toBe(4);
    expect(m.cells.find((c) => c.type === "Hero" && c.brigade === "Blue")?.target).toBe(0);
    expect(m.checklist).toEqual([]); // no per-cell targets declared
  });

  it("pct is 0 when target total is 0 or absent", () => {
    expect(computeProgress([card(["Hero"], ["Blue"])], {}).headline.pct).toBe(0);
  });
});
