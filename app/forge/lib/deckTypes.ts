// Pure shared types for Forge decks. NOT a "use server" file (those may only export
// async functions), so the actions module + pure helpers can both import these.
import type { DeckZone } from "@/app/decklist/card-search/types/deck";

export type ForgeDeckEntry =
  | { source: "public"; name: string; set: string; qty: number; zone: DeckZone }
  | { source: "forge"; cardId: string; qty: number; zone: DeckZone };

export type SaveForgeDeckInput = {
  id?: string;
  name: string;
  format: string;
  paragon?: string | null;
  entries: ForgeDeckEntry[];
};

export type ForgeDeckSummary = { id: string; name: string; format: string; cardCount: number; updatedAt: string };
export type ForgeDeckDetail = { id: string; name: string; format: string; paragon: string | null; entries: ForgeDeckEntry[] };
