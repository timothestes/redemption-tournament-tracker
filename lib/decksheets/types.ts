import type { CardData } from "@/lib/cards/lookup";

export interface DeckEntry { quantity: number; name: string }
export interface ParsedDeck { main: DeckEntry[]; reserve: DeckEntry[]; hasReserve: boolean }

export interface ResolvedCard extends CardData {
  quantity: number;
  rawBrigade: string;
  brigades: string[];
}
export interface ResolvedDeck {
  main: Map<string, ResolvedCard>;
  reserve: Map<string, ResolvedCard>;
  mainSize: number;
  reserveSize: number;
}
export type DeckType = string; // "type_1" | "type_2" | "paragon" pass through untyped, like the Python
