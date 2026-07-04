import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireForge } from "@/app/forge/lib/auth";
import { getForgeDeck } from "@/app/forge/lib/forgeDecks";
import { listGrantedForgeCards } from "@/app/forge/lib/deckPool";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
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
  let deckName: string | null = null;
  if (!isNew) {
    const deck = await getForgeDeck(deckId);
    if (!deck) notFound();
    deckName = deck.name;
  }

  // CardSearchClient uses useSearchParams → needs a Suspense boundary.
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-3 [&>nav]:mb-0">
        <ForgeBreadcrumbs
          items={[
            { label: "The Forge", href: "/forge" },
            { label: "Decks", href: "/forge/play/decks" },
            { label: deckName ?? "New deck" },
          ]}
        />
      </div>
      <Suspense>
        <DeckBuilder deckId={isNew ? null : deckId} isNew={isNew} granted={granted} />
      </Suspense>
    </>
  );
}
