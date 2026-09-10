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
