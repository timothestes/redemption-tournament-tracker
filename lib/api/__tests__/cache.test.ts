import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { parseListParams, isUuid, PUBLIC_DECKS_LIST_TAG, publicDeckTag, deckFormatFilterFor } from "../cache";

describe("parseListParams", () => {
  function p(qs: string) {
    return parseListParams(new URL("http://x/?" + qs).searchParams);
  }

  it("returns defaults when nothing is set", () => {
    expect(p("")).toEqual({
      ok: true,
      value: { page: 1, page_size: 24, format: null, username: null, sort: "newest" },
    });
  });

  it("rejects unknown sort values", () => {
    const r = p("sort=banana");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/sort/i);
  });

  it("rejects page_size outside allowlist", () => {
    const r = p("page_size=25");
    expect(r.ok).toBe(false);
  });

  it("accepts page_size in allowlist", () => {
    expect(p("page_size=50").ok).toBe(true);
    expect(p("page_size=100").ok).toBe(true);
  });

  it("rejects page below 1 or above 1000", () => {
    expect(p("page=0").ok).toBe(false);
    expect(p("page=1001").ok).toBe(false);
  });

  it("trims and accepts username", () => {
    const r = p("username=%20foo%20");
    if (r.ok) expect(r.value.username).toBe("foo");
  });
});

describe("isUuid", () => {
  it("accepts valid v4 UUIDs", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
  });
  it("rejects malformed strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("publicDeckTag", () => {
  it("builds the per-deck tag", () => {
    expect(publicDeckTag("abc")).toBe("public-deck:abc");
    expect(PUBLIC_DECKS_LIST_TAG).toBe("public-decks-list");
  });
});

// Builds a real PostgrestFilterBuilder (no network call happens — the query
// is never awaited) so we can inspect the exact URL it constructs. This is
// the actual query-builder type every `decks.format` filter site chains
// onto, so asserting against `.url.search` here locks in the real wire
// format, not just the string literal in the source.
function deckQuery() {
  return createClient("https://example.supabase.co", "anon-key").from("decks").select("*");
}

// `.url` is a protected property in supabase-js's PostgrestFilterBuilder
// types (an internal detail we're deliberately introspecting here, not part
// of its public API), so this needs an `unknown` cast to read it in a test.
function decodedSearch(q: unknown): string {
  return decodeURIComponent((q as { url: URL }).url.search);
}

describe("deckFormatFilterFor", () => {
  it("Limited (incl. legacy 'Type 1' input) includes null + both vocab strings", () => {
    for (const input of ["Limited", "Type 1"]) {
      expect(deckFormatFilterFor(input)).toEqual({
        kind: "or",
        clause: "format.is.null,format.in.(Type 1,Limited)",
      });
    }
  });

  it("T2 (incl. legacy 'Type 2' input) covers both vocab strings", () => {
    expect(deckFormatFilterFor("T2")).toEqual({ kind: "in", values: ["Type 2", "T2"] });
    expect(deckFormatFilterFor("Type 2")).toEqual({ kind: "in", values: ["Type 2", "T2"] });
  });

  it("Unlimited (incl. legacy 'Classic' input) covers both vocab strings", () => {
    expect(deckFormatFilterFor("Unlimited")).toEqual({ kind: "in", values: ["Unlimited", "Classic"] });
    expect(deckFormatFilterFor("Classic")).toEqual({ kind: "in", values: ["Unlimited", "Classic"] });
  });

  it("Paragon is a single literal shared by both vocabularies", () => {
    expect(deckFormatFilterFor("Paragon")).toEqual({ kind: "eq", value: "Paragon" });
  });

  it("Limited clause's raw or() string decodes to the exact fragment the library's own in() produces for the same embedded-space values", () => {
    // Ground truth: how supabase-js itself encodes an in-list containing a
    // value with a space ("Type 1"), via its own array-based .in() method —
    // this is the library's canonical encoding, not something hand-guessed.
    // (decodeURIComponent leaves "+" as "+" — query strings encode spaces as
    // "+", not "%20", so this is the correctly-decoded form, not a typo.)
    const reference = decodedSearch(deckQuery().in("format", ["Type 1", "Limited"]));
    const referenceInFragment = reference.match(/format=(in\.\(.*\))/)?.[1];
    expect(referenceInFragment).toBe("in.(Type+1,Limited)");

    // Our hand-written or() clause must produce a URL embedding that exact
    // same in.(...) fragment, byte-for-byte, alongside the null check.
    const filter = deckFormatFilterFor("Limited");
    if (filter.kind !== "or") throw new Error("expected an or() filter");
    const built = decodedSearch(deckQuery().or(filter.clause));
    expect(built).toBe(`?select=*&or=(format.is.null,format.${referenceInFragment})`);
  });

  it("T2/Unlimited/Paragon clauses match calling .in()/.eq() directly with the same values", () => {
    for (const [input, expected] of [
      ["T2", deckQuery().in("format", ["Type 2", "T2"])],
      ["Unlimited", deckQuery().in("format", ["Unlimited", "Classic"])],
      ["Paragon", deckQuery().eq("format", "Paragon")],
    ] as const) {
      const filter = deckFormatFilterFor(input);
      const built =
        filter.kind === "or"
          ? deckQuery().or(filter.clause)
          : filter.kind === "in"
          ? deckQuery().in("format", filter.values)
          : deckQuery().eq("format", filter.value);
      expect(decodedSearch(built)).toBe(decodedSearch(expected));
    }
  });
});
