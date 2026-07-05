"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const config = useMemo(
    () => ({
      ...makeForgeBuilderConfig(granted),
      // Load Deck loads in place; keep /forge/play/decks/<id> honest so
      // refresh and back land on the deck actually shown.
      onDeckLoaded: (id: string) => window.history.replaceState(null, "", `/forge/play/decks/${id}`),
      // After delete the builder route no longer points at a live deck — send
      // the user back to their deck list.
      onDeckDeleted: () => router.push("/forge/play/decks"),
    }),
    [granted, router]
  );
  return (
    <CardSearchClient
      config={config}
      initialDeckId={isNew ? undefined : deckId ?? undefined}
      initialIsNew={isNew}
    />
  );
}
