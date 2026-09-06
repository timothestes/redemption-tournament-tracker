import { describe, it, expect } from "vitest";
import { normalizeTags, validatePatch, validateForPublish, MAX_TAGS, type PostPatch } from "../validate";

const ok: PostPatch = {
  title: "A fine title",
  slug: "a-fine-title",
  excerpt: null,
  body_md: "Body",
  cover_image_url: null,
  tags: ["Strategy"],
};

describe("normalizeTags", () => {
  it("trims, collapses whitespace, keeps first spelling, dedupes case-insensitively", () => {
    expect(normalizeTags([" Deck  Tech ", "deck tech", "News", "", "news"])).toEqual(["Deck Tech", "News"]);
  });
  it("drops overlong tags and caps the count", () => {
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(normalizeTags(["x".repeat(41), ...many])).toHaveLength(MAX_TAGS);
  });
});

describe("validatePatch", () => {
  it("accepts a good patch", () => expect(validatePatch(ok)).toBeNull());
  it("rejects an empty title", () => expect(validatePatch({ ...ok, title: "  " })).toMatch(/title/i));
  it("rejects a 201-char title", () => expect(validatePatch({ ...ok, title: "x".repeat(201) })).toMatch(/200/));
  it.each(["Has Caps", "double--hyphen", "-leading", "trailing-", "sp ace", ""])("rejects slug %j", (slug) =>
    expect(validatePatch({ ...ok, slug })).toMatch(/slug/i),
  );
  it("rejects a long excerpt", () => expect(validatePatch({ ...ok, excerpt: "e".repeat(501) })).toMatch(/500/));
  it("rejects a non-https cover", () => expect(validatePatch({ ...ok, cover_image_url: "http://x/y.png" })).toMatch(/https/));
});

describe("validateForPublish", () => {
  it("passes a titled post with a body", () => expect(validateForPublish({ title: "T", body_md: "b" })).toBeNull());
  it("blocks the default title", () => expect(validateForPublish({ title: "Untitled", body_md: "b" })).toMatch(/title/i));
  it("blocks an empty body", () => expect(validateForPublish({ title: "T", body_md: " \n" })).toMatch(/write/i));
});
