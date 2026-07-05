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

  it("dataLine helpers round-trip", () => {
    const dl = forgeDataLine("uuid-9");
    expect(isForgeDataLine(dl)).toBe(true);
    expect(isForgeDataLine("Angel|Pa|Angel_(Pa)")).toBe(false);
    expect(cardIdFromDataLine(dl)).toBe("uuid-9");
  });
});
