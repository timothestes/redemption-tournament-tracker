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
  it("merges the parser-side supplemental multi-set abbreviations", () => {
    // set_aliases is strictly 1:1 (unique on carddata_code) — these can
    // never be table rows.
    expect(ALIASES.get("i/j")).toEqual(["I", "J"]);
    expect(ALIASES.get("i/j/l")).toEqual(["I", "J", "L"]);
    expect(ALIASES.get("i/j decks")).toEqual(["I", "J"]);
    expect(ALIASES.get("p")).toEqual(["Pmo-P1", "Pmo-P2", "Pmo-P3"]);
  });
  it("supplemental aliases resolve via the usual containment disambiguation", () => {
    const [sog, store, meek] = parseDeckContents(
      "<p>Son of God (I/J)<br>Storehouse (P)<br>(7) Meek Lost Souls (I/J decks)</p>",
      ALIASES,
    );
    // BOTH I and J print Son of God → containment keeps both, never
    // auto-picks; the admin gets a one-click choice.
    expect(sog.status).toBe("ambiguous");
    expect(sog.candidates.map((c) => c.setCode).sort()).toEqual(["I", "J"]);
    // Promo abbreviation "P" spans the three promo pools; only Pmo-P2 has it.
    expect(store.status).toBe("resolved");
    expect(store.candidates[0].cardKey).toBe("Storehouse (Promo)|Pmo-P2|Promo_Storehouse");
    // The alias parses (qty + name + sets) even when the name matches no
    // card — the meek souls land in the wizard's inline search.
    expect(meek.qty).toBe(7);
    expect(meek.name).toBe("Meek Lost Souls");
    expect(meek.setAbbrev).toBe("I/J decks");
    expect(meek.status).toBe("unresolved");
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
  it("bare-epithet Lost Souls resolve section-aware within the aliased set", () => {
    // In a Lost Souls section the store writes just epithet + set; carddata
    // writes 'Lost Soul "Epithet" [ref]'.
    const contempt = byRaw(lines, "Contempt (TtC)");
    expect(contempt.section).toBe("Lost Souls");
    expect(contempt.status).toBe("resolved");
    expect(contempt.candidates[0].cardKey).toBe(
      'Lost Soul "Contempt" [Daniel 12:2]|T2C|023-Lost-Soul-Contempt');
    expect(byRaw(lines, "Stubborn (TtC)").candidates[0].cardKey).toBe(
      'Lost Soul "Stubborn" [Daniel 9:6]|T2C|022-Lost-Soul-Stubborn');
    // K-deck epithet — pool is the identity alias [K], so the K1P first-print
    // twin is not a candidate.
    const displeased = byRaw(lines, "Displeased (K)");
    expect(displeased.status).toBe("resolved");
    expect(displeased.candidates[0].setCode).toBe("K");
  });
  it("bare-epithet matching also reads Ki-era paren epithets, and stays section-gated", () => {
    const [hopper, remnant, offSection] = parseDeckContents(
      "<p>Lost Souls</p><p>Hopper (Ki)</p><p>Remnant (PoC)</p><p>Heroes</p><p>Remnant (PoC)</p>",
      ALIASES,
    );
    // carddata: "Lost Soul II Chronicles 28:13 (Hopper)" — epithet in parens.
    expect(hopper.status).toBe("resolved");
    expect(hopper.candidates[0].cardKey).toBe(
      "Lost Soul II Chronicles 28:13 (Hopper)|Ki|Lost_Soul_II_Chronicles_28_13_(Hopper)_(Ki)");
    expect(remnant.status).toBe("resolved");
    expect(remnant.candidates[0].cardName).toBe('Lost Soul "Remnant" [Jeremiah 31:8]');
    // Same line outside a Lost Souls section: no epithet rescue.
    expect(offSection.section).toBe("Heroes");
    expect(offSection.status).toBe("unresolved");
  });
});

describe("fixture: rotation-jerusalem.html (prod-mirror body_html, worst tail offender)", () => {
  // Pulled byte-identical from the shopify_products mirror (md5-verified);
  // the storefront .js endpoint serves the same body_html.
  const lines = parseDeckContents(fixture("rotation-jerusalem.html"), ALIASES);

  it("emits exactly the 56 deck lines — the 21+ resolving tail card links are cut", () => {
    expect(lines).toHaveLength(56);
    expect(lines[0].raw).toBe("Son of God (I/J)");
    expect(lines[lines.length - 1].raw).toBe("Strict Sabbath (GoC)"); // last Reserve card
  });
  it("tail card links never appear as deck lines (phantom-card guard)", () => {
    // These are real, resolvable card names hyperlinked in the recommended
    // tail — before the cutoff they would have silently joined the deck.
    for (const phantom of [
      "The Resurrection", "Good Seed", "Doom Speakers", "Three Nails",
      "Saul of Tarsus", "Grapes of Wrath", "The Deceiver", "Sheol",
    ]) {
      expect(lines.some((l) => l.raw === phantom)).toBe(false);
    }
    // …while the deck's own Heroes-section line with a tail-ish name stays.
    expect(byRaw(lines, "Resurrection Revealer (GoC)").section).toBe("Heroes");
  });
  it("resolves single halves of dual-sided GoC hero names", () => {
    // carddata: "Mary, Mother of James / Mary, the Caregiver (GoC)" etc. —
    // the store lists one side only.
    const mary = byRaw(lines, "Mary, Mother of James (GoC)");
    expect(mary.status).toBe("resolved");
    expect(mary.candidates[0].cardKey).toBe(
      "Mary, Mother of James / Mary, the Caregiver (GoC)|GoC|147-Mary-MoJ-R");
    const andrew = byRaw(lines, "Andrew, First Called (GoC)");
    expect(andrew.section).toBe("Reserve");
    expect(andrew.status).toBe("resolved");
    expect(andrew.candidates[0].cardName).toBe(
      "Andrew, First Called / Andrew, Fisher of Men (GoC)");
  });
  it("Lost Souls section: epithet + scripture rescues work on this fixture too", () => {
    const first = byRaw(lines, "The First (I/J+)");
    expect(first.status).toBe("resolved");
    expect(first.candidates[0].cardKey).toBe(
      'Lost Soul "The First" [Luke 13:30]|I/J+|Lost-Soul-The-First-Luke_13_30-IJ');
    // In-set epithet beats the cross-set name fallback: "Escape" is also an
    // AW dominant, but (PC) + Lost Souls section means the TPC soul.
    const escape = byRaw(lines, "Escape (PC)");
    expect(escape.status).toBe("resolved");
    expect(escape.candidates[0].cardName).toBe('Lost Soul "Escape" [II Timothy 2:26 - TPC]');
    expect(escape.candidates[0].setCode).toBe("TPC");
  });
});

