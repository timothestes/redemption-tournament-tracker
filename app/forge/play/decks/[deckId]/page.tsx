import { notFound } from "next/navigation";
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
  const deck = isNew ? null : await getForgeDeck(deckId);
  if (!isNew && !deck) notFound();

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold">{isNew ? "New deck" : deck!.name}</h1>
      <DeckBuilder
        deckId={isNew ? null : deck!.id}
        initialName={isNew ? "" : deck!.name}
        initialFormat={isNew ? "Type 1" : deck!.format}
        initialEntries={isNew ? [] : deck!.entries}
        granted={granted}
      />
    </main>
  );
}
