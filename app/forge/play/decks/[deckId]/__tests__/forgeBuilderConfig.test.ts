import { describe, it, expect } from "vitest";
import { makeForgeBuilderConfig } from "../forgeBuilderConfig";
import type { Card } from "@/app/decklist/card-search/utils";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import type { DesignCard } from "@/app/forge/lib/designCard";

const card = (imgFile: string): Card => ({ imgFile, dataLine: "", name: "x", set: "x" } as unknown as Card);

const grantedCard = (cardId: string, name: string): GrantedForgeCard => ({
  cardId,
  setId: "set-1",
  setName: "Test Set",
  hasApprovedArt: false,
  hasApprovedFinished: false,
  data: {
    name,
    cardType: ["LostSoul"],
    brigades: [],
    testament: [],
    identifiers: [],
    specialAbility: "",
    strength: null,
    toughness: null,
    reference: "",
    flavorText: "",
    legality: "",
    rarity: "",
    alignment: "Neutral",
  } as unknown as DesignCard,
});

describe("makeForgeBuilderConfig", () => {
  const config = makeForgeBuilderConfig([]);

  it("hard-disables every public-only feature", () => {
    expect(config.features).toEqual({
      localStoragePersist: false,
      syncFiltersToUrl: false,
      enableSharing: false,
      enableDeckDelete: false,
      enableImportExport: false,
      enablePrintExports: false,
      enableShopping: false,
      enableDetailsTab: false,
      serverDeckCheck: false,
      enableLegalityChecks: false,
    });
  });

  it("resolves public cards to a URL", () => {
    expect(config.resolveCardImage(card("069-An-Angel-Appears")).kind).toBe("url");
  });

  it("resolves forge cards (imgFile is a forge dataLine) to a composite element, never a URL", () => {
    // imgFile keyed (not dataLine) so loaded/saved forge cards still render forge art.
    expect(config.resolveCardImage(card("forge:abc")).kind).toBe("element");
  });

  it("renders an explicit unavailable tile (not nothing) for a dangling forge ref", () => {
    const r = config.resolveCardImage(card("forge:gone"));
    expect(r.kind).toBe("element");
    expect(r.kind === "element" && r.node).toBeTruthy();
  });

  it("injects a forge_decks persistence override", () => {
    expect(config.persistence?.save).toBeTypeOf("function");
    expect(config.persistence?.loadById).toBeTypeOf("function");
  });

  it("rehydrates loaded forge rows to the full pool card via resolveCard", () => {
    const cfg = makeForgeBuilderConfig([grantedCard("11111111-2222-3333-4444-555555555555", "Test Soul")]);
    const resolved = cfg.persistence?.resolveCard?.({
      card_name: "Test Soul",
      card_set: "Forge",
      card_img_file: "forge:11111111-2222-3333-4444-555555555555",
    });
    expect(resolved?.name).toBe("Test Soul");
    expect(resolved?.type).not.toBe("Unknown");
  });

  it("resolveCard falls through (null) for public rows and dangling forge refs", () => {
    const cfg = makeForgeBuilderConfig([]);
    expect(
      cfg.persistence?.resolveCard?.({ card_name: "A", card_set: "Wom", card_img_file: "a-card" })
    ).toBeNull();
    expect(
      cfg.persistence?.resolveCard?.({ card_name: "B", card_set: "Forge", card_img_file: "forge:dead" })
    ).toBeNull();
  });
});
