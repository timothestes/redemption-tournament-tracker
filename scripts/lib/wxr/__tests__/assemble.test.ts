import { describe, expect, it } from "vitest";
import { assemblePost, finalSlugs, truncateSlug, wpDateToIso, loadAuthorMap } from "../assemble";
import type { WxrPost } from "../parse";
import { join } from "node:path";

const base: WxrPost = {
  wpId: "1", title: "T", link: "https://landofredemption.com/t/", slug: "t", creator: "admin", content: "", excerpt: "",
  dateGmt: "2016-05-01 17:00:00", date: "2016-05-01 10:00:00", modifiedGmt: "2016-05-02 01:02:03", categories: ["News", "Fun & funny", "news"], thumbnailId: null,
};

describe("truncateSlug", () => {
  it("keeps short slugs, cuts long ones at a hyphen, strips trailing hyphens", () => {
    expect(truncateSlug("short-slug")).toBe("short-slug");
    const long = "building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic-demons-became-the-focus";
    expect(truncateSlug(long)).toBe("building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic");
    expect(truncateSlug("a".repeat(79) + "-bc")).toBe("a".repeat(79));
    expect(truncateSlug("x".repeat(80) + "-y")).toBe("x".repeat(80));
  });
});

describe("finalSlugs", () => {
  it("suffixes collisions after truncation and validates the pattern", () => {
    const long = (n: string) => `building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic-demons-became-the-focus-part-${n}`;
    const m = finalSlugs([{ slug: "ok" }, { slug: long("1") }, { slug: long("2") }]);
    expect(m.get("ok")).toBe("ok");
    expect(m.get(long("1"))).toBe("building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic");
    expect(m.get(long("2"))).toBe("building-a-better-mousetrap-from-chumps-to-champs-how-the-tiny-little-panic-2");
    expect(() => finalSlugs([{ slug: "Bad Slug" }])).toThrow(/Bad Slug/);
  });
});

describe("wpDateToIso", () => {
  it("parses GMT and falls back to the local date for the zero sentinel", () => {
    expect(wpDateToIso("2016-05-01 17:00:00", "2016-05-01 10:00:00")).toBe("2016-05-01T17:00:00.000Z");
    expect(wpDateToIso("0000-00-00 00:00:00", "2017-01-01 00:00:00")).toBe("2017-01-01T00:00:00.000Z");
    expect(() => wpDateToIso("nope", "nope")).toThrow();
  });
});

describe("assemblePost", () => {
  it("builds the row with normalized tags, decoded excerpt and ordered dates", () => {
    const row = assemblePost({ ...base, excerpt: "<p>Short &amp; sweet</p>" }, { finalSlug: "t", authorId: "u1", authorName: "Gabe", bodyMd: "Body", coverUrl: "https://b/c.jpg", status: "published" });
    expect(row).toEqual({
      slug: "t", title: "T", excerpt: "Short & sweet", body_md: "Body", cover_image_url: "https://b/c.jpg",
      tags: ["News", "Fun & funny"], status: "published", author_id: "u1", author_name: "Gabe",
      published_at: "2016-05-01T17:00:00.000Z", created_at: "2016-05-01T17:00:00.000Z", updated_at: "2016-05-02T01:02:03.000Z",
      source_url: "https://landofredemption.com/t/",
    });
  });
  it("nulls a blank excerpt, clamps updated_at to created_at, and rejects an empty title", () => {
    const row = assemblePost({ ...base, modifiedGmt: "2015-01-01 00:00:00" }, { finalSlug: "t", authorId: null, authorName: "Gabe", bodyMd: "", coverUrl: null, status: "draft" });
    expect(row.excerpt).toBeNull();
    expect(row.updated_at).toBe(row.created_at);
    expect(row.author_id).toBeNull();
    expect(() => assemblePost({ ...base, title: "  " }, { finalSlug: "t", authorId: null, authorName: "G", bodyMd: "", coverUrl: null, status: "draft" })).toThrow(/title/);
  });
});

describe("wxr-authors.json", () => {
  it("covers every export author, has unique logins, and carries the agreed emails", () => {
    const map = loadAuthorMap(join(__dirname, "../../../data/wxr-authors.json"));
    expect(map.length).toBeGreaterThanOrEqual(84);
    expect(new Set(map.map((m) => m.login)).size).toBe(map.length);
    const email = (login: string) => map.find((m) => m.login === login)?.email;
    expect(email("TimE")).toBe("baboonytim@gmail.com");
    expect(email("JaydenA")).toBe("jayden.alstad@gmail.com");
    expect(email("RobM")).toBe("robmulye@gmail.com");
    expect(email("jhendrix")).toBe("jhendrix6426@gmail.com");
    expect(email("CtheTree")).toBe("cchessbball@comcast.net");
    expect(email("kurthake")).toBe("kurthake@hotmail.com");
    expect(email("Jason")).toBe("jason.b.ricci@gmail.com");
    expect(email("thejambi")).toBe("thejambi@gmail.com");
    expect(email("Chazmaniandevil")).toBe("cjbaseball25@gmail.com");
    expect(email("Reth")).toBe("rene.thol@gmx.de");
    expect(email("Seth")).toBe("landofredemption@gmail.com");
    expect(email("admin")).toBeNull();
    expect(map.filter((m) => m.email).length).toBe(11);
  });
});
