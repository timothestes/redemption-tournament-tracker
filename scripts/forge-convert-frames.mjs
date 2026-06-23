// One-time: convert the consumed Elements PNGs to WebP (the .png are git-ignored).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = "public/forge/frames/Elements";
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".png")) {
      const out = p.replace(/\.png$/, ".webp");
      sharp(p).webp({ quality: 82 }).toFile(out)
        .then(() => console.log("✓", out))
        .catch((e) => console.error("✗", p, e.message));
    }
  }
}
walk(ROOT);
