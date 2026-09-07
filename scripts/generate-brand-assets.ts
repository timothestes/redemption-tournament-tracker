/**
 * One-off: renders the default OG card from the LoR wordmark
 * (public/brand/lor-wordmark.webp). Output is committed; re-run only if the
 * wordmark changes. Usage: npx tsx scripts/generate-brand-assets.ts
 *
 * An app-icon derivation was attempted and dropped — deriving a square icon
 * needs a dedicated square mark asset, not a crop of this wordmark.
 */
import sharp from "sharp";

const WORDMARK = "public/brand/lor-wordmark.webp";
const BG = { r: 19, g: 19, b: 22, alpha: 1 }; // #131316 — near-black, matches dark theme

async function og() {
  const mark = await sharp(WORDMARK).resize({ width: 760 }).png().toBuffer();
  const m = await sharp(mark).metadata();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: BG } })
    .composite([{
      input: mark,
      left: Math.round((1200 - (m.width ?? 760)) / 2),
      top: Math.round((630 - (m.height ?? 206)) / 2),
    }])
    .png()
    .toFile("app/opengraph-image.png");
}

og().then(() => console.log("wrote app/opengraph-image.png"));
