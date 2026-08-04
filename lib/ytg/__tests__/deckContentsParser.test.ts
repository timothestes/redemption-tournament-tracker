import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  parseDeckContents, buildAliasCandidates, htmlToLines, sectionHeader,
  type ParsedLine,
} from "../deckContentsParser";

// Full set_aliases seed (migration 011 L63-109) — tests must not need a DB.
const SEED: { carddata_code: string; shopify_abbrev: string }[] = [
  { carddata_code: "Ki", shopify_abbrev: "Ki" },
  { carddata_code: "Pri", shopify_abbrev: "Pi" },
  { carddata_code: "Pat", shopify_abbrev: "Pa" },
  { carddata_code: "RR", shopify_abbrev: "Roots" },
  { carddata_code: "T2C", shopify_abbrev: "TtC" },
  { carddata_code: "War", shopify_abbrev: "Wa" },
  { carddata_code: "Wom", shopify_abbrev: "Wo" },
  { carddata_code: "FoOF", shopify_abbrev: "FooF" },
  { carddata_code: "TEC", shopify_abbrev: "EC" },
  { carddata_code: "TPC", shopify_abbrev: "PC" },
  { carddata_code: "Prp", shopify_abbrev: "Pr" },
  { carddata_code: "Pmo-P1", shopify_abbrev: "Promo" },
  { carddata_code: "Pmo-P2", shopify_abbrev: "Promo" },
  { carddata_code: "Pmo-P3", shopify_abbrev: "Promo" },
  { carddata_code: "I/J+", shopify_abbrev: "I & J+" },
  { carddata_code: "K", shopify_abbrev: "K Deck" },
  { carddata_code: "K1P", shopify_abbrev: "K Deck" },
  { carddata_code: "L", shopify_abbrev: "L Deck" },
  { carddata_code: "L1P", shopify_abbrev: "L Deck" },
  { carddata_code: "A", shopify_abbrev: "A Deck" },
  { carddata_code: "B", shopify_abbrev: "B Deck" },
  { carddata_code: "C", shopify_abbrev: "C Deck" },
  { carddata_code: "D", shopify_abbrev: "D Deck" },
  { carddata_code: "E", shopify_abbrev: "E Deck" },
  { carddata_code: "F", shopify_abbrev: "F Deck" },
  { carddata_code: "G", shopify_abbrev: "G Deck" },
  { carddata_code: "H", shopify_abbrev: "H Deck" },
  { carddata_code: "I", shopify_abbrev: "I Deck" },
  { carddata_code: "J", shopify_abbrev: "J Deck" },
  { carddata_code: "CoW (AB)", shopify_abbrev: "CoW AB" },
  { carddata_code: "RoJ (AB)", shopify_abbrev: "RoJ AB" },
  { carddata_code: "Ap", shopify_abbrev: "Ap" },
  { carddata_code: "GoC", shopify_abbrev: "GoC" },
  { carddata_code: "FoM", shopify_abbrev: "FoM" },
  { carddata_code: "LoC", shopify_abbrev: "LoC" },
  { carddata_code: "Di", shopify_abbrev: "Di" },
  { carddata_code: "Wo", shopify_abbrev: "Wo" },
  { carddata_code: "AW", shopify_abbrev: "AW" },
  { carddata_code: "CoW", shopify_abbrev: "CoW" },
  { carddata_code: "II", shopify_abbrev: "II" },
  { carddata_code: "IR", shopify_abbrev: "IR" },
  { carddata_code: "PoC", shopify_abbrev: "PoC" },
  { carddata_code: "RoA", shopify_abbrev: "RoA" },
  { carddata_code: "RoA 3", shopify_abbrev: "RoA" },
  { carddata_code: "RoJ", shopify_abbrev: "RoJ" },
  { carddata_code: "TxP", shopify_abbrev: "TxP" },
];
const ALIASES = buildAliasCandidates(SEED);
const fixture = (f: string) =>
  readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const byRaw = (lines: ParsedLine[], raw: string): ParsedLine => {
  const hit = lines.find((l) => l.raw === raw);
  if (!hit) throw new Error(`line not found in parse output: ${raw}`);
  return hit;
};

describe("buildAliasCandidates", () => {
  it("reverses set_aliases into candidate LISTS (non-injective abbrevs)", () => {
    expect(ALIASES.get("promo")).toEqual(["Pmo-P1", "Pmo-P2", "Pmo-P3"]);
    expect(ALIASES.get("k deck")).toEqual(["K", "K1P"]);
    expect(ALIASES.get("l deck")).toEqual(["L", "L1P"]);
    expect(ALIASES.get("roa")).toEqual(expect.arrayContaining(["RoA", "RoA 3"]));
    expect(ALIASES.get("roa")).toHaveLength(2);
    expect(ALIASES.get("wo")).toEqual(expect.arrayContaining(["Wom", "Wo"]));
  });
  it("adds identity entries for carddata set codes (store lines use them raw)", () => {
    expect(ALIASES.get("k")).toEqual(["K"]);
    expect(ALIASES.get("poc")).toContain("PoC");
    expect(ALIASES.get("i/j+")).toContain("I/J+");
  });
});

