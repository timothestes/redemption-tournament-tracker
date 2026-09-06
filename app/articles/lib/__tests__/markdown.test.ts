import { describe, it, expect } from "vitest";
import { youtubeId, isAudioUrl, slugify, SLUG_RE, excerptFromMarkdown } from "../markdown";

describe("youtubeId", () => {
  const ID = "dQw4w9WgXcQ";
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=30s`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`  https://youtu.be/${ID}  `],
  ])("parses %s", (url) => {
    expect(youtubeId(url)).toBe(ID);
  });
  it.each([
    ["https://vimeo.com/12345"],
    ["https://example.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=short"],
    ["not a url"],
    [""],
  ])("rejects %s", (url) => {
    expect(youtubeId(url)).toBeNull();
  });
});

describe("isAudioUrl", () => {
  it.each(["a.mp3", "https://x.public.blob.vercel-storage.com/posts/1/ep.m4a", "/f.ogg?x=1", "https://h/f.WAV"])(
    "accepts %s",
    (u) => expect(isAudioUrl(u)).toBe(true),
  );
  it.each(["a.png", "https://h/f.mp4", "https://h/mp3", "", "::"])("rejects %s", (u) =>
    expect(isAudioUrl(u)).toBe(false),
  );
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => expect(slugify("Hello, World!")).toBe("hello-world"));
  it("strips diacritics", () => expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu"));
  it("drops apostrophes without splitting", () => expect(slugify("Jayden's Deck")).toBe("jaydens-deck"));
  it("collapses runs and trims", () => expect(slugify("  --a   b--  ")).toBe("a-b"));
  it("caps at 80 chars without a trailing hyphen", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
    expect(SLUG_RE.test(s)).toBe(true);
  });
  it("returns empty for nothing usable", () => expect(slugify("!!!")).toBe(""));
});

describe("excerptFromMarkdown", () => {
  it("strips markdown syntax", () => {
    const md = "# Title\n\nSome **bold** and _it_ with a [link](https://x.y) and ![img](https://i.png).\n\n> quote\n\n- item";
    expect(excerptFromMarkdown(md)).toBe("Title Some bold and it with a link and . quote item");
  });
  it("ignores bare URLs and fenced code", () => {
    expect(excerptFromMarkdown("https://youtu.be/dQw4w9WgXcQ\n\n```js\nx()\n```\n\nHello")).toBe("Hello");
  });
  it("returns short text unchanged", () => expect(excerptFromMarkdown("Short.")).toBe("Short."));
  it("cuts at a word boundary with an ellipsis", () => {
    const out = excerptFromMarkdown("alpha beta gamma delta epsilon zeta", 17);
    expect(out).toBe("alpha beta gamma…");
  });
});
