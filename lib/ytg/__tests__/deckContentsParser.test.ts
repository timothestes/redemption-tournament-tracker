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
  it("'Christian Martyr (I/J)' — option paren splits on '/' → ambiguous across I and J", () => {
    // Was unresolved before or-option parens: "I/J" fails as ONE alias, but
    // splits into I and J, both real sets containing the card. Never
    // auto-picked — the admin gets a one-click choice.
    const l = byRaw(lines, "Christian Martyr (I/J)");
    expect(l.setAbbrev).toBe("I/J");
    expect(l.name).toBe("Christian Martyr");
    expect(l.status).toBe("ambiguous");
    expect(l.candidates.map((c) => c.cardKey).sort()).toEqual([
      "Christian Martyr (I)|I|Christian_Martyr_(I)",
      "Christian Martyr (J)|J|Christian_Martyr_(J)",
    ]);
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

  it("resolution summary: 83 lines — 75 resolved, 2 ambiguous, 6 unresolved", () => {
    // Was 86 lines with 68/1/17 before scripture matching, or-option parens
    // and the pre-section prose drop.
    expect(lines).toHaveLength(83);
    const counts = { resolved: 0, ambiguous: 0, unresolved: 0 };
    for (const l of lines) counts[l.status]++;
    expect(counts).toEqual({ resolved: 75, ambiguous: 2, unresolved: 6 });
  });
  it("auto-drops intro junk before the first section header", () => {
    for (const raw of [
      "And check out these videos to find out more about this deck!",
      "Deck overview and intro",
      "Live online Local tournament gameplay using budget-free version of the deck",
    ]) {
      expect(lines.some((l) => l.raw === raw)).toBe(false);
    }
    // Scope guard: prose AFTER the first section header is not auto-dropped —
    // the review screen's explicit resolve-or-drop gate still owns those.
    expect(byRaw(lines, "Deck strategy and tips:").status).toBe("unresolved");
    expect(byRaw(lines, "OVERVIEW:").status).toBe("unresolved");
  });
  it("keeps pre-section lines that resolve as cards; no headers → nothing dropped", () => {
    // Card line before any section header must survive the prose drop.
    const withHeader = parseDeckContents(
      "<p>Told to Take (TtC)</p><p>Some intro chatter here</p><p>Dominants</p><p>Son of God (K)</p>",
      ALIASES,
    );
    expect(withHeader.map((l) => l.raw)).toEqual(["Told to Take (TtC)", "Son of God (K)"]);
    expect(withHeader[0].status).toBe("resolved");
    // Defensive: descriptions with no section headers at all drop nothing.
    const headerless = parseDeckContents(
      "<p>Some intro chatter here</p><p>Told to Take (TtC)</p>", ALIASES);
    expect(headerless.map((l) => l.raw)).toEqual(
      ["Some intro chatter here", "Told to Take (TtC)"]);
    expect(headerless[0].status).toBe("unresolved");
  });

  it("'Son of God (K Deck)' → ambiguous across K and K1P (both contain it)", () => {
    const l = byRaw(lines, "Son of God (K Deck)");
    expect(l.status).toBe("ambiguous");
    expect(l.candidates.map((c) => c.setCode).sort()).toEqual(["K", "K1P"]);
  });
  it("'New Jerusalem (I & J+ or Promo)' — or-option paren → ambiguous with per-set candidates", () => {
    // "I & J+" resolves whole (before the &// sub-split) → I/J+; "Promo" →
    // Pmo-P1/P2/P3. Only I/J+ and Pmo-P2 actually contain a New Jerusalem.
    // Always ambiguous: the line itself offers alternatives — never auto-pick.
    const l = byRaw(lines, "New Jerusalem (I & J+ or Promo)");
    expect(l.setAbbrev).toBe("I & J+ or Promo");
    expect(l.name).toBe("New Jerusalem");
    expect(l.status).toBe("ambiguous");
    expect(l.candidates.map((c) => c.cardKey).sort()).toEqual([
      "New Jerusalem (I/J+)|I/J+|New-Jerusalem-IJ",
      "New Jerusalem (Promo)|Pmo-P2|New_Jerusalem_(Promo)",
    ]);
  });
  it("or-split leaves non-option parens alone ('2025 Promo' has no delimiter)", () => {
    expect(byRaw(lines, "Raiders' Camp (2025 Promo)").status).toBe("unresolved");
  });
  it("folds doubled straight quotes to match carddata curly-quote names", () => {
    const l = byRaw(lines, "Lost Soul ''Idolaters'' [Daniel 3:7] (TtC)");
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].cardKey).toBe('Lost Soul "Idolaters" [Daniel 3:7]|T2C|021-Lost-Soul-Idolaters');
  });
  it("scripture-ref matching resolves reordered Lost Soul lines within the parsed set", () => {
    // Store order "(ref) “epithet”" vs carddata 'Lost Soul "epithet" [ref]' —
    // the scripture ref is the stable token.
    const ot = byRaw(lines, "Lost Soul (Psalm 78:22) “O.T. Only” (FoM)");
    expect(ot.setAbbrev).toBe("FoM");
    expect(ot.status).toBe("resolved");
    expect(ot.candidates[0].cardKey).toBe(
      'Lost Soul "O.T. Only" [Psalm 78:22]|FoM|140-Lost_Soul_Psalm_78-22');

    const cb = byRaw(lines, "Lost Soul (Daniel 9:5) ''Covenant Breakers'' (PoC)");
    expect(cb.status).toBe("resolved");
    expect(cb.candidates[0].cardKey).toBe(
      'Lost Soul "Covenant Breakers" [Daniel 9:5]|PoC|164-Lost-Soul-Covenant-Breakers-(Daniel-9_5)');
  });
  it("epithet tiebreaks when one set has two souls on the same verse", () => {
    // PoC has both "Foreigner" and "Orphans" on Jeremiah 22:3.
    const l = byRaw(lines, "Lost Soul (Jeremiah 22:3) “Foreigner” (PoC)");
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].cardKey).toBe(
      'Lost Soul "Foreigner" [Jeremiah 22:3]|PoC|128-Lost-Soul-Foreigner-(Jeremiah-22_3)');
  });
  it("handles multi-ref verses and rarity-suffixed brackets in carddata names", () => {
    // Line "(James 4:6/Proverbs 3:34)" vs carddata "[James 4:6 / Proverbs 3:34 - RoJ]".
    const humble = byRaw(lines, "Lost Soul (James 4:6/Proverbs 3:34) “Humble” (RoJ)");
    expect(humble.status).toBe("resolved");
    expect(humble.candidates[0].cardKey).toBe(
      'Lost Soul "Humble" [James 4:6 / Proverbs 3:34 - RoJ]|RoJ|22-Lost-Soul-Humble-R');
    // Line "(Jeremiah 13:10)" vs carddata "[Jeremiah 13:10 - RR]" — set-scoped
    // to RR via Roots, so the Pri print with the same verse is not a candidate.
    const cg = byRaw(lines, "Lost Soul ''Color Guard'' (Jeremiah 13:10) (Roots)");
    expect(cg.status).toBe("resolved");
    expect(cg.candidates[0].cardKey).toBe(
      'Lost Soul "Color Guard" [Jeremiah 13:10 - RR]|RR|016-Lost-Soul-Color-Guard');
  });
  it("scripture match with several hits and no deciding epithet stays ambiguous", () => {
    // Synthetic: no epithet on the line → both PoC Jeremiah 22:3 souls listed.
    const [l] = parseDeckContents("<p>Lost Soul (Jeremiah 22:3) (PoC)</p>", ALIASES);
    expect(l.status).toBe("ambiguous");
    expect(l.candidates.map((c) => c.cardName).sort()).toEqual([
      'Lost Soul "Foreigner" [Jeremiah 22:3]',
      'Lost Soul "Orphans" [Jeremiah 22:3]',
    ]);
  });
  it("scripture match spans all sets when no set abbrev parsed; unknown refs stay unresolved", () => {
    const lines = parseDeckContents(
      "<p>Lost Soul (Psalm 78:22) ''O.T. Only''<br>Lost Soul (Hezekiah 99:99) ''Nobody''</p>",
      ALIASES,
    );
    expect(lines[0].status).toBe("resolved");
    expect(lines[0].candidates[0].setCode).toBe("FoM");
    expect(lines[1].status).toBe("unresolved");
  });
  it("attributes sections through 'Fortresses/Sites/Cities' and drops strategy prose", () => {
    expect(byRaw(lines, "Babylon (TtC)").section).toBe("Fortresses/Sites/Cities");
    expect(lines.some((l) => l.raw.includes("Banding is a central component"))).toBe(false);
    // Known noise: the recommended-cards tail parses as real lines; the
    // review screen's explicit resolve-or-drop gate is the mitigation.
    expect(lines.some((l) => l.raw === "Michael, the Guardian (TtC)")).toBe(true);
  });
});
