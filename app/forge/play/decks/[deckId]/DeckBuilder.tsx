"use client";

import { useMemo } from "react";
import CardSearchClient from "@/app/decklist/card-search/client";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import { makeForgeBuilderConfig } from "./forgeBuilderConfig";

/**
 * The Forge deck builder is now the main player-facing builder (CardSearchClient)
 * parameterized by a Forge DeckBuilderConfig — mixed pool, forge-aware art,
 * forge_decks persistence, public-only features off. No bespoke UI.
 */
export default function DeckBuilder({
  deckId,
  isNew,
  granted,
}: {
  deckId: string | null; // null = new deck
  isNew: boolean;
  granted: GrantedForgeCard[];
}) {
  const config = useMemo(() => makeForgeBuilderConfig(granted), [granted]);
  return (
    <CardSearchClient
      config={config}
      initialDeckId={isNew ? undefined : deckId ?? undefined}
      initialIsNew={isNew}
    />
  );
}
