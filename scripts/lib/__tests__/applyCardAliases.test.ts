import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyCardAliases } = require("../applyCardAliases");
const { cardNameStem: stemJs } = require("../cardText");
import { CARDS } from "@/lib/cards/lookup";
import { cardNameStem } from "@/lib/cards/cardIdentity";
import { ALIAS_FORBIDDEN_RE, ALIAS_MAX_LENGTH, aliasShapeError } from "@/app/admin/catalog/lib/aliasShared";
import { cardNameKey } from "@/lib/cards/nameKey";

const CATALOG = [
  { name: "Love at First Sight (LoC)", set: "LoC", type: "Good Enhancement", imgFile: "loc-149" },
  { name: "Love at First Sight", set: "Pat", type: "Good Enhancement", imgFile: "pat-love" },
  { name: "Son of God (J)", set: "Wa", type: "Hero", imgFile: "wa-sog" },
];

const run = (aliases: unknown) => applyCardAliases(CATALOG, { aliases });

describe("applyCardAliases", () => {
  it("keeps a well-formed alias and sorts the output by key", () => {
    const { aliases, errors } = run([
      { alias: "SoG", name: "Son of God (J)", set: "Wa" },
      { alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" },
    ]);
    expect(errors).toEqual([]);
    expect(aliases.map((a: { alias: string }) => a.alias)).toEqual(["LAFS", "SoG"]);
  });

  it("tolerates an overlay with no aliases key at all", () => {
    expect(applyCardAliases(CATALOG, {})).toEqual({ aliases: [], errors: [], warnings: [] });
  });

  it("rejects an alias whose target left the catalog", () => {
    const { aliases, errors } = run([{ alias: "GONE", name: "No Such Card", set: "ZZZ" }]);
    expect(aliases).toEqual([]);
    expect(errors.join(" ")).toMatch(/orphan alias.*No Such Card\|ZZZ/);
  });

  it("rejects an alias whose target matches two catalog rows", () => {
    const dupes = [...CATALOG, { name: "Son of God (J)", set: "Wa", type: "Hero", imgFile: "other" }];
    const { errors } = applyCardAliases(dupes, { aliases: [{ alias: "SoG", name: "Son of God (J)", set: "Wa" }] });
    expect(errors.join(" ")).toMatch(/ambiguous alias/);
  });

  it("rejects two aliases that normalize to the same key", () => {
    const { aliases, errors } = run([
      { alias: "LAFS", name: "Love at First Sight (LoC)", set: "LoC" },
      { alias: " lafs ", name: "Love at First Sight", set: "Pat" },
    ]);
    expect(aliases).toHaveLength(1);
    expect(errors.join(" ")).toMatch(/duplicate alias/);
  });

  it("rejects an alias that shadows a real card name", () => {
    const { aliases, errors } = run([{ alias: "son of god (j)", name: "Love at First Sight (LoC)", set: "LoC" }]);
    expect(aliases).toEqual([]);
    expect(errors.join(" ")).toMatch(/shadow/i);
  });

  it("rejects an alias that shadows a card name stem", () => {
    // "Son of God" is nobody's printed name, but it is the stem [[mentions]] match on.
    const { errors } = run([{ alias: "Son of God", name: "Love at First Sight (LoC)", set: "LoC" }]);
    expect(errors.join(" ")).toMatch(/shadow/i);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["bracketed", "LA[FS]"],
    ["pipe-separated", "LA|FS"],
    ["newlined", "LA\nFS"],
    ["over-long", "x".repeat(ALIAS_MAX_LENGTH + 1)],
    ["single-character", "Q"],
  ])("rejects an %s alias", (_label, alias) => {
    const { aliases, errors } = run([{ alias, name: "Love at First Sight (LoC)", set: "LoC" }]);
    expect(aliases).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("rejects a row whose fields are not strings", () => {
    expect(run([{ alias: 7, name: "Love at First Sight (LoC)", set: "LoC" }]).errors).toHaveLength(1);
  });
});

describe("scripts/lib/cardNameStem drift guard", () => {
  it("matches the TypeScript twin for every card in the catalog", () => {
    const mismatches = CARDS.filter((c) => stemJs(c.name, c.type) !== cardNameStem(c.name, c.type));
    expect(mismatches.map((c) => c.name)).toEqual([]);
  });
});

describe("alias-rule drift guard", () => {
  // The editor validates in the browser, the codegen validates at build time.
  // They are separate implementations because Next code cannot require scripts/.
  const CASES = ["LAFS", "la fs", "", "   ", "Q", " Q ", "AB", "LA[FS", "LA]FS", "LA|FS", "LA\nFS", "LA\tFS", "x".repeat(41), "x".repeat(40)];

  it("agrees with the editor on every alias shape", () => {
    const js = require("../applyCardAliases");
    expect(js.ALIAS_MAX_LENGTH).toBe(ALIAS_MAX_LENGTH);
    expect(js.ALIAS_FORBIDDEN_RE.source).toBe(ALIAS_FORBIDDEN_RE.source);
    for (const alias of CASES) {
      expect(js.aliasShapeError(alias), `disagreed on ${JSON.stringify(alias)}`).toBe(aliasShapeError(alias));
    }
  });
});

describe("scripts/lib/cardNameKey drift guard", () => {
  it("matches the TypeScript twin for every card name in the catalog", () => {
    const { cardNameKey: keyJs } = require("../cardText");
    const mismatches = CARDS.filter((c) => keyJs(c.name) !== cardNameKey(c.name));
    expect(mismatches.map((c) => c.name)).toEqual([]);
  });
});
