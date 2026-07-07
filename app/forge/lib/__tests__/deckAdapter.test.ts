import { describe, it, expect } from "vitest";
import { designCardToCard, forgeDataLine, isForgeDataLine, cardIdFromDataLine } from "../deckAdapter";
import type { DesignCard } from "../designCard";

describe("designCardToCard", () => {
  it("maps a Lost Soul so validateDeck's type check matches", () => {
    const d: DesignCard = { name: "The Wait", cardType: ["LostSoul"] };
    const c = designCardToCard(d, "abc", "Test Set");
    expect(c.type.toLowerCase()).toContain("lost soul");
    expect(c.dataLine).toBe("forge:abc");
    expect(c.set).toBe("Forge");
    expect(c.officialSet).toBe("Test Set");
  });

  it("emits GE/EE as the abbreviation (matching public cards) so they group together", () => {
    // Public card data stores type "GE"/"EE"; a forge card must match or deck
    // views that group on the raw type string render two separate buckets.
    expect(designCardToCard({ name: "G", cardType: ["GE"] }, "g1", "S").type).toBe("GE");
    expect(designCardToCard({ name: "E", cardType: ["EE"] }, "e1", "S").type).toBe("EE");
    // Dual GE/EE joins the two abbreviations, like the public "GE/EE".
    expect(designCardToCard({ name: "D", cardType: ["GE", "EE"] }, "d1", "S").type).toBe("GE/EE");
  });

  it("maps Good_Evil alignment to 'Good/Evil' and GoodGold brigade to 'Good Gold'", () => {
    const d: DesignCard = { name: "X", cardType: ["Hero"], alignment: "Good_Evil", brigades: ["GoodGold", "PaleGreen"] };
    const c = designCardToCard(d, "id1", "S");
    expect(c.alignment).toBe("Good/Evil");
    expect(c.brigade).toBe("Good Gold/Pale Green");
  });

  it("renders null stats as em-dash", () => {
    const d: DesignCard = { name: "Y", cardType: ["Dominant"], strength: null, toughness: null };
    const c = designCardToCard(d, "id2", "S");
    expect(c.strength).toBe("—");
    expect(c.toughness).toBe("—");
    expect(c.type.toLowerCase()).toContain("dominant");
  });

  it("defaults an unset legality to 'Rotation' but preserves an explicit choice", () => {
    const unset: DesignCard = { name: "New", cardType: ["Hero"] };
    expect(designCardToCard(unset, "id3", "S").legality).toBe("Rotation");
    const banned: DesignCard = { name: "Old", cardType: ["Hero"], legality: "Banned" };
    expect(designCardToCard(banned, "id4", "S").legality).toBe("Banned");
  });

  it("derives testament/isGospel from the scripture reference (not hardcoded empty)", () => {
    // Regression: an EoT Lost Soul with a New-Testament reference must come out
    // as N.T. so it matches the deckbuilder's testament filter. Before the fix
    // the adapter hardcoded testament: "" and the card never showed under N.T.
    const nt: DesignCard = { name: 'Lost Soul "Forsaken"', cardType: ["LostSoul"], reference: "Hebrews 10:25" };
    expect(designCardToCard(nt, "ls1", "EoT").testament).toBe("NT");

    const ot: DesignCard = { name: "Aimless", cardType: ["LostSoul"], reference: "Exodus 14:3" };
    expect(designCardToCard(ot, "ls2", "EoT").testament).toBe("OT");

    // A Gospel reference sets isGospel.
    const gospel: DesignCard = { name: "Parable", cardType: ["GE"], reference: "Matthew 13:3" };
    const g = designCardToCard(gospel, "g1", "S");
    expect(g.testament).toBe("NT");
    expect(g.isGospel).toBe(true);

    // No reference → empty testament (unchanged behavior).
    expect(designCardToCard({ name: "Z", cardType: ["Hero"] }, "z1", "S").testament).toBe("");
  });

  it("prefers rawText over a stale specialAbility, falling back when rawText is absent", () => {
    // Regression: designCardToCard must read via cardRawText (rawText-first) so a
    // stale legacy specialAbility can't shadow a newer rawText edit (Heavenly
    // Temple bug, 2026-07-06).
    const both: DesignCard = { name: "A", cardType: ["Hero"], rawText: "new text", specialAbility: "old text" };
    expect(designCardToCard(both, "a1", "S").specialAbility).toBe("new text");

    const legacyOnly: DesignCard = { name: "B", cardType: ["Hero"], specialAbility: "legacy" };
    expect(designCardToCard(legacyOnly, "b1", "S").specialAbility).toBe("legacy");
  });

  it("dataLine helpers round-trip", () => {
    const dl = forgeDataLine("uuid-9");
    expect(isForgeDataLine(dl)).toBe(true);
    expect(isForgeDataLine("Angel|Pa|Angel_(Pa)")).toBe(false);
    expect(cardIdFromDataLine(dl)).toBe("uuid-9");
  });
});
