import { describe, expect, it } from "vitest";
import { preprocess } from "../preprocess";

const blocks = new Map<string, string>([
  ["14682", '<!-- wp:paragraph -->\n<p><strong>Sponsors</strong></p>\n<!-- /wp:paragraph -->'],
  ["9", '<!-- wp:block {"ref":14682} /-->'],
]);

describe("preprocess", () => {
  it("inlines reusable blocks recursively and reports unknown refs", () => {
    const r = preprocess('<!-- wp:block {"ref":9} /--><!-- wp:block {"ref":404} /-->', blocks);
    expect(r.html).toBe("\n<p><strong>Sponsors</strong></p>\n");
    expect(r.unknownRefs).toEqual(["404"]);
    expect(r.classic).toBe(false);
  });
  it("inlines a reusable block ref whose JSON payload carries extra keys, and reports an unknown ref the same way", () => {
    const withExtra = preprocess('<!-- wp:block {"ref":14682,"align":"wide"} /-->', blocks);
    expect(withExtra.html).toBe("\n<p><strong>Sponsors</strong></p>\n");
    const unknownWithExtra = preprocess('<!-- wp:block {"ref":404,"align":"wide"} /-->', blocks);
    expect(unknownWithExtra.unknownRefs).toEqual(["404"]);
  });
  it("turns a grimlock section into a link paragraph", () => {
    const r = preprocess(
      '<!-- wp:grimlock/section {"thumbnail":15169,"title":"Episode 81","subtitle":"","text":"","button_text":"Listen Here","button_link":"thethreshingfloor.podbean.com/e/ep-81/"} /-->',
      blocks,
    );
    expect(r.html).toBe('<p><a href="https://thethreshingfloor.podbean.com/e/ep-81/">Episode 81 — Listen Here</a></p>');
    expect(preprocess('<!-- wp:grimlock/section {"title":"Solo"} /-->', blocks).html).toBe("<p><strong>Solo</strong></p>");
  });
  it("drops spacer, countdown, rss and empty audio blocks and counts them", () => {
    const r = preprocess(
      '<!-- wp:spacer {"height":"40px"} -->\n<div style="height:40px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer --><!-- wp:audio /--><!-- wp:rss {"feedURL":"x"} /--><!-- wp:paragraph --><p>Keep</p><!-- /wp:paragraph -->',
      blocks,
    );
    expect(r.html).toBe("<p>Keep</p>");
    expect(r.dropped).toEqual({ spacer: 1, "audio(empty)": 1, rss: 1 });
  });
  it("expands youtube, embed and caption shortcodes", () => {
    const r = preprocess(
      '[youtube]https://www.youtube.com/watch?v=65hEWhb2S8E[/youtube]\n\n[caption id="attachment_5479" align="aligncenter" width="600"]<img class="size-full" src="https://landofredemption.com/wp-content/uploads/2016/08/PG.jpg" alt="Alt" width="600" height="429" /> Members at Nationals[/caption]\n\nSet list [2022] stays',
      blocks,
    );
    expect(r.classic).toBe(true);
    expect(r.html).toBe(
      '<p><a href="https://www.youtube.com/watch?v=65hEWhb2S8E">https://www.youtube.com/watch?v=65hEWhb2S8E</a></p>\n\n<figure><img class="size-full" src="https://landofredemption.com/wp-content/uploads/2016/08/PG.jpg" alt="Alt" width="600" height="429" /><figcaption>Members at Nationals</figcaption></figure>\n\n<p>Set list [2022] stays</p>',
    );
  });
  it("expands youtube and embed shortcodes that carry attributes, and leaves lookalike shortcodes alone", () => {
    const r = preprocess('[youtube width="720" height="480"]https://www.youtube.com/watch?v=jm4qtVfr3wQ[/youtube]', blocks);
    expect(r.html).toBe('<p><a href="https://www.youtube.com/watch?v=jm4qtVfr3wQ">https://www.youtube.com/watch?v=jm4qtVfr3wQ</a></p>');
    expect(preprocess('[embed width="640"]https://youtu.be/abc123[/embed]', blocks).html).toBe(
      '<p><a href="https://youtu.be/abc123">https://youtu.be/abc123</a></p>',
    );
    expect(preprocess("<p>[youtube_thumb]https://x/y[/youtube_thumb]</p>", blocks).html).toBe("<p>[youtube_thumb]https://x/y[/youtube_thumb]</p>");
  });
  it("removes more-markers and every remaining block comment, then wpautops classic content", () => {
    const r = preprocess("Intro\n\n<!--more-->\n\n<strong>Heroes</strong>\nLevi", blocks);
    expect(r.html).toBe("<p>Intro</p>\n\n<p><strong>Heroes</strong><br />\nLevi</p>");
    const g = preprocess("<!-- wp:more -->\n<!--more-->\n<!-- /wp:more -->\n<!-- wp:paragraph -->\n<p>G</p>\n<!-- /wp:paragraph -->", blocks);
    expect(g.classic).toBe(false);
    expect(g.html.trim()).toBe("<p>G</p>");
  });
});
