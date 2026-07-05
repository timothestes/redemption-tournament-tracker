import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeDecks } from "@/app/forge/lib/forgeDecks";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import DeckList from "./DeckList";

export const dynamic = "force-dynamic";

export default async function ForgeDecksPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const decks = await listForgeDecks();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <ForgeBreadcrumbs items={[{ label: "The Forge", href: "/forge" }, { label: "Decks" }]} />
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Your decks</h1>
      <p className="mt-1 text-sm text-muted-foreground">Build with the cards shared with you, plus the full card pool.</p>
      <DeckList decks={decks} />
    </main>
  );
}
