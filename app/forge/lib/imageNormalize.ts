// Server-only: normalizes Forge card images at upload time so every stored
// image is flush (no baked-in print-bleed margins), at most 1050px tall, and
// JPEG-encoded. Design: docs/superpowers/specs/2026-07-06-forge-image-normalization-design.md
import sharp, { type Sharp, type OutputInfo } from "sharp";

export type NormalizedImage = { data: Buffer; contentType: "image/jpeg" };

const MAX_HEIGHT = 1050;
const CORNER_WHITE_MIN = 240; // per-channel floor for a corner to count as "white margin"
const INK_MAX_CHANNEL = 180; // min-available-channel ceiling for a pixel to count as "ink"; light watermark gray (~200+) stays below this and is ignored
const TRIM_PAD_PX = 10; // uniform padding added around the ink bounding box before cropping
const MIN_TRIM_RATIO = 0.6; // trim keeping less than this per axis is degenerate
const MIN_TRIM_FRACTION = 0.03; // trim removing less than this on every axis is noise (e.g. scan fringes), not a real margin
const JPEG_QUALITY = 85;

type Raster = { data: Buffer; info: OutputInfo };

/** Raw pixel buffer of the flattened (alpha->white) image, read once and
 * reused for both the corner-white gate and the ink bounding box below. */
function readRaster(img: Sharp): Promise<Raster> {
  return img.clone().flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
}

function channelsAt(raster: Raster, x: number, y: number): number[] {
  const { data, info } = raster;
  const channels = Math.min(3, info.channels); // grayscale rasters have < 3 channels
  const i = (y * info.width + x) * info.channels;
  return Array.from({ length: channels }, (_, c) => data[i + c]);
}

/** True when all four corners are near-white after flattening alpha onto white. */
function cornersNearWhite(raster: Raster): boolean {
  const { info } = raster;
  return [
    channelsAt(raster, 0, 0),
    channelsAt(raster, info.width - 1, 0),
    channelsAt(raster, 0, info.height - 1),
    channelsAt(raster, info.width - 1, info.height - 1),
  ].every((corner) => corner.every((channel) => channel >= CORNER_WHITE_MIN));
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * Bounding box of every "ink" pixel (min available channel < INK_MAX_CHANNEL),
 * padded uniformly by TRIM_PAD_PX and clamped to the raster bounds. Light
 * watermark gray sits well above INK_MAX_CHANNEL, so watermarked margins
 * never widen the box; card borders/arcs sit well below it, so they're never
 * cut. Returns null when there is no ink at all (nothing to trim against).
 */
function inkBoundingBox(raster: Raster): Box | null {
  const { data, info } = raster;
  const channels = Math.min(3, info.channels);
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    const rowOffset = y * info.width * info.channels;
    for (let x = 0; x < info.width; x++) {
      const i = rowOffset + x * info.channels;
      let min = 255;
      for (let c = 0; c < channels; c++) {
        if (data[i + c] < min) min = data[i + c];
      }
      if (min < INK_MAX_CHANNEL) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // no ink pixels found
  return {
    left: Math.max(0, minX - TRIM_PAD_PX),
    top: Math.max(0, minY - TRIM_PAD_PX),
    width: Math.min(info.width, maxX + 1 + TRIM_PAD_PX) - Math.max(0, minX - TRIM_PAD_PX),
    height: Math.min(info.height, maxY + 1 + TRIM_PAD_PX) - Math.max(0, minY - TRIM_PAD_PX),
  };
}

export async function normalizeCardImage(input: Buffer): Promise<NormalizedImage> {
  const meta = await sharp(input).metadata(); // throws on undecodable input
  if (!meta.width || !meta.height) throw new Error("Could not read image");
  const base = sharp(input).rotate(); // apply EXIF orientation

  // EXIF orientations 5-8 turn the image 90°, so the base pipeline's output
  // dimensions are transposed relative to meta.width/meta.height (which
  // describe the pre-rotation raster). Compare trim output against these
  // post-rotation dimensions, not the raw stored ones.
  const orientationSwapsAxes =
    meta.orientation !== undefined && meta.orientation >= 5 && meta.orientation <= 8;
  const baseWidth = orientationSwapsAxes ? meta.height : meta.width;
  const baseHeight = orientationSwapsAxes ? meta.width : meta.height;

  // Corner-gated margin trim: white print-bleed margins only. Full-bleed card
  // images have dark frame corners, so the gate skips them and the border
  // ring survives; cropping against an explicit white background can never
  // eat a dark frame either way.
  let working: Sharp | null = null;
  let trimmed = false;
  const raster = await readRaster(base);
  if (cornersNearWhite(raster)) {
    const box = inkBoundingBox(raster);
    if (box) {
      const shrank = box.width < baseWidth || box.height < baseHeight;
      const degenerate =
        box.width < baseWidth * MIN_TRIM_RATIO || box.height < baseHeight * MIN_TRIM_RATIO;
      const significant =
        box.width <= baseWidth * (1 - MIN_TRIM_FRACTION) ||
        box.height <= baseHeight * (1 - MIN_TRIM_FRACTION);
      if (shrank && !degenerate && significant) {
        working = base.clone().flatten({ background: "#ffffff" }).extract(box);
        trimmed = true;
      }
    }
  }

  // Passthrough: already JPEG, small enough, upright, nothing trimmed — return
  // the original bytes so re-runs and the backfill cause no generation loss.
  const upright = meta.orientation === undefined || meta.orientation === 1;
  if (!trimmed && meta.format === "jpeg" && meta.height <= MAX_HEIGHT && upright) {
    return { data: input, contentType: "image/jpeg" };
  }

  const data = await (working ?? base)
    .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { data, contentType: "image/jpeg" };
}
