import { describe, it, expect } from "vitest";
import { makeForgeBuilderConfig } from "../forgeBuilderConfig";
import type { Card } from "@/app/decklist/card-search/utils";

const card = (imgFile: string): Card => ({ imgFile, dataLine: "", name: "x", set: "x" } as unknown as Card);

describe("makeForgeBuilderConfig", () => {
  const config = makeForgeBuilderConfig([]);

  it("hard-disables every public-only feature", () => {
    expect(config.features).toEqual({
      localStoragePersist: false,
      syncFiltersToUrl: false,
      enableSharing: false,
      enableDeckDelete: false,
    });
  });

  it("resolves public cards to a URL", () => {
    expect(config.resolveCardImage(card("069-An-Angel-Appears")).kind).toBe("url");
  });

  it("resolves forge cards (imgFile is a forge dataLine) to a composite element, never a URL", () => {
    // imgFile keyed (not dataLine) so loaded/saved forge cards still render forge art.
    expect(config.resolveCardImage(card("forge:abc")).kind).toBe("element");
  });

  it("injects a forge_decks persistence override", () => {
    expect(config.persistence?.save).toBeTypeOf("function");
    expect(config.persistence?.loadById).toBeTypeOf("function");
  });
});
