// app/admin/catalog/lib/__tests__/pendingDiff.test.ts
import { describe, it, expect } from "vitest";
import { diffPending } from "../pendingDiff";

const bundled = {
  overrides: [{ name: "A", set: "S", fields: { legality: "Banned" } }],
  imageVersions: { Img_A: 1 },
};

describe("diffPending", () => {
  it("empty when DB matches the bundled overlay exactly", () => {
    const db = {
      overrides: [{ card_name: "A", set_code: "S", fields: { legality: "Banned" } }],
      imageVersions: { Img_A: 1 },
    };
    expect(diffPending(db, bundled)).toEqual([]);
  });

  it("flags a new override, a changed override, and an image bump", () => {
    const db = {
      overrides: [
        { card_name: "A", set_code: "S", fields: { legality: "Rotation" } }, // changed
        { card_name: "B", set_code: "S", fields: { type: "Hero" } },          // new
      ],
      imageVersions: { Img_A: 2 },                                            // bumped
    };
    const kinds = diffPending(db, bundled).map((i) => i.kind).sort();
    expect(kinds).toEqual(["image-bump", "override-changed", "override-new"]);
  });

  it("flags a DELETED override the bundled overlay still carries — the F4 state", () => {
    const db = { overrides: [], imageVersions: { Img_A: 1 } };
    const items = diffPending(db, bundled);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("override-removed");
    expect(items[0].key).toBe("A|S");
  });
});
