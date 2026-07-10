import { describe, it, expect } from "vitest";
import {
  DEFAULT_STICKY_FILTERS,
  parseStickyFilters,
  serializeStickyFilters,
} from "../stickyFilters";

describe("parseStickyFilters", () => {
  it("returns defaults (hide both) when nothing is stored", () => {
    expect(parseStickyFilters(null)).toEqual(DEFAULT_STICKY_FILTERS);
    expect(parseStickyFilters(null)).toEqual({ noAltArt: true, noFirstPrint: true });
  });

  it("reads a full JSON blob", () => {
    const raw = JSON.stringify({ noAltArt: false, noFirstPrint: false });
    expect(parseStickyFilters(raw)).toEqual({ noAltArt: false, noFirstPrint: false });
  });

  it("preserves each key independently", () => {
    expect(
      parseStickyFilters(JSON.stringify({ noAltArt: false, noFirstPrint: true })),
    ).toEqual({ noAltArt: false, noFirstPrint: true });
  });

  it("fills missing keys with defaults", () => {
    expect(parseStickyFilters(JSON.stringify({ noAltArt: false }))).toEqual({
      noAltArt: false,
      noFirstPrint: true,
    });
  });

  it("ignores non-boolean values and uses defaults for them", () => {
    const raw = JSON.stringify({ noAltArt: "false", noFirstPrint: 0 });
    expect(parseStickyFilters(raw)).toEqual(DEFAULT_STICKY_FILTERS);
  });

  it("falls back to defaults on corrupt / non-JSON input", () => {
    expect(parseStickyFilters("not json")).toEqual(DEFAULT_STICKY_FILTERS);
    expect(parseStickyFilters("[1,2,3")).toEqual(DEFAULT_STICKY_FILTERS);
  });

  it("falls back to defaults when JSON is not an object", () => {
    expect(parseStickyFilters("true")).toEqual(DEFAULT_STICKY_FILTERS);
    expect(parseStickyFilters("42")).toEqual(DEFAULT_STICKY_FILTERS);
  });

  describe("legacy deck-filter-noab migration", () => {
    it("adopts legacy 'false' for noAltArt when the new key is absent", () => {
      expect(parseStickyFilters(null, "false")).toEqual({
        noAltArt: false,
        noFirstPrint: true,
      });
    });

    it("adopts legacy 'true' for noAltArt", () => {
      expect(parseStickyFilters(null, "true")).toEqual({
        noAltArt: true,
        noFirstPrint: true,
      });
    });

    it("prefers the new JSON blob over the legacy key", () => {
      const raw = JSON.stringify({ noAltArt: true, noFirstPrint: false });
      expect(parseStickyFilters(raw, "false")).toEqual({
        noAltArt: true,
        noFirstPrint: false,
      });
    });
  });
});

describe("serializeStickyFilters", () => {
  it("round-trips through parseStickyFilters", () => {
    const filters = { noAltArt: false, noFirstPrint: true };
    expect(parseStickyFilters(serializeStickyFilters(filters))).toEqual(filters);
  });

  it("only writes the two known keys", () => {
    const serialized = serializeStickyFilters({
      // extra field should not be persisted
      noAltArt: false,
      noFirstPrint: false,
      // @ts-expect-error — guarding against accidental extra fields
      somethingElse: true,
    });
    expect(JSON.parse(serialized)).toEqual({ noAltArt: false, noFirstPrint: false });
  });
});
