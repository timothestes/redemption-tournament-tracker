import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import StudioEditor from "./StudioEditor";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ cardId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { cardId } = await params;
  const card = await getCard(cardId);
  if (!card) notFound();
  return <StudioEditor card={card} />;
}
