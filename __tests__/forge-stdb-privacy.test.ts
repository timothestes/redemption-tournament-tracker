import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schemaSrc = readFileSync(
  join(process.cwd(), "spacetimedb/src/schema.ts"),
  "utf8"
);

function tableOptions(name: string): string {
  // Grab the options object literal of `table({ name: '<name>' ... }` up to the
  // closing brace before the columns object.
  const idx = schemaSrc.indexOf(`name: '${name}'`);
  expect(idx, `table ${name} must exist in schema.ts`).toBeGreaterThan(-1);
  const start = schemaSrc.lastIndexOf("table(", idx);
  const end = schemaSrc.indexOf("},", idx);
  return schemaSrc.slice(start, end);
}

describe("forge STDB privacy guardrails", () => {
  it("forge_config is PRIVATE (no public: true)", () => {
    expect(tableOptions("forge_config")).not.toContain("public: true");
  });
  it("forge_seat_auth is PRIVATE (no public: true)", () => {
    expect(tableOptions("forge_seat_auth")).not.toContain("public: true");
  });
  it("forge_game marker exists and is public (clients must branch on it)", () => {
    expect(tableOptions("forge_game")).toContain("public: true");
  });
});
