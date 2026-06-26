import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireForge } from "@/app/forge/lib/auth";
import { getForgeDeck } from "@/app/forge/lib/forgeDecks";
import { listGrantedForgeCards } from "@/app/forge/lib/deckPool";
import DeckBuilder from "./DeckBuilder";

export const dynamic = "force-dynamic";

export default async function ForgeDeckBuilderPage({ params }: { params: Promise<{ deckId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { deckId } = await params;
  const isNew = deckId === "new";

  const granted = await listGrantedForgeCards();
  // The builder loads the deck itself via the persistence seam; here we only
  // 404 a non-existent id so we don't drop the user into a blank builder.
  if (!isNew) {
    const deck = await getForgeDeck(deckId);
    if (!deck) notFound();
  }

  // CardSearchClient uses useSearchParams → needs a Suspense boundary.
  return (
    <Suspense>
      <DeckBuilder deckId={isNew ? null : deckId} isNew={isNew} granted={granted} />
    </Suspense>
  );
}
