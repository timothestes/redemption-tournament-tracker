import { describe, it, expect } from "vitest";
import { diffCards, summarizeDiff, coerceFieldValue } from "../cardDiff";

describe("diffCards", () => {
  it("detects a changed scalar field", () => {
    const d = diffCards({ name: "Goliath" }, { name: "David" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "name", kind: "changed", before: "Goliath", after: "David" });
  });

  it("marks a newly-present field as added and an emptied field as removed", () => {
    expect(diffCards({}, { reference: "1 Sam 17" })[0]).toMatchObject({ field: "reference", kind: "added", before: null });
    expect(diffCards({ reference: "1 Sam 17" }, {})[0]).toMatchObject({ field: "reference", kind: "removed", after: null });
  });

  it("detects a changed rawText body (the primary content field)", () => {
    const d = diffCards({ rawText: "Old ability text." }, { rawText: "New ability text." });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "rawText", label: "Card text", kind: "changed" });
  });

  it("compares array fields by joined display value", () => {
    const same = diffCards({ brigades: ["Blue", "Green"] }, { brigades: ["Blue", "Green"] });
    expect(same).toHaveLength(0);
    const changed = diffCards({ brigades: ["Blue"] }, { brigades: ["Blue", "Green"] });
    expect(changed[0]).toMatchObject({ field: "brigades", kind: "changed", before: "Blue", after: "Blue, Green" });
  });

  it("treats an empty base as all-added and returns [] when nothing changes", () => {
    const allAdded = diffCards({}, { name: "X", brigades: ["Blue"] });
    expect(allAdded.map((c) => c.field).sort()).toEqual(["brigades", "name"]);
    expect(diffCards({ name: "X" }, { name: "X" })).toEqual([]);
  });
});

describe("summarizeDiff", () => {
  it("summarizes none, few, and many changes", () => {
    expect(summarizeDiff([])).toBe("No field changes.");
    expect(summarizeDiff(diffCards({}, { name: "X" }))).toBe("Changed Name.");
    const many = diffCards({}, { name: "a", reference: "b", alignment: "Good", scripture: "d" });
    expect(summarizeDiff(many)).toMatch(/\+1 more\.$/);
  });
});

describe("coerceFieldValue", () => {
  it("coerces number, array, and scalar fields", () => {
    expect(coerceFieldValue("strength", "5")).toBe(5);
    expect(coerceFieldValue("strength", "nope")).toBeNull();
    expect(coerceFieldValue("brigades", "Blue, Green")).toEqual(["Blue", "Green"]);
    expect(coerceFieldValue("name", "  David  ")).toBe("David");
  });
});
