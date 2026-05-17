import { describe, it, expect } from "vitest";
import { parseListParams, isUuid, PUBLIC_DECKS_LIST_TAG, publicDeckTag } from "../cache";

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
