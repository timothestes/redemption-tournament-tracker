import { describe, it, expect } from "vitest";
import { buildForgePlayDeck, sanitizeParagon, buildForgeGoldfishCards } from "../playSerialize";
import type { ForgeDeckEntry } from "../deckTypes";
import type { ForgePlayResolverEntry } from "../playDecks";

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

describe("buildForgeGoldfishCards", () => {
  const resolverEntry = (overrides: Partial<ForgePlayResolverEntry> = {}): ForgePlayResolverEntry => ({
    cardId: FORGE_ID,
    name: "Playtest Hero",
    rawText: "Some raw ability text.",
    hasFinished: false,
    hasArt: true,
    versionId: "v1",
    ...overrides,
  });

  it("resolves a granted forge entry with name/text from the resolver, preserving quantity", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 3, zone: "main" },
    ];
    const entry = resolverEntry();
    const cards = buildForgeGoldfishCards(entries, () => entry);
    expect(cards).toHaveLength(1); // NOT expanded — goldfish takes quantity, unlike buildForgePlayDeck
    const c = cards[0];
    expect(c.card_name).toBe(entry.name);
    expect(c.card_special_ability).toBe(entry.rawText);
    expect(c.card_set).toBe("Forge");
    expect(c.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(c.quantity).toBe(3);
    expect(c.is_reserve).toBe(false);
  });

  it("drops unresolved (revoked) forge entries entirely", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 2, zone: "main" },
    ];
    const cards = buildForgeGoldfishCards(entries, () => undefined);
    expect(cards).toHaveLength(0);
  });

  it("never leaks the public CDN base or a bare forge: URI into card_img_file", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "main" },
    ];
    // hasFinished + hasArt both true → finished proxy URL
    const finished = buildForgeGoldfishCards(entries, () => resolverEntry({ hasFinished: true, hasArt: true }))[0];
    expect(finished.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(finished.card_img_file).not.toContain("forge:");

    // hasArt only → approved (non-finished) proxy URL
    const artOnly = buildForgeGoldfishCards(entries, () => resolverEntry({ hasFinished: false, hasArt: true }))[0];
    expect(artOnly.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(artOnly.card_img_file).not.toContain("forge:");

    // Neither approved → empty string, never a bare forge: uri
    const none = buildForgeGoldfishCards(entries, () => resolverEntry({ hasFinished: false, hasArt: false }))[0];
    expect(none.card_img_file).toBe("");
  });

  it("skips maybeboard entries and marks reserve-zone entries", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "reserve" },
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "maybeboard" as any },
    ];
    const entry = resolverEntry();
    const cards = buildForgeGoldfishCards(entries, () => entry);
    expect(cards).toHaveLength(1);
    expect(cards[0].is_reserve).toBe(true);
  });

  it("enriches public entries from the real card registry", () => {
    // 'Son of God' exists in every Redemption card registry snapshot.
    const entries: ForgeDeckEntry[] = [
      { source: "public", name: "Son of God", set: "Promo", qty: 2, zone: "main" },
    ];
    const cards = buildForgeGoldfishCards(entries, () => undefined);
    expect(cards).toHaveLength(1);
    expect(cards[0].card_name).toBe("Son of God");
    expect(cards[0].quantity).toBe(2);
    expect(cards[0].card_img_file).not.toContain("forge:");
  });
});
