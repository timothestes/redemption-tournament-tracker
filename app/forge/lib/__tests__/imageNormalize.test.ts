import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { normalizeCardImage } from "../imageNormalize";

const DARK = { r: 60, g: 20, b: 20 };

/** Solid dark block, encoded as requested. */
function solid(width: number, height: number, format: "png" | "jpeg"): Promise<Buffer> {
  const img = sharp({ create: { width, height, channels: 3, background: DARK } });
  return format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 90 }).toBuffer();
}

/** Dark content block centered on a white canvas (print-bleed style). */
async function withWhiteMargins(canvasW: number, canvasH: number, contentW: number, contentH: number): Promise<Buffer> {
  const content = await sharp({ create: { width: contentW, height: contentH, channels: 3, background: DARK } }).png().toBuffer();
  return sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: "#ffffff" } })
    .composite([{ input: content, top: Math.floor((canvasH - contentH) / 2), left: Math.floor((canvasW - contentW) / 2) }])
    .png()
    .toBuffer();
}

async function dims(buf: Buffer): Promise<{ width?: number; height?: number; format?: string }> {
  const m = await sharp(buf).metadata();
  return { width: m.width, height: m.height, format: m.format };
}

describe("normalizeCardImage", () => {
  it("trims white print-bleed margins and re-encodes as JPEG", async () => {
    const input = await withWhiteMargins(815, 1125, 750, 1046);
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(out.contentType).toBe("image/jpeg");
    expect(d.format).toBe("jpeg");
    expect(Math.abs((d.width ?? 0) - 750)).toBeLessThanOrEqual(4);
    expect(Math.abs((d.height ?? 0) - 1046)).toBeLessThanOrEqual(4);
  });

  it("does not trim full-bleed images with dark corners (corner gate)", async () => {
    const input = await solid(700, 980, "png");
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.width).toBe(700);
    expect(d.height).toBe(980);
    expect(d.format).toBe("jpeg"); // PNG input is still re-encoded
  });

  it("downscales oversized images to 1050px tall, preserving aspect", async () => {
    const input = await solid(750, 1500, "png");
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.height).toBe(1050);
    expect(d.width).toBe(525);
  });

  it("returns already-conforming JPEGs byte-identical (no generation loss)", async () => {
    const input = await solid(345, 495, "jpeg");
    const out = await normalizeCardImage(input);
    expect(out.data.equals(input)).toBe(true);
    expect(out.contentType).toBe("image/jpeg");
  });

  it("keeps original dimensions when trim would be degenerate (near-all-white input)", async () => {
    const input = await withWhiteMargins(600, 800, 50, 50); // tiny dot on white
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.width).toBe(600);
    expect(d.height).toBe(800);
  });

  it("throws on undecodable input", async () => {
    await expect(normalizeCardImage(Buffer.from("not an image"))).rejects.toThrow();
  });
});
