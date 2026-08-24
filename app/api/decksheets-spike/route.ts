import { renderSvgToPng } from "@/lib/decksheets/svgText";

export const runtime = "nodejs";

export async function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120">
    <rect width="400" height="120" fill="#1e202b"/>
    <text x="20" y="70" font-family="DejaVu Sans" font-weight="bold" font-size="40" fill="#ffffff">M: 3.42 AoD 1.7</text>
  </svg>`;
  const png = await renderSvgToPng(svg);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