describe("htmlToLines / sectionHeader", () => {
  it("treats <br> and </p> as line breaks, decodes entities, drops empties", () => {
    expect(htmlToLines("<p>A &amp; B<br>C&rsquo;s</p><p>&nbsp;</p><p>D</p>"))
      .toEqual(["A & B", "C’s", "D"]);
  });
  it("recognizes slash-composed section headers case-insensitively", () => {
    expect(sectionHeader("Artifacts/Covenants/Curses")).toBe("Artifacts/Covenants/Curses");
    expect(sectionHeader("FORTRESSES/SITES/CITIES")).toBe("FORTRESSES/SITES/CITIES");
    expect(sectionHeader("Lost Souls")).toBe("Lost Souls");
    expect(sectionHeader("Babylon (TtC)")).toBeNull();
    expect(sectionHeader("Deck strategy and tips:")).toBeNull();
  });
});

describe("line grammar", () => {
  it("parses qty prefixes (N), Nx, xN and defaults to 1", () => {
    const lines = parseDeckContents(
      "<p>(3) Told to Take (TtC)<br>2x Told to Take (TtC)<br>x4 Told to Take (TtC)<br>Told to Take (TtC)</p>",
      ALIASES,
    );
    expect(lines.map((l) => l.qty)).toEqual([3, 2, 4, 1]);
    expect(lines.every((l) => l.status === "resolved")).toBe(true);
    expect(lines[0].candidates[0].cardKey).toBe("Told to Take|T2C|123-Told-to-Take");
  });
  it("drops prose lines (>90 chars, no trailing paren)", () => {
    const prose = "This deck tells that story and the overall story of Judah's captivity in Babylon and beyond it".padEnd(95, "!");
    expect(parseDeckContents(`<p>${prose}</p>`, ALIASES)).toHaveLength(0);
  });
  it("flags ambiguous when BOTH parses resolve to different cards — never auto-picks", () => {
    // Handcrafted alias map: 'UL' aliases CoW, which contains "Samuel (CoW)"
    // (parse A), while "Samuel (UL)" itself is a real card in Main UL (parse B).
    const lines = parseDeckContents("<p>Samuel (UL)</p>", new Map([["ul", ["CoW"]]]));
    expect(lines).toHaveLength(1);
    expect(lines[0].status).toBe("ambiguous");
    const keys = lines[0].candidates.map((c) => c.cardKey);
    expect(keys).toContain("Samuel (CoW)|CoW|Samuel_(CoW)");
    expect(keys).toContain("Samuel (UL)|Main UL|Samuel_(UL)");
  });
});

