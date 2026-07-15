import { DeckCardData } from "../actions";
import { compareCardsByType, type SortableCard } from "@/lib/cards/defaultSort";

export function cardKey(c: DeckCardData): string {
  return `${c.card_name}|${c.card_set ?? ""}|${c.card_img_file ?? ""}`;
}

// Build a key→SortableCard map for a card list, lazy-loading the (large)
// generated card dataset so it stays out of route bundles until a card grid is
// opened. The stored deck rows only carry names, so type/brigade/strength/
// reference come from the card database.
export async function buildSortInfo(list: DeckCardData[]): Promise<Record<string, SortableCard>> {
  const { findCard } = await import("@/lib/cards/lookup");
  const info: Record<string, SortableCard> = {};
  for (const c of list) {
    const found = findCard(c.card_name, c.card_set, c.card_img_file);
    info[cardKey(c)] = {
      name: c.card_name,
      type: found?.type ?? "",
      brigade: found?.brigade,
      alignment: found?.alignment,
      strength: found?.strength,
      reference: found?.reference,
    };
  }
  return info;
}

// Classic by-type deck order over deck rows, backed by a buildSortInfo map.
// Before the map loads (or on a lookup miss) cards degrade to name-only
// sortables, which the comparator still orders alphabetically.
export function compareDeckCards(
  info: Record<string, SortableCard>,
  a: DeckCardData,
  b: DeckCardData,
): number {
  const sa = info[cardKey(a)] ?? { name: a.card_name, type: "" };
  const sb = info[cardKey(b)] ?? { name: b.card_name, type: "" };
  return compareCardsByType(sa, sb);
}
