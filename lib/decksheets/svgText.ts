import path from "path";
import fs from "fs";
import os from "os";

const FONT_DIR = path.join(process.cwd(), "assets", "decksheets", "fonts");

/** Point fontconfig at the bundled DejaVu before sharp's first SVG text render. */
export function configureFontconfig(): void {
  if (process.env.FONTCONFIG_PATH) return; // already configured this instance
  const confDir = path.join(os.tmpdir(), "decksheets-fontconfig");
  fs.mkdirSync(confDir, { recursive: true });
  const template = fs.readFileSync(path.join(FONT_DIR, "fonts.conf"), "utf8");
  fs.writeFileSync(path.join(confDir, "fonts.conf"), template.replace("ASSETS_FONT_DIR", FONT_DIR));
  process.env.FONTCONFIG_PATH = confDir;
}

export async function renderSvgToPng(svg: string): Promise<Buffer> {
  configureFontconfig();
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
