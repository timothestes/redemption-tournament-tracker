import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SET = "app/forge/sets/[setId]";

describe("forge set settings tab", () => {
  it("SetTabs.tsx links to the Settings tab", () => {
    const src = readFileSync(join(process.cwd(), SET, "SetTabs.tsx"), "utf8");
    expect(src).toContain("/settings");
    expect(src).toContain('label: "Settings"');
  });

  it("settings/page.tsx renders all four moved panels", () => {
    const src = readFileSync(join(process.cwd(), SET, "settings/page.tsx"), "utf8");
    expect(src).toContain("<SetPrivacyPanel ");
    expect(src).toContain("<SetEldersPanel ");
    expect(src).toContain("<PlaytesterGrants ");
    expect(src).toContain("<TargetsEditor ");
  });

  it("progress/ProgressDashboard.tsx no longer renders the moved panels", () => {
    const src = readFileSync(join(process.cwd(), SET, "progress/ProgressDashboard.tsx"), "utf8");
    expect(src).not.toContain("SetPrivacyPanel");
    expect(src).not.toContain("SetEldersPanel");
    expect(src).not.toContain("TargetsEditor");
  });
});
