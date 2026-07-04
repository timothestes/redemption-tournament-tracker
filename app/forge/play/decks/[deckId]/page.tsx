import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireForge } from "@/app/forge/lib/auth";
import { getForgeDeck } from "@/app/forge/lib/forgeDecks";
import { listGrantedForgeCards } from "@/app/forge/lib/deckPool";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import DeckBuilder from "./DeckBuilder";
import DeleteDeckButton from "./DeleteDeckButton";

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
      {/* Slim toolbar attached under ForgeNav — full-width with the builder
          (not max-w-centered) and opaque so the page backdrop can't bleed
          through in dark mode. */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2 [&>nav]:mb-0">
        <ForgeBreadcrumbs
          items={[
            { label: "The Forge", href: "/forge" },
            { label: "Decks", href: "/forge/play/decks" },
            { label: deckName ?? "New deck" },
          ]}
        />
        {!isNew && <DeleteDeckButton deckId={deckId} deckName={deckName ?? "this deck"} />}
      </div>
      <Suspense>
        <DeckBuilder deckId={isNew ? null : deckId} isNew={isNew} granted={granted} />
      </Suspense>
    </>
  );
}
