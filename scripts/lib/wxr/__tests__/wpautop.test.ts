import { describe, expect, it } from "vitest";
import { wpautop } from "../wpautop";

describe("wpautop", () => {
  it("wraps bare paragraphs and turns single newlines into <br />", () => {
    expect(wpautop("Line one\nLine two\n\nPara two")).toBe("<p>Line one<br />\nLine two</p>\n\n<p>Para two</p>");
  });
  it("leaves block-level chunks alone and splits around them", () => {
    expect(wpautop("<h3>Heroes</h3>\n<a href=\"x\">Levi</a>\n<a href=\"y\">Ehud</a>")).toBe(
      '<h3>Heroes</h3>\n\n<p><a href="x">Levi</a><br />\n<a href="y">Ehud</a></p>',
    );
  });
  it("keeps existing <p> and <pre> content untouched", () => {
    expect(wpautop("<p>Already</p>\n\n<pre>a\nb</pre>")).toBe("<p>Already</p>\n\n<pre>a\nb</pre>");
  });
  it("normalises CRLF and drops empty chunks", () => {
    expect(wpautop("a\r\n\r\n\r\nb")).toBe("<p>a</p>\n\n<p>b</p>");
    expect(wpautop("   ")).toBe("");
  });
});
