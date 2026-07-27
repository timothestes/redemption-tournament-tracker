import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { clampCropRect, cropCardImage } from "../imageCrop";

const fixture = () =>
  sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();

describe("clampCropRect", () => {
  it("passes a valid rect through", () => {
    expect(clampCropRect({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 })).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
  });
  it("clamps out-of-range values into [0,1]", () => {
    expect(clampCropRect({ x: -0.5, y: 0, width: 2, height: 1 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
  it("rejects garbage", () => {
    expect(clampCropRect(null)).toBeNull();
    expect(clampCropRect({ x: NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(clampCropRect({ x: 1, y: 0, width: 0.5, height: 1 })).toBeNull(); // zero width after clamp
  });
});

describe("cropCardImage", () => {
  it("extracts the fractional rect in pixels", async () => {
    const out = await cropCardImage(await fixture(), { x: 0.25, y: 0, width: 0.5, height: 1 });
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
    expect(out.contentType).toBe("image/jpeg");
  });
  it("throws on a crop smaller than 32px per axis", async () => {
    await expect(cropCardImage(await fixture(), { x: 0, y: 0, width: 0.1, height: 0.1 })).rejects.toThrow(/too small/i);
  });
});
