import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { RECTS } from "@/app/forge/lib/frameGeometry";

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
