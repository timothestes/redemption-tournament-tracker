import { describe, expect, it } from "vitest";
import { htmlToMarkdown, measureMarkdown } from "../toMarkdown";

const md = (html: string) => htmlToMarkdown(html).markdown;

describe("htmlToMarkdown", () => {
  it("emits an embed wrapper as a bare URL paragraph", () => {
    expect(md('<p>Before</p><figure class="wp-block-embed is-type-video"><div class="wp-block-embed__wrapper">\nhttps://youtu.be/nt36jZqco2Y\n</div></figure><p>After</p>')).toBe(
      "Before\n\nhttps://youtu.be/nt36jZqco2Y\n\nAfter",
    );
  });
  it("turns a YouTube iframe into a watch URL and reports other iframes", () => {
    const r = htmlToMarkdown('<iframe width="560" src="https://www.youtube.com/embed/XqBkP-TcfeU" allowfullscreen></iframe><iframe src="https://example.com/x"></iframe>');
    expect(r.markdown).toBe("https://www.youtube.com/watch?v=XqBkP-TcfeU");
    expect(r.removedIframes).toEqual(["https://example.com/x"]);
  });
  it("renders an image figure with link and caption", () => {
    expect(md('<figure class="wp-block-image size-large"><a href="https://x/full.png"><img src="https://x/v-1024.png" alt=""/></a><figcaption>Cap &amp; tion</figcaption></figure>')).toBe(
      "[![](https://x/v-1024.png)](https://x/full.png)  \n*Cap & tion*",
    );
    expect(md('<figure><img src="https://x/a.jpg" alt="Alt"/></figure>')).toBe("![Alt](https://x/a.jpg)");
    expect(md('<figure><a href="https://x/a.jpg"><img src="https://x/a.jpg" alt=""/></a></figure>')).toBe("![](https://x/a.jpg)");
  });
  it("renders a gallery as one image per line", () => {
    expect(md('<figure class="wp-block-gallery"><ul><li class="blocks-gallery-item"><figure><img src="https://x/1.jpg" alt=""/></figure></li><li><figure><img src="https://x/2.jpg" alt="two"/></figure></li></ul></figure>')).toBe(
      "![](https://x/1.jpg)\n\n![two](https://x/2.jpg)",
    );
  });
  it("renders a file block as one link and drops the PDF object and download button", () => {
    expect(md('<div class="wp-block-file"><object class="wp-block-file__embed" data="https://x/a.pdf" type="application/pdf"></object><a id="wp-block-file--media-1" href="https://x/a.pdf">Winners</a><a href="https://x/a.pdf" class="wp-block-file__button" download>Download</a></div>')).toBe(
      "[Winners](https://x/a.pdf)",
    );
  });
  it("renders audio as a link paragraph with its caption", () => {
    expect(md('<figure class="wp-block-audio"><audio controls src="https://x/2022-10-20-vsJohnE.mp3"></audio><figcaption>Audio version.</figcaption></figure>')).toBe(
      "[2022-10-20-vsJohnE.mp3](https://x/2022-10-20-vsJohnE.mp3)  \n*Audio version.*",
    );
    expect(md('<p><audio src="https://x/a.mp3"></audio></p>')).toBe("[a.mp3](https://x/a.mp3)");
  });
  it("turns accordion items into headings and drops the icons", () => {
    expect(md('<div class="wp-block-getwid-accordion"><div class="wp-block-getwid-accordion__header-wrapper"><span class="wp-block-getwid-accordion__header"><a href="#"><span class="wp-block-getwid-accordion__header-title">Agur: Nativity</span><span class="wp-block-getwid-accordion__icon is-active"><i class="fas fa-plus"></i></span></a></span></div><div class="wp-block-getwid-accordion__content-wrapper"><div class="wp-block-getwid-accordion__content"><p>Body</p></div></div></div>')).toBe(
      "### Agur: Nativity\n\nBody",
    );
  });
  it("renders buttons as links, demotes h1, drops src-less images, keeps code and tables", () => {
    expect(md('<div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link" href="https://r/register">Pre-register</a></div></div>')).toBe("[Pre-register](https://r/register)");
    expect(md("<h1>Top</h1><h2>Sub</h2>")).toBe("## Top\n\n## Sub");
    expect(md('<p>a <img alt="x"/> b</p>')).toMatch(/^a\s+b$/);
    expect(md('<pre class="wp-block-code"><code>1 Chariot\n2 Fire &#91;x]</code></pre>')).toBe("```\n1 Chariot\n2 Fire [x]\n```");
    expect(md("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>")).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
  it("keeps line breaks in deck lists and collapses blank runs", () => {
    expect(md('<p><a class="wp-live-preview" href="https://x/l.jpg">Levi</a><br />\n<a href="https://x/e.jpg">Ehud</a></p>\n\n\n\n<p>End</p>')).toMatch(
      /^\[Levi\]\(https:\/\/x\/l\.jpg\)  \n ?\[Ehud\]\(https:\/\/x\/e\.jpg\)\n\nEnd$/,
    );
  });
  it("keeps a captioned embed's URL and caption as separate paragraphs", () => {
    expect(md('<figure class="wp-block-embed is-type-video"><div class="wp-block-embed__wrapper">\nhttps://youtu.be/abc123\n</div><figcaption>Round 3 feature match</figcaption></figure>')).toBe(
      "https://youtu.be/abc123\n\n*Round 3 feature match*",
    );
  });
  it("turns a YouTube iframe inside an embed wrapper into a watch URL", () => {
    expect(md('<figure class="wp-block-embed is-type-video"><div class="wp-block-embed__wrapper"><iframe src="https://www.youtube.com/embed/XqBkP-TcfeU"></iframe></div></figure>')).toBe(
      "https://www.youtube.com/watch?v=XqBkP-TcfeU",
    );
  });
  it("drops a non-YouTube iframe inside an embed wrapper and reports it instead of losing it silently", () => {
    const r = htmlToMarkdown('<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><iframe src="https://example.com/x"></iframe></div></figure>');
    expect(r.markdown).toBe("");
    expect(r.removedIframes).toEqual(["https://example.com/x"]);
  });
  it("does not report an iframe with no src", () => {
    expect(htmlToMarkdown("<iframe></iframe>").removedIframes).toEqual([]);
  });
  it("escapes hand-built link/caption text and wraps a URL containing a space", () => {
    expect(md('<div class="wp-block-file"><a href="https://x/a.pdf">Nationals [2019 Winners</a></div>')).toBe(
      "[Nationals \\[2019 Winners](https://x/a.pdf)",
    );
    expect(md('<figure><img src="https://x/a.jpg" alt=""/><figcaption>Rated 5 * out of 5</figcaption></figure>')).toBe(
      "![](https://x/a.jpg)  \n*Rated 5 \\* out of 5*",
    );
    expect(md('<div class="wp-block-file"><a href="https://x/Winners (2019).pdf">Winners</a></div>')).toBe(
      "[Winners](<https://x/Winners (2019).pdf>)",
    );
  });
  it("emits a classic-editor bare URL paragraph unescaped", () => {
    expect(md("<p>https://youtu.be/Rfn_VkOGm7o</p>")).toBe("https://youtu.be/Rfn_VkOGm7o");
  });
  it("normalises a shortcode-derived self-linked bare URL paragraph", () => {
    expect(md('<p><a href="https://youtu.be/x_y">https://youtu.be/x_y</a></p>')).toBe("https://youtu.be/x_y");
  });
  it("still escapes underscores when a paragraph has more than a bare URL", () => {
    expect(md("<p>Watch here: https://youtu.be/x_y</p>")).toBe("Watch here: https://youtu.be/x\\_y");
  });
  it("converts a WordPress table (all <td>, no heading row) instead of keeping raw HTML", () => {
    expect(md('<table class="has-fixed-layout"><tbody><tr><td><strong>BLUE</strong></td><td><strong>GOLD</strong></td></tr><tr><td>Genesis</td><td>Joshua</td></tr></tbody></table>')).toBe(
      "| **BLUE** | **GOLD** |\n| --- | --- |\n| Genesis | Joshua |",
    );
  });
  it("leaves a table that already has a heading row to the gfm plugin", () => {
    expect(md("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>")).toBe(
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
  });
  it("keeps a row on one line when a cell contains a line break", () => {
    expect(md("<table><tbody><tr><td>Deck<br>List</td><td>Owner</td></tr><tr><td>a<br />b</td><td>Tim</td></tr></tbody></table>")).toBe(
      "| Deck List | Owner |\n| --- | --- |\n| a b | Tim |",
    );
  });
  it("drops a table whose cells are all empty", () => {
    expect(md('<table class="has-fixed-layout"><tbody><tr><td></td><td rowspan="2"></td></tr></tbody></table>')).toBe("");
  });
});

describe("measureMarkdown", () => {
  it("counts images, links and embeds and lists residual html and external hosts", () => {
    const s = measureMarkdown(
      "![a](https://blob.test/wp/a.jpg) ![b](https://lh7.googleusercontent.com/x) [l](https://x)\n\nhttps://youtu.be/abc\n\n<div>left</div>\n\n```\n<not counted>\n```",
      "https://blob.test",
    );
    expect(s).toEqual({ images: 2, links: 1, embeds: 1, residualHtml: ["<div>"], residualMarkers: [], externalImageHosts: ["lh7.googleusercontent.com"] });
  });
  it("flags leftover WordPress markers whether or not turndown escaped their brackets", () => {
    expect(measureMarkdown("<!-- wp:paragraph --> [youtube]x[/youtube]", "https://b").residualMarkers).toEqual(["<!-- wp:", "[youtube"]);
    // What a surviving shortcode actually looks like in the output: turndown escapes the brackets.
    expect(measureMarkdown('\\[youtube width="720"\\]x\\[/youtube\\]', "https://b").residualMarkers).toEqual(["\\[youtube"]);
    expect(measureMarkdown("\\[caption id=\"x\"\\]y\\[/caption\\]", "https://b").residualMarkers).toEqual(["\\[caption"]);
    expect(measureMarkdown("Deck list [2022] stays", "https://b").residualMarkers).toEqual([]);
  });
  it("does not count an angle-bracketed link or image destination as residual HTML", () => {
    const s = measureMarkdown('[Winners](<https://x/Winners (2019).pdf>) ![a](<https://x/a b.jpg>) [email](<mailto:g@x.com?subject=Email from LoR> "Click here")', "https://blob.test");
    expect(s.residualHtml).toEqual([]);
    expect(s.links).toBe(2);
  });
  it("skips an unparseable image URL instead of throwing", () => {
    expect(() => measureMarkdown("![x](http://)", "https://blob.test")).not.toThrow();
    expect(measureMarkdown("![x](http://)", "https://blob.test").externalImageHosts).toEqual([]);
  });
  it("counts protocol-relative and root-relative images as unmirrored", () => {
    const s = measureMarkdown("![a](//cdn.example.com/x.jpg) ![b](/uploads/y.jpg)", "https://blob.test");
    expect(s.externalImageHosts).toEqual(["cdn.example.com", "(relative)"]);
  });
});