describe("fixture: fiery-furnace.html (live store description)", () => {
  const lines = parseDeckContents(fixture("fiery-furnace.html"), ALIASES);

  it("parses exactly the 57 card lines (10 section headers + prose consumed)", () => {
    expect(lines).toHaveLength(57);
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(59); // O.T. meek is x3
    expect(lines.some((l) => l.raw.startsWith("The story of Daniel"))).toBe(false);
  });
  it("resolves 'Son of God (K)' — identity set code + embedded-set card name", () => {
    const l = byRaw(lines, "Son of God (K)");
    expect(l.qty).toBe(1);
    expect(l.status).toBe("resolved");
    expect(l.section).toBe("Dominants");
    expect(l.candidates[0].cardKey).toBe("Son of God [K]|K|K1-Son-of-God");
  });
  it("'(3) O.T. meek (I)' → qty 3, set resolves but card unknown → unresolved", () => {
    const l = byRaw(lines, "(3) O.T. meek (I)");
    expect(l.qty).toBe(3);
    expect(l.name).toBe("O.T. meek");
    expect(l.setAbbrev).toBe("I");
    expect(l.status).toBe("unresolved");
    expect(l.section).toBe("Lost Souls");
  });
  it("resolves via TtC → T2C alias", () => {
    const l = byRaw(lines, "Perplexing Vision (TtC)");
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].setCode).toBe("T2C");
  });
  it("handles smart quotes (U+2019)", () => {
    const l = byRaw(lines, "The King’s Henchmen (TtC)");
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].cardKey).toBe("The King's Henchmen|T2C|118-The-Kings-Henchmen");
  });
  it("'Grapes of Wrath (GoC LR)' — paren is NOT an alias → part of name → multi-hit ambiguous", () => {
    const l = byRaw(lines, "Grapes of Wrath (GoC LR)");
    expect(l.setAbbrev).toBeNull();
    expect(l.status).toBe("ambiguous");
    expect(l.candidates.length).toBeGreaterThanOrEqual(2); // TxP print + GoC LR print
  });
  it("'Christian Martyr (I/J)' — unknown paren stays in the name → unresolved", () => {
    const l = byRaw(lines, "Christian Martyr (I/J)");
    expect(l.setAbbrev).toBeNull();
    expect(l.name).toBe("Christian Martyr (I/J)");
    expect(l.status).toBe("unresolved");
  });
  it("ambiguous alias RoA←{RoA, RoA 3} disambiguated by containment", () => {
    const l = byRaw(lines, "Scattered (RoA)");
    expect(l.section).toBe("Reserve");
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].setCode).toBe("RoA 3"); // only RoA 3 contains 'Scattered'
  });
  it("falls back across sets when the abbrev's sets lack the card", () => {
    // Store says Roots (alias → RR); carddata now has an RR print named
    // "Nebuchadnezzar's Pride (Roots)" (embedded set), so the alias parse
    // hits in-set and resolves there. (Assertion updated from the plan's
    // RoA expectation — cardData drift, parser behavior is per-spec.)
    const l = byRaw(lines, "Nebuchadnezzar’s Pride (Roots)");
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].setCode).toBe("RR");
    // T2C now has 'Nebuchadnezzar [T2C]' → alias parse hits in-set → resolved.
    // (Also drifted from the plan's global-fallback-ambiguous expectation.)
    const n = byRaw(lines, "Nebuchadnezzar (TtC)");
    expect(n.status).toBe("resolved");
    expect(n.candidates[0].setCode).toBe("T2C");
  });
  it("alias resolves but set lacks the card → global fallback multi-hit → ambiguous", () => {
    // Synthetic: FoM has no Nebuchadnezzar; global fallback finds the
    // PoC/Prp/TxP/T2C/T2C (AB) prints — ambiguous, never auto-picked.
    // (Replaces the fixture-line coverage the two cardData drifts above ate.)
    const lines = parseDeckContents("<p>Nebuchadnezzar (FoM)</p>", ALIASES);
    expect(lines).toHaveLength(1);
    expect(lines[0].setAbbrev).toBe("FoM");
    expect(lines[0].status).toBe("ambiguous");
    expect(lines[0].candidates.length).toBeGreaterThanOrEqual(2);
  });
  it("Lost Soul store-vs-carddata naming lands in manual resolution (spec expectation)", () => {
    expect(byRaw(lines, "Contempt (TtC)").status).toBe("unresolved");
  });
});

describe("fixture: daniel-contender.html (live store description)", () => {
  const lines = parseDeckContents(fixture("daniel-contender.html"), ALIASES);

  it("'Son of God (K Deck)' → ambiguous across K and K1P (both contain it)", () => {
    const l = byRaw(lines, "Son of God (K Deck)");
    expect(l.status).toBe("ambiguous");
    expect(l.candidates.map((c) => c.setCode).sort()).toEqual(["K", "K1P"]);
  });
  it("'New Jerusalem (I & J+ or Promo)' — prose-ish paren → unresolved, paren kept", () => {
    const l = byRaw(lines, "New Jerusalem (I & J+ or Promo)");
    expect(l.setAbbrev).toBeNull();
    expect(l.status).toBe("unresolved");
  });
  it("folds doubled straight quotes to match carddata curly-quote names", () => {
    const l = byRaw(lines, "Lost Soul ''Idolaters'' [Daniel 3:7] (TtC)");
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].cardKey).toBe('Lost Soul "Idolaters" [Daniel 3:7]|T2C|021-Lost-Soul-Idolaters');
  });
  it("smart-double-quoted scripture Lost Souls with reordered names stay unresolved", () => {
    const l = byRaw(lines, "Lost Soul (Psalm 78:22) “O.T. Only” (FoM)");
    expect(l.setAbbrev).toBe("FoM");
    expect(l.status).toBe("unresolved"); // carddata: Lost Soul "O.T. Only" [Psalm 78:22]
  });
  it("attributes sections through 'Fortresses/Sites/Cities' and drops strategy prose", () => {
    expect(byRaw(lines, "Babylon (TtC)").section).toBe("Fortresses/Sites/Cities");
    expect(lines.some((l) => l.raw.includes("Banding is a central component"))).toBe(false);
    // Known noise: the recommended-cards tail parses as real lines; the
    // review screen's explicit resolve-or-drop gate is the mitigation.
    expect(lines.some((l) => l.raw === "Michael, the Guardian (TtC)")).toBe(true);
  });
});
