// Pure resolver for the read-only Forge deck view: stored ForgeDeckEntry[] +
// the viewer's granted pool → renderable items with the grouping/sorting
// semantics of the public deck page. No "use client"/"use server" — imported
// by the view client component and unit tests.
//
// A forge ref the viewer has no grant for resolves with `data: null` (the set
// isn't shared with them, or the card was deleted); the view renders those as
// explicit placeholder tiles rather than dropping them, so counts stay honest.
import type { DeckZone } from "@/app/decklist/card-search/types/deck";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DesignCard } from "@/app/forge/lib/designCard";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import type { ForgeDeckEntry } from "@/app/forge/lib/deckTypes";
import { designCardToCard } from "@/app/forge/lib/deckAdapter";
import { ALL_CARDS } from "@/app/decklist/card-search/data/cardIndex";

export type ResolvedDeckItem = {
  key: string;
  qty: number;
  zone: DeckZone;
  name: string;
  type: string;      // display type ("Hero", "Good Enhancement", …)
  alignment: string;
  brigade: string;
  // Present for forge entries; data null = ref the viewer can't resolve.
  forge: { cardId: string; data: DesignCard | null; hasArt: boolean; hasFinished: boolean } | null;
  imgFile: string;   // public card image file; "" for forge entries
};

// Same abbreviation → display mapping as the public deck page.
const TYPE_PRETTY: Record<string, string> = {
  GE: "Good Enhancement",
  EE: "Evil Enhancement",
  EC: "Evil Character",
  HC: "Hero Character",
  GC: "Good Character",
  LS: "Lost Soul",
  Dom: "Dominant",
  Cov: "Covenant",
  Cur: "Curse",
  Art: "Artifact",
  Fort: "Fortress",
  "Hero/GE": "Good Enhancement",
  "Evil Character/EE": "Evil Enhancement",
};

export function prettifyTypeName(type: string): string {
  return TYPE_PRETTY[type] || type;
}

export function getGroupKey(type: string): string {
  const pretty = prettifyTypeName(type);
  if (pretty === "Artifact" || pretty === "Covenant" || pretty === "Curse") {
    return "Artifact/Covenant/Curse";
  }
  if (pretty === "Fortress" || pretty === "Site" || pretty === "City") {
    return "Fortress/Site";
  }
  return pretty;
}

const GROUP_DISPLAY: Record<string, string> = {
  Hero: "Heroes",
  "Good Enhancement": "Good Enhancements",
  "Evil Character": "Evil Characters",
  "Evil Enhancement": "Evil Enhancements",
  "Dual-Alignment Enhancement": "Dual-Alignment Enhancements",
  "Lost Soul": "Lost Souls",
  "Artifact/Covenant/Curse": "Artifacts / Covenants / Curses",
  "Fortress/Site": "Fortresses / Sites",
  Dominant: "Dominants",
  "Forge Card": "Forge Cards",
};

export function getGroupDisplayName(group: string): string {
  return GROUP_DISPLAY[group] || group;
}

export function resolveDeckEntries(
  granted: GrantedForgeCard[],
  entries: ForgeDeckEntry[],
  publicCards: Card[] = ALL_CARDS,
): ResolvedDeckItem[] {
  const forgeById = new Map(granted.map((g) => [g.cardId, g]));
  const publicByKey = new Map(publicCards.map((c) => [`${c.name}|${c.set}`, c]));

  return entries.map((e, i): ResolvedDeckItem => {
    if (e.source === "forge") {
      const g = forgeById.get(e.cardId) ?? null;
      const card = g ? designCardToCard(g.data, g.cardId, g.setName) : null;
      return {
        key: `forge:${e.cardId}:${e.zone}:${i}`,
        qty: e.qty,
        zone: e.zone,
        name: card?.name ?? "Forge card",
        // Dangling refs have no card data; group them under an explicit
        // heading instead of an empty one.
        type: card?.type ?? "Forge Card",
        alignment: card?.alignment ?? "",
        brigade: card?.brigade ?? "",
        forge: {
          cardId: e.cardId,
          data: g?.data ?? null,
          hasArt: g?.hasApprovedArt ?? false,
          hasFinished: g?.hasApprovedFinished ?? false,
        },
        imgFile: "",
      };
    }
    const pc = publicByKey.get(`${e.name}|${e.set}`) ?? null;
    return {
      key: `public:${e.name}|${e.set}:${e.zone}:${i}`,
      qty: e.qty,
      zone: e.zone,
      name: e.name,
      type: pc?.type ?? "",
      alignment: pc?.alignment ?? "",
      brigade: pc?.brigade ?? "",
      forge: null,
      imgFile: pc?.imgFile ?? "",
    };
  });
}

