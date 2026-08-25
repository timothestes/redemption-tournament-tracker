import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderSealPng } from "../seal";

describe("renderSealPng", () => {
  it("renders a square PNG at the requested size with alpha", async () => {
    const png = await renderSealPng({ deckType: "type_1", isLegal: true, sizePx: 200 });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    expect(meta.hasAlpha).toBe(true);
  });

  it("legal and illegal seals differ (color + text)", async () => {
    const a = await renderSealPng({ deckType: "type_2", isLegal: true, sizePx: 120 });
    const b = await renderSealPng({ deckType: "type_2", isLegal: false, sizePx: 120 });
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
