import { notFound } from "next/navigation";
import { requireElder } from "@/app/forge/lib/auth";
import { listMyForgeCards } from "@/app/forge/lib/cards";
import ArtPanel from "./ArtPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeArtPage() {
  const ctx = await requireElder();
  if (!ctx) notFound();
  const cards = await listMyForgeCards();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Card Art
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload private art for your cards. Art is served only to Forge members through an authenticated proxy.
      </p>
      <ArtPanel cards={cards} />
    </main>
  );
}
