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
      "[![](https://x/v-1024.png)](https://x/full.png)\n*Cap & tion*",
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
      "[2022-10-20-vsJohnE.mp3](https://x/2022-10-20-vsJohnE.mp3)\n*Audio version.*",
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
});

describe("measureMarkdown", () => {
  it("counts images, links and embeds and lists residual html and external hosts", () => {
    const s = measureMarkdown(
      "![a](https://blob.test/wp/a.jpg) ![b](https://lh7.googleusercontent.com/x) [l](https://x)\n\nhttps://youtu.be/abc\n\n<div>left</div>\n\n```\n<not counted>\n```",
      "https://blob.test",
    );
    expect(s).toEqual({ images: 2, links: 1, embeds: 1, residualHtml: ["<div>"], residualMarkers: [], externalImageHosts: ["lh7.googleusercontent.com"] });
  });
  it("flags leftover WordPress markers", () => {
    expect(measureMarkdown("<!-- wp:paragraph --> [youtube]x[/youtube]", "https://b").residualMarkers).toEqual(["<!-- wp:", "[youtube]"]);
  });
});
