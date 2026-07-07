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

/**
 * Dark JPEG scan with small near-white rounded-corner squares (passes the
 * corner gate, like real Lackey scans) plus a thin pure-white fringe band
 * across the bottom — models the print-scan artifact the trim floor exists
 * to ignore.
 */
async function lackeyScanWithCornersAndBottomFringe(
  width: number,
  height: number,
  cornerSize: number,
  fringeHeight: number,
): Promise<Buffer> {
  const corner = await sharp({ create: { width: cornerSize, height: cornerSize, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const fringe = await sharp({ create: { width, height: fringeHeight, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: DARK } })
    .composite([
      { input: corner, top: 0, left: 0 },
      { input: corner, top: 0, left: width - cornerSize },
      { input: corner, top: height - cornerSize, left: 0 },
      { input: corner, top: height - cornerSize, left: width - cornerSize },
      { input: fringe, top: height - fringeHeight, left: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * Dark content block centered on a white canvas, plus several small
 * light-gray (rgb 200,200,200) rectangles scattered in the margins outside
 * the content block — models watermark text (e.g. "Cactus Game Design")
 * baked into card-tool export margins. Gray min-channel (~200) sits above
 * INK_MAX_CHANNEL, so these marks must not affect the ink bounding box.
 */
async function withWatermarkedMargins(
  canvasW: number,
  canvasH: number,
  contentW: number,
  contentH: number,
): Promise<Buffer> {
  const content = await sharp({ create: { width: contentW, height: contentH, channels: 3, background: DARK } }).png().toBuffer();
  const contentLeft = Math.floor((canvasW - contentW) / 2);
  const contentTop = Math.floor((canvasH - contentH) / 2);
  const wmW = 40;
  const wmH = 12;
  const watermark = await sharp({ create: { width: wmW, height: wmH, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .png()
    .toBuffer();
  const marks = [
    { top: 5, left: 100 }, // near top edge, above the content block
    { top: canvasH - wmH - 5, left: 100 }, // near bottom edge, below the content block
    { top: contentTop + 20, left: 5 }, // left margin
    { top: contentTop + 20, left: canvasW - wmW - 5 }, // right margin
  ];
  return sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: "#ffffff" } })
    .composite([
      { input: content, top: contentTop, left: contentLeft },
      ...marks.map((m) => ({ input: watermark, top: m.top, left: m.left })),
    ])
    .png()
    .toBuffer();
}

/** Dark content block flush against the bottom edge of the canvas (no bottom
 * margin at all), horizontally centered so all four single-pixel corners
 * stay white and the corner gate still passes. */
async function withFlushBottomContent(
  canvasW: number,
  canvasH: number,
  contentW: number,
  contentH: number,
): Promise<Buffer> {
  const content = await sharp({ create: { width: contentW, height: contentH, channels: 3, background: DARK } }).png().toBuffer();
  const left = Math.floor((canvasW - contentW) / 2);
  const top = canvasH - contentH;
  return sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: "#ffffff" } })
    .composite([{ input: content, top, left }])
    .png()
    .toBuffer();
}

/** True when the center pixel of the buffer's bottom-most row is dark
 * ("ink"), independent of imageNormalize's internal INK_MAX_CHANNEL. */
async function bottomRowHasInk(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const channels = Math.min(3, info.channels);
  const y = info.height - 1;
  const x = Math.floor(info.width / 2);
  const i = (y * info.width + x) * info.channels;
  for (let c = 0; c < channels; c++) {
    if (data[i + c] >= 180) return false;
  }
  return true;
}

describe("normalizeCardImage", () => {
  it("trims white print-bleed margins to the ink box (+10px pad) and re-encodes as JPEG", async () => {
    // v2: crop is the ink bounding box + a uniform 10px pad, not a bare trim
    // of the content block. Cropped dims are content + 2*pad (750+20 x
    // 1046+20 = 770x1066); but 1066 exceeds MAX_HEIGHT (1050), so the
    // pipeline's existing height cap resizes the crop down to 1050 tall
    // (~758 wide) — a resize this exact fixture never triggered under v1,
    // since the bare trim (1046) was already under the cap. This is a
    // legitimate emergent interaction between the new pad and the pre-existing
    // MAX_HEIGHT cap, not a bug.
    const input = await withWhiteMargins(815, 1125, 750, 1046);
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(out.contentType).toBe("image/jpeg");
    expect(d.format).toBe("jpeg");
    expect(d.height).toBe(1050);
    expect(Math.abs((d.width ?? 0) - 758)).toBeLessThanOrEqual(4);
  });

  it("ignores light-gray watermark text scattered in the margins (ink box, not sharp trim)", async () => {
    // The headline v2 case: watermark marks sit outside the content block but
    // well above INK_MAX_CHANNEL, so they must not widen or otherwise disturb
    // the ink bounding box. Expect the same content+pad framing as a clean
    // white margin, symmetric on both axes (not flush to one edge).
    const input = await withWatermarkedMargins(815, 1125, 705, 1018);
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(out.contentType).toBe("image/jpeg");
    expect(Math.abs((d.width ?? 0) - 725)).toBeLessThanOrEqual(6);
    expect(Math.abs((d.height ?? 0) - 1038)).toBeLessThanOrEqual(6);
  });

  it("preserves content flush against the bottom edge (pad clamps, no ink lost)", async () => {
    // Content touches the canvas's bottom edge with no bottom margin at all;
    // the pad clamps to 0 there instead of losing any ink. Output height
    // should be content height + top pad + 0 bottom pad, and the bottom-most
    // row of the output must still be dark (the card's bottom border).
    const input = await withFlushBottomContent(700, 1000, 500, 900);
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.height ?? 0).toBeGreaterThanOrEqual(900);
    expect(Math.abs((d.height ?? 0) - 910)).toBeLessThanOrEqual(4);
    expect(await bottomRowHasInk(out.data)).toBe(true);
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
    // axis — not degenerate). Comparing the crop result against the raw,
    // pre-rotation meta.width/meta.height (the bug) instead of the swapped
    // post-rotation dimensions makes this look degenerate (it isn't) and the
    // crop gets skipped, leaving the full untrimmed 1000x700 canvas.
    // v2: expected dims are content + 2*pad (650+20 x 500+20), not the bare
    // content dims, since the guards still run against the post-rotation
    // 1000x700 baseline either way.
    const stored = await withWhiteMargins(700, 1000, 500, 650);
    const input = await withOrientation(stored, 6);
    const out = await normalizeCardImage(input);
    const m = await sharp(out.data).metadata();
    expect(m.orientation).toBeUndefined();
    expect(Math.abs((m.width ?? 0) - 670)).toBeLessThanOrEqual(4);
    expect(Math.abs((m.height ?? 0) - 520)).toBeLessThanOrEqual(4);
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
    // v2: same content+pad framing as the RGB case (750+20 x 1046+20), and
    // the same MAX_HEIGHT-cap interaction (1066 > 1050 resizes down to
    // 1050x~758) — see the equivalent RGB test above for why.
    const rgb = await withWhiteMargins(815, 1125, 750, 1046);
    const input = await sharp(rgb).greyscale().toColourspace("b-w").png().toBuffer();
    const out = await normalizeCardImage(input);
    const d = await dims(out.data);
    expect(d.format).toBe("jpeg");
    expect(d.height).toBe(1050);
    expect(Math.abs((d.width ?? 0) - 758)).toBeLessThanOrEqual(4);
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

  it("returns real-scan JPEGs with rounded corners and a thin fringe byte-identical (trim significance floor)", async () => {
    // Models a 345x495 Lackey scan: near-white rounded-corner squares pass
    // the corner gate, and a ~1.8%-of-height (9px) near-white fringe along
    // the bottom would trim under the old logic — defeating the passthrough
    // for every already-conforming image. The significance floor rejects
    // trims removing less than 3% on both axes, so this must come back
    // untouched, byte-identical.
    const input = await lackeyScanWithCornersAndBottomFringe(345, 495, 8, 9);
    const out = await normalizeCardImage(input);
    expect(out.data.equals(input)).toBe(true);
    expect(out.contentType).toBe("image/jpeg");
  });
});
