// Playtester reveal reader. SERVER-ONLY: it reads under the caller's RLS (a granted
// playtester can SELECT a granted set's approved cards/versions). It exposes only the
// DesignCard payload + a hasApprovedArt boolean — never a blob key (use the
// /forge/api/art/<id>?v=approved proxy to render the image).
import { requireForge } from "@/app/forge/lib/auth";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type RevealCard = { cardId: string; data: DesignCard; hasApprovedArt: boolean };

export async function listSetApprovedCards(setId: string): Promise<RevealCard[]> {
  const ctx = await requireForge();
  if (!ctx) return [];

  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, approved_version_id")
    .eq("set_id", setId)
    .eq("status", "approved")
    .not("approved_version_id", "is", null);

  const byVersion = new Map<string, string>(); // version_id -> card_id
  for (const c of cards ?? []) {
    if (c.approved_version_id) byVersion.set(c.approved_version_id, c.id);
  }
  if (byVersion.size === 0) return [];

  const { data: versions } = await ctx.supabase
    .from("card_versions")
    .select("id, card_id, data, art_key, art_original_key, art_is_placeholder")
    .eq("status", "approved") // self-defend: don't lean solely on the approve RPC keeping these in lockstep
    .in("id", Array.from(byVersion.keys()));

  return (versions ?? []).map((v: any): RevealCard => ({
    cardId: v.card_id as string,
    data: (v.data ?? {}) as DesignCard,
    hasApprovedArt: !!(v.art_original_key ?? v.art_key) && !v.art_is_placeholder,
  }));
}
