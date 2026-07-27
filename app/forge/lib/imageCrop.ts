// Server-only: crop an already-normalized forge art image (upright JPEG,
// ≤1050px — see imageNormalize.ts) to a fractional rect. No trim pass here:
// re-running the corner-gated trim could eat a crop with white corners.
import sharp from "sharp";
import type { CropRect } from "@/app/forge/lib/cropPreview";

export type { CropRect };

const MIN_CROP_PX = 32;
const MAX_HEIGHT = 1050;
const JPEG_QUALITY = 85;

/** Clamp a fractional crop rect into [0,1]; null when it isn't a usable rect. Pure. */
export function clampCropRect(rect: unknown): CropRect | null {
  if (typeof rect !== "object" || rect === null) return null;
  const r = rect as Record<string, unknown>;
  if (![r.x, r.y, r.width, r.height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const x = Math.min(Math.max(r.x as number, 0), 1);
  const y = Math.min(Math.max(r.y as number, 0), 1);
  const width = Math.min(Math.max(r.width as number, 0), 1 - x);
  const height = Math.min(Math.max(r.height as number, 0), 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export async function cropCardImage(
  input: Buffer,
  rect: CropRect
): Promise<{ data: Buffer; contentType: "image/jpeg" }> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image");
  const left = Math.round(rect.x * meta.width);
  const top = Math.round(rect.y * meta.height);
  const width = Math.min(Math.round(rect.width * meta.width), meta.width - left);
  const height = Math.min(Math.round(rect.height * meta.height), meta.height - top);
  if (width < MIN_CROP_PX || height < MIN_CROP_PX) throw new Error("Crop too small");
  const data = await sharp(input)
    .extract({ left, top, width, height })
    .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { data, contentType: "image/jpeg" };
}
