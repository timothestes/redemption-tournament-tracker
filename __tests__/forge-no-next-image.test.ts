import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// The spec forbids next/image under app/forge/** — private Blob shares the
// storage domain family that next.config.js wildcards, so <Image> could
// CDN-cache a public optimized variant of secret art. Forge art uses plain <img>
// against the /forge/api/art proxy only. (This repo has no ESLint; this static
// scan is the CI guardrail, and it runs in the default `npm test`.)
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}

describe("Forge next/image ban", () => {
  it("no file under app/forge imports next/image", () => {
    const offenders = walk(join(process.cwd(), "app", "forge")).filter((file) => {
      const src = readFileSync(file, "utf8");
      return /from\s+["']next\/(legacy\/)?image["']/.test(src) || /["']next\/(legacy\/)?image["']/.test(src);
    });
    expect(offenders, `next/image is banned under app/forge:\n${offenders.join("\n")}`).toEqual([]);
  });
});
