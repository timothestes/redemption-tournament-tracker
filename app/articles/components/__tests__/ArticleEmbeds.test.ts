import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ArticleBody from "../ArticleBody";
import type { ArticleRefs } from "../../lib/refTypes";
import type { DeckEmbedData } from "@/lib/decks/embed";

// CardTile renders next/image, which wants Next's runtime config; a plain img
// is enough to assert on markup here.
vi.mock("next/image", () => ({
  default: (props: { src: string; alt: string }) => createElement("img", { src: props.src, alt: props.alt }),
}));

const ID = "8b1a6d5a-1b6e-4d5e-9f2a-3c4d5e6f7a8b";
const DECK: DeckEmbedData = {
  id: ID,
  name: "Throne Room Control",
  format: "Type 1",
  username: "tim",
  cardCount: 3,
  reserveCount: 1,
  groups: [
    { label: "Dominants", count: 1, cards: [{ name: "Son of God (J)", set: "J", imgFile: "Son_of_God_(J)", quantity: 1, type: "Dominant" }] },
    { label: "Heroes", count: 2, cards: [{ name: "Moses (Pi)", set: "Pi", imgFile: "Moses", quantity: 2, type: "Hero" }] },
  ],
  reserve: [{ name: "Herod", set: "X", imgFile: "Herod", quantity: 1, type: "Evil Character" }],
};

const render = (markdown: string, refs?: ArticleRefs, draft?: boolean) =>
  renderToStaticMarkup(createElement(ArticleBody, { markdown, refs, draft }));

describe("card mentions", () => {
  it("render as plain text when nothing was resolved", () => {
    const html = render("Play [[Son of God]] early.");
    expect(html).toContain("<p>Play <span>Son of God</span> early.</p>");
    expect(html).not.toContain("<button");
  });

  it("render as an interactive button when resolved", () => {
    const refs: ArticleRefs = { cards: { "son of god": { name: "Son of God (J)", imgFile: "Son_of_God_(J)" } }, decks: {} };
    const html = render("Play [[ son of god ]] early.", refs);
    expect(html).toMatch(/<button[^>]*class="card-mention[^"]*"[^>]*>son of god<\/button>/);
    expect(html).not.toContain("[[");
  });

  it("work inside emphasis and list items, not inside code or links", () => {
    const refs: ArticleRefs = { cards: { x: { name: "X", imgFile: "X" } }, decks: {} };
    const html = render("**[[X]]**\n\n- [[X]]\n\n`[[X]]`\n\n[[[X]]](https://example.com)", refs);
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain("<code>[[X]]</code>");
    expect(html).toMatch(/<a href="https:\/\/example.com"[^>]*>\[X\]<\/a>|<a href="https:\/\/example.com"[^>]*>\[\[X\]\]<\/a>/);
  });

  it("flag an unresolved mention only in draft mode", () => {
    expect(render("[[Typo Card]]", undefined, true)).toContain("No card named");
    expect(render("[[Typo Card]]")).not.toContain("No card named");
  });
});

describe("deck embeds", () => {
  const url = `https://landofredemption.com/decklist/${ID}`;

  it("keep the link when nothing was resolved", () => {
    const html = render(`Intro.\n\n${url}\n\nOutro.`);
    expect(html).toContain(`<p><a href="${url}"`);
    expect(html).not.toContain("<figure");
  });

  it("render the grouped deck when resolved", () => {
    const html = render(`Intro.\n\n${url}\n\nOutro.`, { cards: {}, decks: { [ID]: DECK } });
    expect(html).toContain("<figure");
    expect(html).not.toMatch(/<p[^>]*>\s*<figure/);
    expect(html).toContain("Throne Room Control");
    expect(html).toContain("Type 1 · 3 cards + 1 reserve · by tim");
    expect(html).toContain("Dominants");
    expect(html).toContain("Reserve");
    expect(html).toContain(`href="/decklist/${ID}"`);
    expect(html).toContain("×2");
  });

  it("explain an unavailable deck instead of showing a bare link", () => {
    const html = render(url, { cards: {}, decks: { [ID]: null } });
    expect(html).toContain("This deck isn’t available");
    expect(html).toContain(`href="/decklist/${ID}"`);
  });

  it("leave a deck link inside a sentence as a link", () => {
    const html = render(`See ${url} for the list.`, { cards: {}, decks: { [ID]: DECK } });
    expect(html).not.toContain("<figure");
    expect(html).toContain(`href="${url}"`);
  });
});
