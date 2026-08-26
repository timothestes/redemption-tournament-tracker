import { describe, it, expect } from "vitest";
// @ts-expect-error CJS script module
import { decideMode, missingReleasedKeys } from "../prebuild-catalog.js";

describe("decideMode (spec §5 gate order)", () => {
  it("CATALOG_PREBUILD=0 wins over everything (kill switch)", () =>
    expect(decideMode({ CATALOG_PREBUILD: "0", VERCEL: "1" })).toBe("skip"));
  it("VERCEL → fetch", () => expect(decideMode({ VERCEL: "1" })).toBe("fetch"));
  it("CATALOG_PREBUILD=1 forces fetch locally", () =>
    expect(decideMode({ CATALOG_PREBUILD: "1" })).toBe("fetch"));
  it("plain local/CI → noop", () => expect(decideMode({})).toBe("noop"));
});

describe("missingReleasedKeys (monotonicity guard)", () => {
  const committed = [{ name: "Might of Angels", set: "Pmo-2026" }];
  it("empty fetch reports the missing key", () =>
    expect(missingReleasedKeys(committed, [])).toEqual(["Might of Angels|Pmo-2026"]));
  it("superset fetch passes", () =>
    expect(missingReleasedKeys(committed, [...committed, { name: "New", set: "X" }])).toEqual([]));
});
