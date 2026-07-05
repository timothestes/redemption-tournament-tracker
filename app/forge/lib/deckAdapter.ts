// Pure adapter: a Forge approved card (DesignCard) → the deckbuilder's Card shape.
// No "use client"/"use server" — importable on both sides. Maps enum values to the
// canonical public `type` string (GE/EE stay abbreviated, matching the public card
// index) so forge and public cards group/validate identically, and stamps a
// collision-proof `forge:{cardId}` dataLine identity.
import type { Card } from "@/app/decklist/card-search/utils";
import type { DesignCard, CardType, Brigade } from "@/app/forge/lib/designCard";

export const FORGE_DATALINE_PREFIX = "forge:";
export function forgeDataLine(cardId: string): string { return FORGE_DATALINE_PREFIX + cardId; }
export function isForgeDataLine(dataLine: string): boolean { return dataLine.startsWith(FORGE_DATALINE_PREFIX); }
export function cardIdFromDataLine(dataLine: string): string { return dataLine.slice(FORGE_DATALINE_PREFIX.length); }

// DesignCard type enum → the public card index's canonical `type` value. The public
// data abbreviates only GE/EE (every other type is spelled out), so we match that
// exactly — otherwise views that group on the raw type string split forge "Good
// Enhancement" from public "GE" into two buckets. Deckbuilder/deck-view UIs prettify
// "GE"/"EE" back to full names for their section headers.
export const TYPE_DISPLAY: Record<CardType, string> = {
  Hero: "Hero", EvilCharacter: "Evil Character", GE: "GE", EE: "EE",
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
    // Forge cards are designed for the current (Rotation) environment, so default an unset
    // legality to "Rotation". That makes shared cards visible under the deckbuilder's default
    // legality filter; a designer can still explicitly pick another legality in the card editor.
    legality: data.legality ?? "Rotation",
    testament: "",
    isGospel: false,
  };
}
