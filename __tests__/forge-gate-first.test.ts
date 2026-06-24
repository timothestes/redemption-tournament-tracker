import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// /forge has no middleware — every page/layout/route must call a gate itself.
function listForgeRouteFiles(): string[] {
  const root = join(process.cwd(), "app/forge");
  return walk(root)
    .map((p) => p.replace(process.cwd() + "/", ""))
    .filter((p) => /\/(page|layout)\.tsx$/.test(p) || /\/route\.ts$/.test(p))
    .filter((p) => !p.includes("__tests__"));
}

const GATE = /require(Forge|Elder|ForgeSuperadmin)\s*\(/;
// Pure redirect with no data exposure — intentionally has no gate.
const ALLOW_NO_GATE = new Set(["app/forge/art/page.tsx"]);

describe("forge gate-first guardrail", () => {
  const files = listForgeRouteFiles().filter((f) => !ALLOW_NO_GATE.has(f));

  it("finds the forge route files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} calls a Forge gate`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(GATE.test(src), `${f} must call requireForge/requireElder/requireForgeSuperadmin`).toBe(true);
    });
  }
});
