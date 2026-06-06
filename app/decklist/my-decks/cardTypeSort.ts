import { DeckCardData } from "../actions";

// Display order for grouping cards by type (good cards → evil → lands).
// Combo types (e.g. "GE/EE", "Hero/Evil Character") rank by their leading type.
export function typeRank(type: string | undefined): number {
  const t = (type || "").toLowerCase();
  if (t.includes("dominant")) return 0;
  if (t.includes("hero")) return 1;
  if (t.includes("good enhancement") || t.startsWith("ge")) return 2;
  if (t.includes("artifact")) return 3;
  if (t.includes("covenant")) return 4;
  if (t.includes("lost soul")) return 5;
  if (t.includes("evil character")) return 6;
  if (t.includes("evil enhancement") || t.startsWith("ee")) return 7;
  if (t.includes("curse")) return 8;
  if (t.includes("site")) return 9;
  if (t.includes("city")) return 10;
  if (t.includes("fortress")) return 11;
  return 99;
}

export function cardKey(c: DeckCardData): string {
  return `${c.card_name}|${c.card_set ?? ""}|${c.card_img_file ?? ""}`;
}

// Build a key→type-rank map for a card list, lazy-loading the (large) generated
// card dataset so it stays out of route bundles until a card grid is opened.
export async function buildTypeRanks(list: DeckCardData[]): Promise<Record<string, number>> {
  const { findCard } = await import("@/lib/cards/lookup");
  const ranks: Record<string, number> = {};
  for (const c of list) {
    ranks[cardKey(c)] = typeRank(findCard(c.card_name, c.card_set, c.card_img_file)?.type);
  }
  return ranks;
}
