import { describe, expect, it } from "vitest";
import { blobPathname, collectSiteFiles, mirrorUrl, rewriteUrls, siteFilePath } from "../urls";

describe("siteFilePath", () => {
  it("accepts uploads and podcasts on either host and scheme, stripping query and whitespace", () => {
    expect(siteFilePath("https://landofredemption.com/wp-content/uploads/2024/04/agur-1.png?x=1")).toBe("/wp-content/uploads/2024/04/agur-1.png");
    expect(siteFilePath("http://www.landofredemption.com/podcasts/CoW-Primer-with-John.mp3 ")).toBe("/podcasts/CoW-Primer-with-John.mp3");
    expect(siteFilePath("https://landofredemption.com/wp-content/uploads/2015/04/Shamgar_pv.jpg%20")).toBe("/wp-content/uploads/2015/04/Shamgar_pv.jpg");
  });
  it("rejects pages, other hosts and other paths", () => {
    expect(siteFilePath("https://landofredemption.com/about/")).toBeNull();
    expect(siteFilePath("https://redemptionccg.app/wp-content/uploads/x.png")).toBeNull();
    expect(siteFilePath("https://landofredemption.com/wp-content/themes/x.css")).toBeNull();
  });
});

describe("blobPathname / mirrorUrl", () => {
  it("mirrors the site path under wp/ and builds an encoded URL", () => {
    expect(blobPathname("/wp-content/uploads/2016/08/PG%20at%20Nats.jpg")).toBe("wp/wp-content/uploads/2016/08/PG at Nats.jpg");
    expect(mirrorUrl("https://blob.test", "wp/wp-content/uploads/2016/08/PG at Nats.jpg")).toBe("https://blob.test/wp/wp-content/uploads/2016/08/PG%20at%20Nats.jpg");
  });
});

describe("collectSiteFiles", () => {
  it("finds src/href site files in document order, dedupes, and adds the featured image", () => {
    const html = '<a href="https://landofredemption.com/wp-content/uploads/a.jpg"><img src="https://landofredemption.com/wp-content/uploads/a-1024x545.jpg"></a><img src=\'https://landofredemption.com/wp-content/uploads/a.jpg\'><a href="https://example.com/x.jpg">x</a>';
    expect(collectSiteFiles(html, "https://landofredemption.com/wp-content/uploads/cover.png")).toEqual([
      "/wp-content/uploads/a.jpg", "/wp-content/uploads/a-1024x545.jpg", "/wp-content/uploads/cover.png",
    ]);
  });
});

describe("rewriteUrls", () => {
  const mirror = (p: string) => (p.endsWith("missing.jpg") ? null : `https://blob.test/wp${p}`);
  const slugMap = new Map([["old-post", "old-post"], ["a-very-long-original-slug", "a-very-long"]]);
  it("rewrites mirrored site files and leaves missing ones", () => {
    expect(rewriteUrls('<img src="https://landofredemption.com/wp-content/uploads/a.jpg"><img src="https://landofredemption.com/wp-content/uploads/missing.jpg">', { mirror, slugMap })).toBe(
      '<img src="https://blob.test/wp/wp-content/uploads/a.jpg"><img src="https://landofredemption.com/wp-content/uploads/missing.jpg">',
    );
  });
  it("rewrites internal post links to /articles with the final slug and fragment", () => {
    expect(rewriteUrls('<a href="https://www.landofredemption.com/old-post/">a</a><a href="http://landofredemption.com/a-very-long-original-slug#top">b</a><a href="https://landofredemption.com/about/">c</a><a href="https://landofredemption.com/old-post/feed/">d</a>', { mirror, slugMap })).toBe(
      '<a href="/articles/old-post">a</a><a href="/articles/a-very-long#top">b</a><a href="https://landofredemption.com/about/">c</a><a href="https://landofredemption.com/old-post/feed/">d</a>',
    );
  });
  it("rewrites the sponsors page_id link to its permalink", () => {
    expect(rewriteUrls('<a href="https://landofredemption.com/?page_id=11455">s</a>', { mirror, slugMap })).toBe('<a href="https://landofredemption.com/our-sponsors/">s</a>');
  });
});
