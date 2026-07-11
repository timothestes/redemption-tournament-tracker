import { describe, it, expect } from "vitest";
import {
  DEFAULT_STICKY_FILTERS,
  parseStickyFilters,
  serializeStickyFilters,
} from "../stickyFilters";

describe("parseStickyFilters", () => {
  it("returns defaults (hide AB, hide 1st-print) when nothing is stored", () => {
    expect(parseStickyFilters(null)).toEqual(DEFAULT_STICKY_FILTERS);
    expect(parseStickyFilters(null)).toEqual({ altArt: "hide", noFirstPrint: true });
  });

  it("reads a full JSON blob with the altArt enum", () => {
    const raw = JSON.stringify({ altArt: "prefer", noFirstPrint: false });
    expect(parseStickyFilters(raw)).toEqual({ altArt: "prefer", noFirstPrint: false });
  });

  it("accepts every valid altArt mode", () => {
    for (const altArt of ["hide", "all", "prefer"] as const) {
      expect(parseStickyFilters(JSON.stringify({ altArt, noFirstPrint: true }))).toEqual({
        altArt,
        noFirstPrint: true,
      });
    }
  });

  it("preserves each key independently", () => {
    expect(
      parseStickyFilters(JSON.stringify({ altArt: "all", noFirstPrint: true })),
    ).toEqual({ altArt: "all", noFirstPrint: true });
  });

  it("fills missing keys with defaults", () => {
    expect(parseStickyFilters(JSON.stringify({ altArt: "all" }))).toEqual({
      altArt: "all",
      noFirstPrint: true,
    });
  });

  it("ignores an unrecognized altArt value and uses the default", () => {
    const raw = JSON.stringify({ altArt: "sometimes", noFirstPrint: 0 });
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

  describe("migration from the legacy boolean noAltArt in the JSON blob", () => {
    it("maps noAltArt:false -> altArt:'all'", () => {
      expect(
        parseStickyFilters(JSON.stringify({ noAltArt: false, noFirstPrint: false })),
      ).toEqual({ altArt: "all", noFirstPrint: false });
    });

    it("maps noAltArt:true -> altArt:'hide'", () => {
      expect(
        parseStickyFilters(JSON.stringify({ noAltArt: true, noFirstPrint: true })),
      ).toEqual({ altArt: "hide", noFirstPrint: true });
    });

    it("prefers a present altArt enum over a stale legacy boolean", () => {
      expect(
        parseStickyFilters(JSON.stringify({ altArt: "prefer", noAltArt: true })),
      ).toEqual({ altArt: "prefer", noFirstPrint: true });
    });
  });

  describe("legacy deck-filter-noab key migration", () => {
    it("maps legacy 'false' -> altArt:'all' when the new key is absent", () => {
      expect(parseStickyFilters(null, "false")).toEqual({
        altArt: "all",
        noFirstPrint: true,
      });
    });

    it("maps legacy 'true' -> altArt:'hide'", () => {
      expect(parseStickyFilters(null, "true")).toEqual({
        altArt: "hide",
        noFirstPrint: true,
      });
    });

    it("prefers the new JSON blob over the legacy key", () => {
      const raw = JSON.stringify({ altArt: "prefer", noFirstPrint: false });
      expect(parseStickyFilters(raw, "false")).toEqual({
        altArt: "prefer",
        noFirstPrint: false,
      });
    });
  });
});

describe("serializeStickyFilters", () => {
  it("round-trips through parseStickyFilters", () => {
    const filters = { altArt: "prefer", noFirstPrint: true } as const;
    expect(parseStickyFilters(serializeStickyFilters(filters))).toEqual(filters);
  });

  it("only writes the two known keys", () => {
    const serialized = serializeStickyFilters({
      altArt: "all",
      noFirstPrint: false,
      // @ts-expect-error — guarding against accidental extra fields
      somethingElse: true,
    });
    expect(JSON.parse(serialized)).toEqual({ altArt: "all", noFirstPrint: false });
  });
});
