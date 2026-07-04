import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSetCards } from "@/app/forge/lib/sets";
import SetCardsBrowser from "./SetCardsBrowser";

export const dynamic = "force-dynamic";

export default async function SetCardsPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const { setId } = await params;
  const cards = await listSetCards(setId);
  if (cards.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-xs text-center">
        <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
        <p className="text-sm text-muted-foreground">No cards in this set yet. Share an idea from your sketchbook.</p>
      </div>
    );
  }
  return <SetCardsBrowser cards={cards} />;
}
