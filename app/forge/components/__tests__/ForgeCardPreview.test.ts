import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { RECTS } from "@/app/forge/lib/frameGeometry";
import { textFit, TEXT_METRICS } from "@/app/forge/lib/textFit";

const render = (card: Parameters<typeof ForgeCardPreview>[0]["card"]) =>
  renderToStaticMarkup(React.createElement(ForgeCardPreview, { card }));
const statText = (html: string, stat: string) => {
  const m = html.match(new RegExp(`<text([^>]*)>${stat.replace("/", "\\/")}</text>`));
  if (!m) throw new Error(`no stat text ${stat}`);
  return m[1];
};

describe("ForgeCardPreview title", () => {
  it("draws the name as a dark copy offset to the lower right under a white face with a hairline edge", () => {
    const html = render({ name: "Michael, Dragon Slayer", cardType: ["Hero"], brigades: ["Silver"], strength: 12, toughness: 8 });
    const texts = [...html.matchAll(/<text([^>]*)>Michael, Dragon Slayer<\/text>/g)].map((m) => m[1]);
    expect(texts).toHaveLength(2);
    const [shadow, face] = texts;
    expect(shadow).toMatch(/fill="#231f20"/);
    expect(shadow).toMatch(/transform="translate\(3 3\)"/);
    expect(face).toMatch(/fill="#fff"/);
    expect(face).not.toMatch(/transform=/);
    // the old uniform 2.8 px outline is gone
    expect(face).not.toMatch(/stroke-width="2.8"/);
    expect(Number(face.match(/stroke-width="([\d.]+)"/)![1])).toBeLessThan(1.5);
  });
});

describe("ForgeCardPreview stats", () => {
  it("prints stats without an outline, at one size, with digit tops just under the box top", () => {
    const hero = statText(render({ cardType: ["Hero"], brigades: ["Blue"], strength: 11, toughness: 9 }), "11/9");
    expect(hero).not.toMatch(/stroke/);
    expect(hero).toMatch(/font-size="41"/);
    expect(hero).toMatch(new RegExp(`y="${RECTS.leftBox.y + 34}"`));
    expect(hero).toMatch(/fill="#fff"/);
    // "10/11" prints at the same size as "9/6" — the box has room.
    expect(statText(render({ cardType: ["Hero"], brigades: ["Blue"], strength: 10, toughness: 11 }), "10/11")).toMatch(/font-size="41"/);
  });
  it("uses dark digits on a light box, still without an outline", () => {
    const white = statText(render({ cardType: ["Hero"], brigades: ["White"], strength: 5, toughness: 2 }), "5/2");
    expect(white).toMatch(/fill="#231f20"/);
    expect(white).not.toMatch(/stroke/);
  });
});

// A long ability and a verse, neither carrying a character React escapes, so the rendered
// markup can be matched against the strings textFit wrapped.
const WORDY = {
  name: "As Rob Anderson Intended",
  cardType: ["Artifact"] as const,
  brigades: [],
  identifiers: ["Idol"],
  rawText: "All characters, enhancements and lost souls in play lose their abilities. All characters, enhancements, and lost souls played this turn lose their abilities. Limit 2 turns.",
  scripture: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  reference: "John 3:16",
};
const textAttrs = (html: string, content: string) => {
  const m = html.match(new RegExp(`<text([^>]*)>${content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  if (!m) throw new Error(`no <text> for ${JSON.stringify(content)}`);
  return m[1];
};
const textY = (html: string, content: string) => Number(textAttrs(html, content).match(/ y="([\d.]+)"/)![1]);

describe("ForgeCardPreview zoom safety", () => {
  // WebKit multiplies container-query units by the page-zoom factor a second time, so a
  // Safari reader with a remembered per-site zoom saw cqw-sized text overrun the text box.
  // Everything scales through the SVG viewBox instead; nothing may go back to cqw.
  it("sizes nothing in container units", () => {
    const html = render(WORDY);
    expect(html).not.toMatch(/\d\s*cq(w|i|h|b|min|max)\b/);
    expect(html).not.toMatch(/container-type|containerType/);
  });

  it("draws each wrapped ability line as its own canvas text, one printed pitch apart", () => {
    const html = render(WORDY);
    const lines = textFit(WORDY).paragraphs.flat();
    expect(lines.length).toBeGreaterThan(3);
    const ys = lines.map((line) => textY(html, line));
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(TEXT_METRICS.ability.pitch, 6);
    expect(textAttrs(html, lines[0])).toMatch(new RegExp(`font-size="${TEXT_METRICS.ability.size}"`));
  });

  it("stretches the word spaces of every verse line but the last, as justified print does", () => {
    const html = render(WORDY);
    const lines = textFit(WORDY).verseLines;
    expect(lines.length).toBeGreaterThan(1);
    const ys = lines.map((line) => textY(html, line));
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(TEXT_METRICS.verse.pitch, 6);
    for (const line of lines.slice(0, -1)) expect(textAttrs(html, line)).toMatch(/word-spacing="[\d.]+"/);
    expect(textAttrs(html, lines[lines.length - 1])).not.toMatch(/word-spacing/);
  });

  it("keeps the last verse line on the printed reference line", () => {
    const html = render(WORDY);
    const lines = textFit(WORDY).verseLines;
    // the last line's box bottom is TEXT_METRICS.verse.bottom below the text box top
    const last = textY(html, lines[lines.length - 1]);
    const boxBottom = RECTS.textBox.y + TEXT_METRICS.verse.bottom;
    expect(boxBottom - last).toBeGreaterThan(0);
    expect(boxBottom - last).toBeLessThan(TEXT_METRICS.verse.pitch);
  });
});
