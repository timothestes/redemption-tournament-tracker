// Pure adapter: a Forge approved card (DesignCard) → the deckbuilder's Card shape.
// No "use client"/"use server" — importable on both sides. Maps enum values to the
// human-readable strings validateDeck/deckcheck expect, and stamps a collision-proof
// `forge:{cardId}` dataLine identity.
import type { Card } from "@/app/decklist/card-search/utils";
import type { DesignCard, CardType, Brigade } from "@/app/forge/lib/designCard";

export const FORGE_DATALINE_PREFIX = "forge:";
export function forgeDataLine(cardId: string): string { return FORGE_DATALINE_PREFIX + cardId; }
export function isForgeDataLine(dataLine: string): boolean { return dataLine.startsWith(FORGE_DATALINE_PREFIX); }
export function cardIdFromDataLine(dataLine: string): string { return dataLine.slice(FORGE_DATALINE_PREFIX.length); }

const TYPE_DISPLAY: Record<CardType, string> = {
  Hero: "Hero", EvilCharacter: "Evil Character", GE: "Good Enhancement", EE: "Evil Enhancement",
  LostSoul: "Lost Soul", Artifact: "Artifact", Dominant: "Dominant", Fortress: "Fortress",
  Site: "Site", City: "City", Curse: "Curse", Covenant: "Covenant",
};

const BRIGADE_DISPLAY: Record<Brigade, string> = {
  Blue: "Blue", Clay: "Clay", GoodGold: "Good Gold", Green: "Green", Purple: "Purple",
  Silver: "Silver", White: "White", Black: "Black", Brown: "Brown", Crimson: "Crimson",
  Gray: "Gray", Orange: "Orange", PaleGreen: "Pale Green",
};

function alignmentDisplay(a?: string): string {
  return a === "Good_Evil" ? "Good/Evil" : (a ?? "");
}

export function designCardToCard(data: DesignCard, cardId: string, setName: string): Card {
  const types = data.cardType ?? [];
  const brigades = data.brigades ?? [];
  return {
    dataLine: forgeDataLine(cardId),
    name: data.name ?? "Untitled",
    set: "Forge",
    imgFile: "",
    officialSet: setName,
    type: types.map((t) => TYPE_DISPLAY[t] ?? t).join("/"),
    brigade: brigades.map((b) => BRIGADE_DISPLAY[b] ?? b).join("/") || "—",
    strength: data.strength != null ? String(data.strength) : "—",
    toughness: data.toughness != null ? String(data.toughness) : "—",
    class: (data.class ?? []).join("/"),
    identifier: (data.identifiers ?? []).join(", "),
    specialAbility: data.specialAbility || data.rawText || "",
    rarity: data.rarity ?? "",
    reference: data.reference ?? "",
    alignment: alignmentDisplay(data.alignment),
    legality: data.legality ?? "",
    testament: "",
    isGospel: false,
  };
}
