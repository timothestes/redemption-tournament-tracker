import { describe, it, expect } from "vitest";
import { buildForgePlayDeck, sanitizeParagon } from "../playSerialize";
import type { ForgeDeckEntry } from "../deckTypes";

const FORGE_ID = "11111111-2222-3333-4444-555555555555";

describe("buildForgePlayDeck", () => {
  it("serializes forge entries as opaque stubs with zero text fields", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 2, zone: "main" },
    ];
    const { deckData, dropped } = buildForgePlayDeck(entries, () => true);
    expect(dropped).toBe(0);
    expect(deckData).toHaveLength(2);
    for (const c of deckData) {
      expect(c.cardImgFile).toBe(`forge:${FORGE_ID}`);
      expect(c.cardSet).toBe("Forge");
      expect(c.isReserve).toBe(false);
      // THE LEAK ASSERTION: every other field is empty.
      for (const key of ["cardName","cardType","brigade","strength","toughness","alignment","identifier","reference","specialAbility"] as const) {
        expect(c[key]).toBe("");
      }
    }
  });

  it("drops ungranted forge entries (fail-closed) and counts them", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 3, zone: "main" },
    ];
    const { deckData, dropped } = buildForgePlayDeck(entries, () => false);
    expect(deckData).toHaveLength(0);
    expect(dropped).toBe(3);
  });

  it("marks reserve-zone entries and skips maybeboard", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "reserve" },
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "maybeboard" as any },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => true);
    expect(deckData).toHaveLength(1);
    expect(deckData[0].isReserve).toBe(true);
  });

  it("serializes public entries with full enrichment (real card from the registry)", () => {
    // 'Son of God' exists in every Redemption card registry snapshot.
    const entries: ForgeDeckEntry[] = [
      { source: "public", name: "Son of God", set: "Promo", qty: 1, zone: "main" },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => true);
    expect(deckData).toHaveLength(1);
    expect(deckData[0].cardName).toBe("Son of God");
    expect(deckData[0].cardImgFile).not.toContain("forge:");
  });
});

describe("sanitizeParagon", () => {
  it("passes a real paragon through and blanks everything else", () => {
    expect(sanitizeParagon(null)).toBe("");
    expect(sanitizeParagon("Totally Not A Paragon (unreleased card name)")).toBe("");
  });
});
