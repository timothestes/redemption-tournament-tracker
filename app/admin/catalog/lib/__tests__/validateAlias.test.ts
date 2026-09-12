import { describe, it, expect } from "vitest";
import { validateAlias } from "../validateAlias";
import { ALIAS_MAX_LENGTH } from "../aliasShared";

const err = (alias: string, existing: string[] = []) => {
  const r = validateAlias(alias, existing);
  return r.ok === false ? r.error : null;
};

describe("validateAlias", () => {
  it("accepts a short nickname and keeps the curator's casing", () => {
    const r = validateAlias("LAFS", []);
    expect(r).toEqual({ ok: true, alias: "LAFS" });
  });

  it("collapses runs of whitespace", () => {
    expect(validateAlias("  the   CoH ", [])).toEqual({ ok: true, alias: "the CoH" });
  });

  it("rejects an alias that is already a card's printed name", () => {
    expect(err("Son of God (J)")).toMatch(/already/i);
  });

  it("rejects an alias that is already a card name stem", () => {
    // Nothing is printed "Son of God", but that is what [[mentions]] match on.
    expect(err("son of god")).toMatch(/already/i);
  });

  it("rejects an alias another card already claims", () => {
    expect(err("lafs", ["LAFS"])).toMatch(/in use/i);
  });

  it("ignores case and spacing when checking for a claimed alias", () => {
    expect(err("  LaFs  ", ["lafs"])).toMatch(/in use/i);
  });

  it.each([
    ["blank", "   "],
    ["bracketed", "LA[FS]"],
    ["piped", "LA|FS"],
    ["over-long", "x".repeat(ALIAS_MAX_LENGTH + 1)],
  ])("rejects a %s alias", (_label, alias) => {
    expect(err(alias)).toBeTruthy();
  });

  it("rejects a single character, which the card picker can never search", () => {
    expect(err("Q")).toMatch(/two characters/i);
  });

  it("accepts two characters", () => {
    expect(validateAlias("AB", []).ok).toBe(true);
  });

  it("accepts an alias at exactly the length limit", () => {
    expect(validateAlias("x".repeat(ALIAS_MAX_LENGTH), []).ok).toBe(true);
  });
});
