import { describe, it, expect } from "vitest";
import { cardInstanceToGameCard } from "../cardAdapter";

const ID = "11111111-2222-3333-4444-555555555555";
const entry = { cardId: ID, name: "Test Hero", rawText: "Does things.", hasFinished: false, hasArt: true, versionId: "v-9" };

function stubInstance(over: Record<string, unknown> = {}) {
  return {
    id: 1n, gameId: 1n, ownerId: 1n, originalOwnerId: 1n, zone: "hand", zoneIndex: 0n,
    posX: "", posY: "", isMeek: false, isFlipped: false,
    cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "", brigade: "",
    strength: "", toughness: "", alignment: "", identifier: "", specialAbility: "",
    reference: "", notes: "", equippedToInstanceId: 0n, isSoulDeckOrigin: false,
    isToken: false, revealExpiresAt: undefined, revealStartedAt: undefined,
    outlineColor: "", imitatingName: "", ...over,
  } as any;
}

describe("cardInstanceToGameCard forge resolution", () => {
  it("merges name/text/proxy URL when resolver has the card", () => {
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map([[ID, entry]]));
    expect(gc.cardName).toBe("Test Hero");
    expect(gc.specialAbility).toBe("Does things.");
    expect(gc.cardImgFile).toBe(`/forge/api/art/${ID}?v=approved&t=v-9`);
  });
  it("leaves the opaque URI when unresolved (fail-closed placeholder)", () => {
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map());
    expect(gc.cardName).toBe("");
    expect(gc.cardImgFile).toBe(`forge:${ID}`);
  });
  it("does not touch public cards", () => {
    const gc = cardInstanceToGameCard(stubInstance({ cardImgFile: "Public.jpg", cardName: "Pub" }), [], "player1", new Map([[ID, entry]]));
    expect(gc.cardName).toBe("Pub");
    expect(gc.cardImgFile).toBe("Public.jpg");
  });
});
