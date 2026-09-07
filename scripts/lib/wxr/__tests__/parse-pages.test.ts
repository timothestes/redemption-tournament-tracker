import { describe, expect, it } from "vitest";
import { parseWxr } from "../parse";

const WXR = `<?xml version="1.0"?>
<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <item>
    <title>A Post</title><link>https://example.com/a-post/</link>
    <wp:post_id>10</wp:post_id><wp:post_name><![CDATA[a-post]]></wp:post_name>
    <wp:post_type><![CDATA[post]]></wp:post_type><wp:status><![CDATA[publish]]></wp:status>
    <dc:creator><![CDATA[tim]]></dc:creator><content:encoded><![CDATA[<p>post body</p>]]></content:encoded>
    <excerpt:encoded><![CDATA[]]></excerpt:encoded>
    <wp:post_date_gmt>2020-01-01 00:00:00</wp:post_date_gmt><wp:post_date>2020-01-01 00:00:00</wp:post_date>
    <wp:post_modified_gmt>2020-01-01 00:00:00</wp:post_modified_gmt>
  </item>
  <item>
    <title>A Page</title><link>https://example.com/a-page/</link>
    <wp:post_id>20</wp:post_id><wp:post_name><![CDATA[a-page]]></wp:post_name>
    <wp:post_type><![CDATA[page]]></wp:post_type><wp:status><![CDATA[publish]]></wp:status>
    <dc:creator><![CDATA[tim]]></dc:creator><content:encoded><![CDATA[<p>page body</p>]]></content:encoded>
    <excerpt:encoded><![CDATA[]]></excerpt:encoded>
    <wp:post_date_gmt>2021-01-01 00:00:00</wp:post_date_gmt><wp:post_date>2021-01-01 00:00:00</wp:post_date>
    <wp:post_modified_gmt>2021-01-01 00:00:00</wp:post_modified_gmt>
  </item>
</channel></rss>`;

describe("parseWxr postType", () => {
  it("defaults to posts only", () => {
    const out = parseWxr(WXR);
    expect(out.posts.map((p) => p.slug)).toEqual(["a-post"]);
  });
  it("selects pages when asked", () => {
    const out = parseWxr(WXR, { postType: "page" });
    expect(out.posts.map((p) => p.slug)).toEqual(["a-page"]);
    expect(out.posts[0].wpId).toBe("20");
  });
});
