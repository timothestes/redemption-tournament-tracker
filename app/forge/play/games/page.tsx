import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeDecks } from "@/app/forge/lib/forgeDecks";
import ForgeGameLobby from "./ForgeGameLobby";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgePlaytestGamesPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const decks = await listForgeDecks();
  const { data: member } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  const displayName = member?.display_name || ctx.user.email?.split("@")[0] || "Playtester";
  return <ForgeGameLobby decks={decks} displayName={displayName} userId={ctx.user.id} />;
}
