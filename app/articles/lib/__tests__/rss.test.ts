import { describe, it, expect } from "vitest";
import { buildRss, escapeXml } from "../rss";
import type { PublicPost } from "../queries";

const post = (over: Partial<PublicPost> = {}): PublicPost => ({
  id: "11111111-1111-1111-1111-111111111111",
  slug: "hello-world",
  title: "Hello & <World>",
  excerpt: null,
  body_md: "# Heading\n\nFirst **para** here.",
  cover_image_url: null,
  tags: ["news"],
  status: "published",
  author_id: "22222222-2222-2222-2222-222222222222",
  author_name: null,
  published_at: "2026-09-05T12:00:00.000Z",
  author: { username: "TimE" },
  ...over,
});

describe("escapeXml", () => {
  it("escapes the five XML specials", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });

  it("strips XML-illegal control characters", () => {
    expect(escapeXml("Hello\x0BWorld")).toBe("HelloWorld");
  });
});

describe("buildRss", () => {
  it("emits a valid channel with escaped items and the excerpt fallback", () => {
    const xml = buildRss([post()], "https://redemptionccg.app");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<title>Hello &amp; &lt;World&gt;</title>");
    expect(xml).toContain("<link>https://redemptionccg.app/articles/hello-world</link>");
    expect(xml).toContain('<guid isPermaLink="true">https://redemptionccg.app/articles/hello-world</guid>');
    expect(xml).toContain("<pubDate>Sat, 05 Sep 2026 12:00:00 GMT</pubDate>");
    expect(xml).toContain("<dc:creator>TimE</dc:creator>");
    expect(xml).toContain("<description>Heading First para here.</description>");
    expect(xml).toContain('<atom:link href="https://redemptionccg.app/articles/feed.xml" rel="self"');
  });

  it("prefers an explicit excerpt", () => {
    const xml = buildRss([post({ excerpt: "Custom blurb" })], "https://s");
    expect(xml).toContain("<description>Custom blurb</description>");
  });

  it("prefers author_name over the profile username", () => {
    const xml = buildRss([post({ author_name: "Jayden" })], "https://s");
    expect(xml).toContain("<dc:creator>Jayden</dc:creator>");
  });

  it("handles zero posts", () => {
    expect(buildRss([], "https://s")).toContain("</channel>");
  });

  it("omits pubDate when published_at is null but keeps the title", () => {
    const xml = buildRss([post({ published_at: null })], "https://s");
    expect(xml).not.toContain("<pubDate>");
    expect(xml).toContain("<title>Hello &amp; &lt;World&gt;</title>");
  });
});
