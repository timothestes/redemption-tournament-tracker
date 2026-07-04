// Pure serializer for forge play decks. LEAK SPINE: forge entries become
// opaque stubs — the UUID rides cardImgFile as `forge:<uuid>`; every text
// field stays ''. Public entries get the same enrichment loadDeckForGame uses.
import { findCard } from "@/lib/cards/lookup";
import { getParagonByName } from "@/app/decklist/card-search/data/paragons";
import type { ForgeDeckEntry } from "./deckTypes";
import type { GameCardData } from "@/app/play/actions";

export function buildForgePlayDeck(
  entries: ForgeDeckEntry[],
  isGranted: (cardId: string) => boolean,
): { deckData: GameCardData[]; dropped: number } {
  const deckData: GameCardData[] = [];
  let dropped = 0;
  for (const e of entries) {
    if (e.zone !== "main" && e.zone !== "reserve") continue; // game sees main + reserve only
    const isReserve = e.zone === "reserve";
    if (e.source === "forge") {
      if (!isGranted(e.cardId)) { dropped += e.qty; continue; }
      for (let i = 0; i < e.qty; i++) {
        deckData.push({
          cardName: "", cardSet: "Forge", cardImgFile: `forge:${e.cardId}`,
          cardType: "", brigade: "", strength: "", toughness: "", alignment: "",
          identifier: "", reference: "", specialAbility: "", isReserve,
        });
      }
    } else {
      const enriched = findCard(e.name, e.set);
      for (let i = 0; i < e.qty; i++) {
        deckData.push({
          cardName: e.name, cardSet: e.set,
          cardImgFile: enriched?.imgFile || "",
          cardType: enriched?.type || "", brigade: enriched?.brigade || "",
          strength: enriched?.strength || "", toughness: enriched?.toughness || "",
          alignment: enriched?.alignment || "", identifier: enriched?.identifier || "",
          reference: enriched?.reference || "", specialAbility: enriched?.specialAbility || "",
          isReserve,
        });
      }
    }
  }
  return { deckData, dropped };
}

// Player.paragon / Game.rematchParagon* are world-readable STDB strings —
// only names from the public paragon registry may pass through.
export function sanitizeParagon(paragon: string | null | undefined): string {
  if (!paragon) return "";
  return getParagonByName(paragon) ? paragon : "";
}
