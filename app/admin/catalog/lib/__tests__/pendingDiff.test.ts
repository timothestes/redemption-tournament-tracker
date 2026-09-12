// app/admin/catalog/lib/__tests__/pendingDiff.test.ts
import { describe, it, expect } from "vitest";
import { diffPending, type BundledOverlay, type DbState } from "../pendingDiff";

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

describe("diffPending — aliases", () => {
  const db = (aliases: DbState["aliases"]): DbState => ({ overrides: [], imageVersions: {}, aliases });
  const bundled = (aliases: BundledOverlay["aliases"]): BundledOverlay => ({
    overrides: [],
    imageVersions: {},
    aliases,
  });

  it("flags an alias saved since the last deploy", () => {
    const items = diffPending(db([{ alias: "LAFS", card_name: "Love at First Sight (LoC)", set_code: "LoC" }]), bundled([]));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("alias-new");
    expect(items[0].detail).toMatch(/LAFS/);
  });

  it("flags an alias deleted from the table that the deploy still serves", () => {
    const items = diffPending(db([]), bundled([{ alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" }]));
    expect(items.map((i) => i.kind)).toEqual(["alias-removed"]);
  });

  it("flags an alias repointed at another printing", () => {
    const items = diffPending(
      db([{ alias: "LAFS", card_name: "Love at First Sight", set_code: "Pat" }]),
      bundled([{ alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" }]),
    );
    expect(items.map((i) => i.kind)).toEqual(["alias-changed"]);
  });

  it("says nothing when the table and the overlay agree", () => {
    const items = diffPending(
      db([{ alias: "LAFS", card_name: "Love at First Sight (LoC)", set_code: "LoC" }]),
      bundled([{ alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" }]),
    );
    expect(items).toEqual([]);
  });

  it("pairs a re-cased alias with the deployed one instead of calling it new", () => {
    // Resolution folds case, so this is the same alias — not an add and a
    // delete. It is still pending, though: the picker badge and the editor chip
    // show the stored casing, and the deploy has the old one.
    const items = diffPending(
      db([{ alias: "lafs", card_name: "Love at First Sight (LoC)", set_code: "LoC" }]),
      bundled([{ alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" }]),
    );
    expect(items.map((i) => i.kind)).toEqual(["alias-changed"]);
    expect(items[0].detail).toMatch(/re-cased/);
  });

  it("treats an overlay with no aliases key as having none", () => {
    const legacy = { overrides: [], imageVersions: {} } as BundledOverlay;
    expect(diffPending({ overrides: [], imageVersions: {} } as DbState, legacy)).toEqual([]);
  });
});
