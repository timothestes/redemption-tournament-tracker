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

/** Re-tags an image with an EXIF orientation value without touching its pixel data. */
function withOrientation(buf: Buffer, orientation: number): Promise<Buffer> {
  return sharp(buf).withMetadata({ orientation }).toBuffer();
}

/** Dark canvas with a pure-white strip across the top only (bottom corners stay dark). */
async function darkWithWhiteTopStrip(canvasW: number, canvasH: number, stripH: number): Promise<Buffer> {
  const strip = await sharp({ create: { width: canvasW, height: stripH, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: DARK } })
    .composite([{ input: strip, top: 0, left: 0 }])
    .png()
    .toBuffer();
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

  it("re-encodes EXIF-rotated (orientation 6) images upright and height-caps them", async () => {
    // Solid color, so corners stay dark and the trim path is never engaged —
    // this isolates the orientation-aware resize/passthrough handling.
    const input = await withOrientation(await solid(1300, 700, "jpeg"), 6);
    const out = await normalizeCardImage(input);
    const m = await sharp(out.data).metadata();
    expect(out.data.equals(input)).toBe(false); // must be re-encoded, not passed through
    expect(m.format).toBe("jpeg");
    expect(m.orientation).toBeUndefined(); // upright: no leftover orientation tag
    expect(m.height).toBe(1050);
    expect(Math.abs((m.width ?? 0) - 565)).toBeLessThanOrEqual(2);
  });

  it("trims legitimate margins on EXIF-rotated images using post-rotation dimensions (swapped-axis degenerate guard)", async () => {
    // Stored (pre-rotation) canvas is 700x1000 with content 500x650; tagged
    // orientation 6 so .rotate() swaps axes to a post-rotation 1000x700
    // canvas containing 650x500 content (legitimate ~65-70% keep on each
    // axis — not degenerate). Comparing the trim result against the raw,
    // pre-rotation meta.width/meta.height (the bug) instead of the swapped
    // post-rotation dimensions makes this look degenerate (it isn't) and the
    // trim gets skipped, leaving the full untrimmed 1000x700 canvas.
    const stored = await withWhiteMargins(700, 1000, 500, 650);
    const input = await withOrientation(stored, 6);
    const out = await normalizeCardImage(input);
    const m = await sharp(out.data).metadata();
    expect(m.orientation).toBeUndefined();
    expect(m.width).toBe(650);
    expect(m.height).toBe(500);
  });

  it("trims white margins on grayscale (low-channel) rasters without misreading channels", async () => {
    // Intent test for the cornersNearWhite channel-count fix: a grayscale
    // raster piped through the same margin fixture used above. Note: sharp's
    // default output colourspace is srgb (verified against the installed
    // version), so in practice the raw buffer read by cornersNearWhite ends
    // up 3-channel here regardless of the source's channel depth — this test
    // cannot force a true <3-channel raw buffer through the public
    // Buffer-in/Buffer-out API, but it does confirm grayscale-sourced inputs
    // still trim correctly (no regression), per the fix's intent.
    const rgb = await withWhiteMargins(815, 1125, 750, 1046);
    const input = await sharp(rgb).greyscale().toColourspace("b-w").png().toBuffer();
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.format).toBe("jpeg");
    expect(Math.abs((d.width ?? 0) - 750)).toBeLessThanOrEqual(4);
    expect(Math.abs((d.height ?? 0) - 1046)).toBeLessThanOrEqual(4);
  });

  it("does not trim when only some corners are white (corner gate requires all four)", async () => {
    // A white strip across the top only: top corners are white but bottom
    // corners stay dark. An unconditional trim would crop the top strip; the
    // corner gate must reject this and leave the image untouched.
    const input = await darkWithWhiteTopStrip(600, 800, 100);
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.width).toBe(600);
    expect(d.height).toBe(800);
  });
});
