import { describe, it, expect } from "vitest";
import { forgeCardIdFromImgFile, forgeProxyUrl, resolveCardImageUrl, mergeForgeDeckData } from "../forgeResolver";
import { getCardImageUrl, getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";

const ID = "11111111-2222-3333-4444-555555555555";
const entry = { cardId: ID, name: "Test Hero", rawText: "Does things.", hasFinished: true, hasArt: true, versionId: "v-1" };
const resolver = new Map([[ID, entry]]);

describe("forge image seams", () => {
  it("getCardImageUrl returns '' for forge: URIs (never the public CDN)", () => {
    expect(getCardImageUrl(`forge:${ID}`)).toBe("");
  });
  it("getCardImageUrlOrNull passes through leading-/ URLs and nulls forge:", () => {
    expect(getCardImageUrlOrNull("/forge/api/art/x?v=approved")).toBe("/forge/api/art/x?v=approved");
    expect(getCardImageUrlOrNull(`forge:${ID}`)).toBeNull();
  });
  it("extracts the forge card id", () => {
    expect(forgeCardIdFromImgFile(`forge:${ID}`)).toBe(ID);
    expect(forgeCardIdFromImgFile("SomeCard.jpg")).toBeNull();
  });
  it("prefers finished scan, falls back to artwork, else ''", () => {
    expect(forgeProxyUrl(entry)).toBe(`/forge/api/art/${ID}?v=approved&kind=finished&t=v-1`);
    expect(forgeProxyUrl({ ...entry, hasFinished: false })).toBe(`/forge/api/art/${ID}?v=approved&t=v-1`);
    expect(forgeProxyUrl({ ...entry, hasFinished: false, hasArt: false })).toBe("");
  });
  it("resolveCardImageUrl: resolved -> proxy URL; unresolved -> ''", () => {
    expect(resolveCardImageUrl(`forge:${ID}`, resolver)).toContain("/forge/api/art/");
    expect(resolveCardImageUrl(`forge:${ID}`, new Map())).toBe("");
    expect(resolveCardImageUrl(`forge:${ID}`, null)).toBe("");
  });
  it("mergeForgeDeckData merges name/text/img and leaves public cards alone", () => {
    const cards = [
      { cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
      { cardName: "Public", cardSet: "S", cardImgFile: "Public.jpg", cardType: "", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
    ];
    const merged = mergeForgeDeckData(cards as any, resolver);
    expect(merged[0].cardName).toBe("Test Hero");
    expect(merged[0].specialAbility).toBe("Does things.");
    expect(merged[0].cardImgFile).toContain("/forge/api/art/");
    expect(merged[1]).toBe(cards[1]);
  });
});
