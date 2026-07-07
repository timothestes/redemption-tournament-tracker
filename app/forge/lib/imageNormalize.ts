// Server-only: normalizes Forge card images at upload time so every stored
// image is flush (no baked-in print-bleed margins), at most 1050px tall, and
// JPEG-encoded. Design: docs/superpowers/specs/2026-07-06-forge-image-normalization-design.md
import sharp from "sharp";

export type NormalizedImage = { data: Buffer; contentType: "image/jpeg" };

const MAX_HEIGHT = 1050;
const CORNER_WHITE_MIN = 240; // per-channel floor for a corner to count as "white margin"
const TRIM_THRESHOLD = 25;
const MIN_TRIM_RATIO = 0.6; // trim keeping less than this per axis is degenerate
const JPEG_QUALITY = 85;

/** True when all four corners are near-white after flattening alpha onto white. */
async function cornersNearWhite(img: sharp.Sharp): Promise<boolean> {
  const { data, info } = await img
    .clone()
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number): number[] => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return [
    px(0, 0),
    px(info.width - 1, 0),
    px(0, info.height - 1),
    px(info.width - 1, info.height - 1),
  ].every((corner) => corner.every((channel) => channel >= CORNER_WHITE_MIN));
}

export async function normalizeCardImage(input: Buffer): Promise<NormalizedImage> {
  const meta = await sharp(input).metadata(); // throws on undecodable input
  if (!meta.width || !meta.height) throw new Error("Could not read image");
  const base = sharp(input).rotate(); // apply EXIF orientation

  // Corner-gated margin trim: white print-bleed margins only. Full-bleed card
  // images have dark frame corners, so the gate skips them and the border
  // ring survives; trimming against an explicit white background can never
  // eat a dark frame either way.
  let working: sharp.Sharp | null = null;
  let trimmed = false;
  if (await cornersNearWhite(base)) {
    try {
      const { data, info } = await base
        .clone()
        .flatten({ background: "#ffffff" })
        .trim({ background: "#ffffff", threshold: TRIM_THRESHOLD })
        .toBuffer({ resolveWithObject: true });
      const shrank = info.width < meta.width || info.height < meta.height;
      const degenerate =
        info.width < meta.width * MIN_TRIM_RATIO || info.height < meta.height * MIN_TRIM_RATIO;
      if (shrank && !degenerate) {
        working = sharp(data);
        trimmed = true;
      }
    } catch {
      // trim of an (almost) uniform image can fail — treat as nothing to trim
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