export type DeckGroupBy = "type" | "alignment" | "none";

// Group main-deck items by display group, sorted within each group by
// alignment (Good > Evil > Neutral) → brigade → name. Type groups sort
// alphabetically; alignment groups follow the Good > Evil > Neutral order.
export function groupMainItems(
  items: ResolvedDeckItem[],
  groupBy: DeckGroupBy = "type",
): [string, ResolvedDeckItem[]][] {
  const alignmentOrder = ["Good", "Evil", "Neutral"];
  const grouped = new Map<string, ResolvedDeckItem[]>();
  for (const item of items) {
    const key =
      groupBy === "alignment" ? (item.alignment || "Neutral")
      : groupBy === "none" ? "All Cards"
      : getGroupKey(item.type);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => {
      const aIdx = alignmentOrder.indexOf(a.alignment);
      const bIdx = alignmentOrder.indexOf(b.alignment);
      const aOrder = aIdx === -1 ? 999 : aIdx;
      const bOrder = bIdx === -1 ? 999 : bIdx;
      if (aOrder !== bOrder) return aOrder - bOrder;
      if (a.brigade !== b.brigade) return a.brigade.localeCompare(b.brigade);
      return a.name.localeCompare(b.name);
    });
  }
  return [...grouped.entries()].sort(([a], [b]) => {
    if (groupBy === "alignment") {
      const aIdx = alignmentOrder.indexOf(a);
      const bIdx = alignmentOrder.indexOf(b);
      const diff = (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      if (diff !== 0) return diff;
    }
    return a.localeCompare(b);
  });
}

// Split a group into balanced columns of at most ~maxPerColumn physical cards
// (quantities expanded) for the stacked view — same algorithm as the public
// deck page's splitGroup.
export function splitStack(items: ResolvedDeckItem[], maxPerColumn = 17): ResolvedDeckItem[][] {
  const totalCards = items.reduce((sum, i) => sum + i.qty, 0);
  if (totalCards <= maxPerColumn) return [items];

  const numColumns = Math.ceil(totalCards / maxPerColumn);
  const targetPerColumn = Math.ceil(totalCards / numColumns);

  const columns: ResolvedDeckItem[][] = [];
  let currentColumn: ResolvedDeckItem[] = [];
  let currentCount = 0;

  for (const item of items) {
    if (currentCount + item.qty > targetPerColumn && currentColumn.length > 0) {
      const distWithout = Math.abs(currentCount - targetPerColumn);
      const distWith = Math.abs(currentCount + item.qty - targetPerColumn);
      if (distWith > distWithout) {
        columns.push(currentColumn);
        currentColumn = [item];
        currentCount = item.qty;
        continue;
      }
    }
    currentColumn.push(item);
    currentCount += item.qty;
  }

  if (currentColumn.length > 0) columns.push(currentColumn);
  return columns;
}

// Reserve/maybeboard: flat, sorted by display type then name (public page semantics).
export function sortSideItems(items: ResolvedDeckItem[]): ResolvedDeckItem[] {
  return [...items].sort((a, b) => {
    const typeA = prettifyTypeName(a.type);
    const typeB = prettifyTypeName(b.type);
    if (typeA !== typeB) return typeA.localeCompare(typeB);
    return a.name.localeCompare(b.name);
  });
}

export function countItems(items: ResolvedDeckItem[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}
