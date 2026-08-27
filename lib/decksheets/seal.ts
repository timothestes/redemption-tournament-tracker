/**
 * Port of redemption-tournament-api/src/utilities/seal.py (generate_seal),
 * rendered as SVG instead of PIL drawing calls (see svgText.ts for the
 * renderSvgToPng spike: sharp + bundled DejaVu Sans Bold + fontconfig).
 *
 * Geometry note: PIL's `ImageDraw.ellipse(bbox, outline=..., width=w)` draws
 * the stroke *inward* from the bbox — the bbox radius is the ring's OUTER
 * edge, and the ring occupies [radius - w, radius]. SVG's circle stroke is
 * centered on `r`, so each ring below uses `r = outerRadius - width / 2` to
 * reproduce the same outer edge and inward extent.
 *
 * The deck_type -> format label mapping is ported from the two Python call
 * sites (text_to_webp.py:_apply_legality_seal, text_to_pdf.py's seal block),
 * since seal.py itself only uppercases whatever `deck_format` string it's
 * given: `deck_format = "Type 2" if deck_type == "type_2" else "Type 1"`.
 */
import { renderSvgToPng } from "./svgText";

export interface RenderSealOptions {
  deckType: string;
  isLegal: boolean;
  sizePx: number;
}

const FOREST_GREEN = "rgb(34, 139, 34)";
const DARK_RED = "rgb(180, 30, 30)";

function formatLabel(deckType: string): string {
  return deckType === "type_2" ? "TYPE 2" : "TYPE 1";
}

export async function renderSealPng(opts: RenderSealOptions): Promise<Buffer> {
  const { deckType, isLegal, sizePx: size } = opts;

  const center = Math.floor(size / 2);
  const radius = center - 4;
  const borderWidth = Math.max(Math.floor(size / 25), 3);

  const color = isLegal ? FOREST_GREEN : DARK_RED;
  const statusText = isLegal ? "LEGAL" : "ILLEGAL";
  const formatText = formatLabel(deckType);

  // Outer circle: bbox radius `radius`, stroke width `borderWidth`, alpha 210/255.
  const outerStrokeAlpha = 210 / 255;
  const outerR = radius - borderWidth / 2;

  // Inner circle: bbox radius `innerRadius`, stroke width `innerWidth`.
  const innerGap = borderWidth + Math.max(Math.floor(size / 40), 2);
  const innerRadius = radius - innerGap;
  const innerWidth = Math.max(Math.floor(borderWidth / 2), 2);
  const innerR = innerRadius - innerWidth / 2;

  // Semi-transparent fill disc.
  const fillRadius = innerRadius - Math.max(Math.floor(size / 50), 1);
  const fillAlpha = 35 / 255;

  // Font sizes.
  const statusFontSize = isLegal ? Math.floor(size * 0.16) : Math.floor(size * 0.13);
  const formatFontSize = Math.floor(size * 0.12);

  // Format label (top half): ink-bottom sits `0.06 * size` above center.
  const formatY = center - size * 0.06;
  // Status text (bottom half): ink-top sits `0.02 * size` below center.
  const statusY = center + size * 0.02 + statusFontSize * 0.72;

  const formatAlpha = 180 / 255;
  const statusAlpha = 210 / 255;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${center}" cy="${center}" r="${outerR}" fill="none" stroke="${color}" stroke-opacity="${outerStrokeAlpha}" stroke-width="${borderWidth}" />
    <circle cx="${center}" cy="${center}" r="${innerR}" fill="none" stroke="${color}" stroke-opacity="${outerStrokeAlpha}" stroke-width="${innerWidth}" />
    <circle cx="${center}" cy="${center}" r="${fillRadius}" fill="${color}" fill-opacity="${fillAlpha}" />
    <text x="${center}" y="${formatY}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="${formatFontSize}" fill="${color}" fill-opacity="${formatAlpha}">${formatText}</text>
    <text x="${center}" y="${statusY}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="${statusFontSize}" fill="${color}" fill-opacity="${statusAlpha}">${statusText}</text>
  </svg>`;

  return renderSvgToPng(svg);
}
