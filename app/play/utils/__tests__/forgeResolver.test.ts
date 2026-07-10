import { describe, it, expect } from "vitest";
import { forgeCardIdFromImgFile, forgeProxyUrl, resolveCardImageUrl, mergeForgeDeckData, resolveLogCard, normalizeForgeLogPayload } from "../forgeResolver";
import { getCardImageUrl, getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";

const ID = "11111111-2222-3333-4444-555555555555";
const entry = {
  cardId: ID, name: "Test Hero", rawText: "Does things.", hasFinished: true, hasArt: true, versionId: "v-1",
  typeDisplay: "Hero", alignment: "Good", brigade: "Blue", strength: "5", toughness: "4",
  identifier: "Judah", reference: "Genesis 1:1",
};
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
    const merged = mergeForgeDeckData(cards as any, resolver as any);
    expect(merged[0].cardName).toBe("Test Hero");
    expect(merged[0].specialAbility).toBe("Does things.");
    expect(merged[0].cardImgFile).toContain("/forge/api/art/");
    expect(merged[1]).toBe(cards[1]);
  });

  it("resolveLogCard leaves public cards untouched", () => {
    expect(resolveLogCard("Angel of the Lord", "AngelOfTheLord.jpg", resolver)).toEqual({
      name: "Angel of the Lord",
      img: "AngelOfTheLord.jpg",
    });
    // Face-down sentinel is not a forge ref — pass it through unchanged.
    expect(resolveLogCard("a face-down card", "", resolver)).toEqual({ name: "a face-down card", img: "" });
    // Missing img still resolves to a defined img string.
    expect(resolveLogCard("Some Source", undefined, resolver)).toEqual({ name: "Some Source", img: "" });
  });
  it("resolveLogCard re-hydrates a granted forge card's real name + proxy art", () => {
    // The reserve log stores forge cards as { name: "", img: "forge:<uuid>" }
    // (leak spine). A viewer holding the grant should see the real name.
    expect(resolveLogCard("", `forge:${ID}`, resolver)).toEqual({
      name: "Test Hero",
      img: `/forge/api/art/${ID}?v=approved&kind=finished&t=v-1`,
    });
  });
  it("resolveLogCard shows a granted forge card's name even when it has no art", () => {
    const noArt = new Map([[ID, { ...entry, hasFinished: false, hasArt: false }]]);
    expect(resolveLogCard("", `forge:${ID}`, noArt)).toEqual({ name: "Test Hero", img: "" });
  });
  it("resolveLogCard masks an ungranted forge card as 'a playtest card' (no leak)", () => {
    expect(resolveLogCard("", `forge:${ID}`, new Map())).toEqual({ name: "a playtest card", img: "" });
    expect(resolveLogCard("", `forge:${ID}`, null)).toEqual({ name: "a playtest card", img: "" });
  });

  it("mergeForgeDeckData restores the searchable metadata (alignment/brigade/stats/identifier/reference)", () => {
    // Regression: the world-readable STDB row blanks these fields (leak spine),
    // so the owner's client must re-hydrate them — otherwise the in-game Search
    // Deck modal can't match forge cards by alignment/brigade/identifier/reference.
    const evil = {
      cardId: ID, name: "Wormwood", rawText: "Bad things.", hasFinished: false, hasArt: false, versionId: "v-2",
      typeDisplay: "Evil Character", alignment: "Evil", brigade: "Gray", strength: "7", toughness: "6",
      identifier: "Demon", reference: "Revelation 8:11",
    };
    const cards = [
      { cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "Evil Character", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
    ];
    const merged = mergeForgeDeckData(cards as any, new Map([[ID, evil]]) as any);
    expect(merged[0].alignment).toBe("Evil");
    expect(merged[0].brigade).toBe("Gray");
    expect(merged[0].strength).toBe("7");
    expect(merged[0].toughness).toBe("6");
    expect(merged[0].identifier).toBe("Demon");
    expect(merged[0].reference).toBe("Revelation 8:11");
  });
});

describe("normalizeForgeLogPayload", () => {
  const PROXY = `/forge/api/art/${ID}?v=approved&kind=finished&t=v-1`;

  it("resolves a forge card in a reserve/batch `cards` array (granted viewer)", () => {
    const payload = JSON.stringify({
      count: 1,
      cards: [{ name: "", img: `forge:${ID}` }, { name: "Angel", img: "Angel.jpg" }],
    });
    const out = JSON.parse(normalizeForgeLogPayload(payload, resolver)!);
    expect(out.cards[0]).toEqual({ name: "Test Hero", img: PROXY });
    expect(out.cards[1]).toEqual({ name: "Angel", img: "Angel.jpg" }); // public card untouched
  });

  it("resolves cardName/cardImgFile and sourceCardName/sourceCardImgFile pairs", () => {
    const payload = JSON.stringify({
      cardName: "", cardImgFile: `forge:${ID}`,
      sourceCardName: "", sourceCardImgFile: `forge:${ID}`,
      to: "reserve",
    });
    const out = JSON.parse(normalizeForgeLogPayload(payload, resolver)!);
    expect(out.cardName).toBe("Test Hero");
    expect(out.cardImgFile).toBe(PROXY);
    expect(out.sourceCardName).toBe("Test Hero");
    expect(out.sourceCardImgFile).toBe(PROXY);
    expect(out.to).toBe("reserve"); // unrelated fields preserved
  });

  it("resolves nested `card` / `drew` objects", () => {
    const payload = JSON.stringify({ card: { name: "", img: `forge:${ID}` }, drew: { name: "", img: `forge:${ID}` } });
    const out = JSON.parse(normalizeForgeLogPayload(payload, resolver)!);
    expect(out.card.name).toBe("Test Hero");
    expect(out.drew.name).toBe("Test Hero");
  });

  it("masks forge cards as 'a playtest card' for an ungranted viewer (no leak)", () => {
    const payload = JSON.stringify({ cardName: "", cardImgFile: `forge:${ID}`, to: "reserve" });
    for (const r of [new Map(), null, undefined] as const) {
      const out = JSON.parse(normalizeForgeLogPayload(payload, r as any)!);
      expect(out.cardName).toBe("a playtest card");
      expect(out.cardImgFile).toBe("");
    }
  });

  it("leaves non-forge, non-object, and non-JSON payloads untouched", () => {
    const publicPayload = JSON.stringify({ cardName: "Angel", cardImgFile: "Angel.jpg" });
    expect(normalizeForgeLogPayload(publicPayload, resolver)).toBe(publicPayload);
    expect(normalizeForgeLogPayload("3", resolver)).toBe("3"); // bare count (LOOK_AT_TOP legacy)
    expect(normalizeForgeLogPayload("[1,2,3]", resolver)).toBe("[1,2,3]"); // array payload (REVEAL_CARDS legacy)
    expect(normalizeForgeLogPayload("not json", resolver)).toBe("not json");
    expect(normalizeForgeLogPayload(undefined, resolver)).toBeUndefined();
    expect(normalizeForgeLogPayload("", resolver)).toBe("");
  });
});
