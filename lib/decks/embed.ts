// The serialisable shape an article deck embed renders from, and the pure
// builder that groups a deck the same way the public deck page does. Card
// data comes in through `lookup` so this stays testable without the 2.9 MB
// index and never lands in a client bundle.
import { compareCardsByType, compareTypeGroups, type SortableCard } from "@/lib/cards/defaultSort";
import { getGroupDisplayName, getGroupKey } from "./typeGroups";

export interface DeckEmbedCard {
  name: string;
  set: string | null;
  imgFile: string | null;
  quantity: number;
  type: string;
}

export interface DeckEmbedGroup {
  label: string;
  /** Sum of quantities in the group. */
  count: number;
  cards: DeckEmbedCard[];
}

export interface DeckEmbedData {
  id: string;
  name: string;
  format: string | null;
  username: string | null;
  cardCount: number;
  reserveCount: number;
  /** Main deck, canonical type order. */
  groups: DeckEmbedGroup[];
  /** Sorted; empty when the deck has no reserve. */
  reserve: DeckEmbedCard[];
}

/** Structural subset of lib/api/cache's DetailPayload. */
export interface DeckEmbedSource {
  id: string;
  name: string;
  format: string | null;
  username: string | null;
  cards: { name: string; set: string | null; card_img_file: string | null; quantity: number; zone: string }[];
}

export type CardInfo = Pick<SortableCard, "type" | "brigade" | "alignment" | "strength" | "reference">;
export type CardInfoLookup = (name: string, set?: string, imgFile?: string) => CardInfo | undefined;

export function buildDeckEmbed(src: DeckEmbedSource, lookup: CardInfoLookup): DeckEmbedData {
  const sortable = new Map<DeckEmbedCard, SortableCard>();
  const enrich = (c: DeckEmbedSource["cards"][number]): DeckEmbedCard => {
    const info = lookup(c.name, c.set ?? undefined, c.card_img_file ?? undefined);
    const card: DeckEmbedCard = {
      name: c.name,
      set: c.set,
      imgFile: c.card_img_file,
      quantity: c.quantity,
      type: info?.type ?? "",
    };
    sortable.set(card, { name: c.name, ...info, type: info?.type ?? "" });
    return card;
  };
  const cmp = (a: DeckEmbedCard, b: DeckEmbedCard) => compareCardsByType(sortable.get(a)!, sortable.get(b)!);
  const sum = (cards: DeckEmbedCard[]) => cards.reduce((n, c) => n + c.quantity, 0);

  // Maybeboard is excluded everywhere a deck is presented; keep that here.
  const main = src.cards.filter((c) => (c.zone ?? "main") === "main").map(enrich);
  const reserve = src.cards.filter((c) => c.zone === "reserve").map(enrich).sort(cmp);

  const buckets = new Map<string, DeckEmbedCard[]>();
  for (const card of main) {
    const key = getGroupKey(card.type || "Other");
    const list = buckets.get(key);
    if (list) list.push(card);
    else buckets.set(key, [card]);
  }
  const groups: DeckEmbedGroup[] = [...buckets.keys()].sort(compareTypeGroups).map((key) => {
    const cards = buckets.get(key)!.sort(cmp);
    return { label: getGroupDisplayName(key), count: sum(cards), cards };
  });

  return {
    id: src.id,
    name: src.name,
    format: src.format,
    username: src.username,
    cardCount: sum(main),
    reserveCount: sum(reserve),
    groups,
    reserve,
  };
}
