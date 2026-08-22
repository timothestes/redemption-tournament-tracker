// Server-only: transform a Forge finished-card image into the uniform public
// catalog format — 345×495 JPEG, matching the main set exactly (§6 of the
// promote design). No trim pass here: finished images were already normalized
// at upload (imageNormalize.ts), and re-running the corner-gated trim could eat
// a legitimate white border.
import sharp, { type Sharp } from "sharp";
import {
  CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT, CARD_IMAGE_ASPECT, AUTO_RESIZE_TOLERANCE,
  PRINTER_PRESETS, type ReleaseImageTransform,
} from "./catalogRow";

const JPEG_QUALITY = 90;

export type ReleaseImageResult = {
  data: Buffer;
  contentType: "image/jpeg";
  /** How the image was produced — surfaced in the release page's progress log. */
  method: "passthrough" | "resize" | "cover" | "preset" | "crop";
  /** Source narrower than the 345px target — upscaled, quality warning. */
  upscaled: boolean;
};

export type ImageAuditInfo = {
  width: number;
  height: number;
  aspect: number;
  /** exact = byte passthrough, resize = automatic, crop = needs a decision. */
  imageClass: "exact" | "resize" | "crop";
};

/** Measure a finished image and classify it against the §6 transform rules. */
export async function auditReleaseImage(input: Buffer): Promise<ImageAuditInfo> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image");
  const aspect = meta.width / meta.height;
  let imageClass: ImageAuditInfo["imageClass"];
  if (meta.width === CARD_IMAGE_WIDTH && meta.height === CARD_IMAGE_HEIGHT && meta.format === "jpeg") {
    imageClass = "exact";
  } else if (Math.abs(aspect - CARD_IMAGE_ASPECT) / CARD_IMAGE_ASPECT <= AUTO_RESIZE_TOLERANCE) {
    imageClass = "resize";
  } else {
    imageClass = "crop";
  }
  return { width: meta.width, height: meta.height, aspect, imageClass };
}

/**
 * Produce the public 345×495 JPEG. `transform` (the stored per-card decision)
 * only matters for crop-class images; exact/near-aspect sources are automatic.
 * A crop-class image with no stored decision falls back to a center cover-crop.
 */
export async function transformReleaseImage(
  input: Buffer,
  transform: ReleaseImageTransform | null,
): Promise<ReleaseImageResult> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image");
  const upscaled = meta.width < CARD_IMAGE_WIDTH;
  const aspect = meta.width / meta.height;

  // 1. Lackey-imported passthroughs: exactly the target, already JPEG — keep the
  //    original bytes so re-runs cause no generation loss.
  const exact =
    meta.width === CARD_IMAGE_WIDTH && meta.height === CARD_IMAGE_HEIGHT && meta.format === "jpeg";
  if (exact && (!transform || transform.mode === "cover")) {
    return { data: input, contentType: "image/jpeg", method: "passthrough", upscaled: false };
  }

  const encode = (img: Sharp) =>
    img
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

  // Explicit crop decisions (printer bleed presets or a manual fractional rect).
  if (transform && transform.mode !== "cover") {
    const rect = transform.mode === "preset" ? PRINTER_PRESETS[transform.preset] : transform.rect;
    const left = Math.max(0, Math.round(rect.x * meta.width));
    const top = Math.max(0, Math.round(rect.y * meta.height));
    const width = Math.min(Math.round(rect.width * meta.width), meta.width - left);
    const height = Math.min(Math.round(rect.height * meta.height), meta.height - top);
    if (width < 32 || height < 32) throw new Error("Crop too small");
    const data = await encode(
      sharp(input)
        .extract({ left, top, width, height })
        .resize(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT, { fit: "fill" }),
    );
    return {
      data, contentType: "image/jpeg",
      method: transform.mode === "preset" ? "preset" : "crop",
      upscaled,
    };
  }

  // 2. Aspect within tolerance → plain resize (the historical script's behavior).
  if (Math.abs(aspect - CARD_IMAGE_ASPECT) / CARD_IMAGE_ASPECT <= AUTO_RESIZE_TOLERANCE) {
    const data = await encode(
      sharp(input).resize(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT, { fit: "fill" }),
    );
    return { data, contentType: "image/jpeg", method: "resize", upscaled };
  }

  // 3. Everything else: center cover-crop to card aspect (the default the audit
  //    UI shows; presets/manual crops above override it).
  const data = await encode(
    sharp(input).resize(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT, { fit: "cover", position: "centre" }),
  );
  return { data, contentType: "image/jpeg", method: "cover", upscaled };
}