describe("dual-sided half-name matching (synthetic)", () => {
  it("matches both-halves queries order-insensitively", () => {
    // carddata order is "the Chosen / the Builder"; the store reverses it.
    const [l] = parseDeckContents(
      "<p>Zerubbabel, the Builder / Zerubbabel, the Chosen (LoC)</p>", ALIASES);
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].cardKey).toBe(
      "Zerubbabel, the Chosen / Zerubbabel, the Builder (LoC)|LoC|LoC_107-Zerubbabel-UR");
  });
  it("matches a lone half against the dual card", () => {
    const [l] = parseDeckContents("<p>Jehoshaphat, the Seeker (LoC)</p>", ALIASES);
    expect(l.status).toBe("resolved");
    expect(l.candidates[0].cardKey).toBe(
      "Jehoshaphat, the Seeker / Jehoshaphat, the Meek (LoC)|LoC|LoC_067-Jehoshaphat");
  });
});

describe("fixture: daniel-contender.html (live store description)", () => {
  const lines = parseDeckContents(fixture("daniel-contender.html"), ALIASES);

  it("resolution summary: 60 lines — 58 resolved, 2 ambiguous, 0 unresolved", () => {
    // Was 86 lines with 68/1/17 before scripture matching, or-option parens,
    // the pre-section prose drop and the post-decklist cutoff. 60 is the
    // real physical deck (50 main + 10 Reserve section lines).
    expect(lines).toHaveLength(60);
    const counts = { resolved: 0, ambiguous: 0, unresolved: 0 };
    for (const l of lines) counts[l.status]++;
    expect(counts).toEqual({ resolved: 58, ambiguous: 2, unresolved: 0 });
  });
  it("hard-stops at 'Deck strategy and tips:' — tail card links never become deck lines", () => {
    // The tail's recommended-cards section is per-line hyperlinked REAL card
    // names; without the cutoff they'd resolve and silently join the deck.
    expect(lines[lines.length - 1].raw).toBe("Servants of the King (River) (TtC)");
    for (const raw of [
      "Deck strategy and tips:", "OVERVIEW:", "THE OFFENSE:", "THE DEFENSE:",
      "Michael, the Guardian (TtC)",           // recommended-cards tail, resolves
      "Lost Soul (Job 30:26) “Darkness” (RoJ)", // ditto
      "Raiders' Camp (2025 Promo)",
    ]) {
      expect(lines.some((l) => l.raw === raw)).toBe(false);
    }
  });
  it("cutoff only arms after the first section header (intro lines can't wipe the parse)", () => {
    const parsed = parseDeckContents(
      "<p>Overview video linked below!</p><p>Dominants</p><p>Son of God (K)</p><p>THE OFFENSE:</p><p>Told to Take (TtC)</p>",
      ALIASES,
    );
    expect(parsed.map((l) => l.raw)).toEqual(["Son of God (K)"]);
  });
  it("auto-drops intro junk before the first section header", () => {
    for (const raw of [
      "And check out these videos to find out more about this deck!",
      "Deck overview and intro",
      "Live online Local tournament gameplay using budget-free version of the deck",
    ]) {
      expect(lines.some((l) => l.raw === raw)).toBe(false);
    }
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
    // Synthetic since the fixture's occurrence sits in the cut-off tail.
    const [l] = parseDeckContents("<p>Raiders' Camp (2025 Promo)</p>", ALIASES);
    expect(l.status).toBe("unresolved");
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
    // Synthetic (these store shapes sat in the now-cut-off recommended tail).
    // Line "(James 4:6/Proverbs 3:34)" vs carddata "[James 4:6 / Proverbs 3:34 - RoJ]".
    const [humble, cg] = parseDeckContents(
      "<p>Lost Soul (James 4:6/Proverbs 3:34) “Humble” (RoJ)<br>Lost Soul ''Color Guard'' (Jeremiah 13:10) (Roots)</p>",
      ALIASES,
    );
    expect(humble.status).toBe("resolved");
    expect(humble.candidates[0].cardKey).toBe(
      'Lost Soul "Humble" [James 4:6 / Proverbs 3:34 - RoJ]|RoJ|22-Lost-Soul-Humble-R');
    // Line "(Jeremiah 13:10)" vs carddata "[Jeremiah 13:10 - RR]" — set-scoped
    // to RR via Roots, so the Pri print with the same verse is not a candidate.
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
  });
});
