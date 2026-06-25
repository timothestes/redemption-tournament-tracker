import { describe, it, expect } from "vitest";
import { artExt, artFileName } from "@/app/forge/lib/setArtwork";

describe("artExt", () => {
  it("maps known image content types", () => {
    expect(artExt("image/png")).toBe("png");
    expect(artExt("image/webp")).toBe("webp");
    expect(artExt("image/jpeg")).toBe("jpg");
  });
  it("falls back to 'img' for unknown types", () => {
    expect(artExt("application/octet-stream")).toBe("img");
    expect(artExt("")).toBe("img");
  });
});

describe("artFileName", () => {
  it("builds {NN}_{slug}.{ext} with a zero-padded sequence", () => {
    expect(artFileName(1, "Angel of the Lord", "png")).toBe("01_angel-of-the-lord.png");
    expect(artFileName(12, "Goliath!", "webp")).toBe("12_goliath.webp");
  });
  it("pads sequences beyond 99 without truncating", () => {
    expect(artFileName(100, "X", "png")).toBe("100_x.png");
  });
  it("falls back to 'card' when the name has no slug characters", () => {
    expect(artFileName(3, "   ", "png")).toBe("03_card.png");
    expect(artFileName(4, "!!!", "png")).toBe("04_card.png");
  });
});
