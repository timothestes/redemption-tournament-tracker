import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Every official category has a DERIVED name (date + tier + category +
// location) that planEventTypeChange regenerates on any Settings save, so a
// free-form rename is at best overwritten and at worst destructive:
// renameForEventType reads the event date back off the "{Mon D, YYYY}" prefix
// of the current name, and a name without that prefix falls through to
// created_at (UTC), shifting an evening US event forward a day.
//
// The gate is therefore a rule about entry points, not about one component:
// anything that can open the rename modal has to consult isNameFrozen first.
// This repo has no ESLint, so a static scan is the guardrail.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}

describe("tournament rename gate", () => {
  it("every file that opens EditTournamentNameModal also checks isNameFrozen", () => {
    const roots = ["app", "components"].map((d) => join(process.cwd(), d));
    const offenders = roots
      .flatMap(walk)
      // The modal's own definition doesn't open anything.
      .filter((file) => !file.endsWith(join("components", "ui", "EditTournamentNameModal.tsx")))
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        return src.includes("EditTournamentNameModal") && !src.includes("isNameFrozen");
      });
    expect(
      offenders,
      `these open the rename modal without an isNameFrozen gate:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
