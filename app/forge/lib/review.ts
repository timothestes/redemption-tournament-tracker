"use server";

import { requireForge } from "@/app/forge/lib/auth";

export type ReviewQueueItem = {
  cardId: string;
  title: string | null;
  status: string;
  openProposals: number;
  openSuggestions: number;
};

// Cards in a set that have open proposals or unresolved field-anchored suggestions.
// (General unresolved comments are NOT counted — only suggestions with a value.)
export async function getSetReviewQueue(setId: string): Promise<ReviewQueueItem[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, status")
    .eq("set_id", setId);
  const list = cards ?? [];
  if (list.length === 0) return [];
  const ids = list.map((c: any) => c.id);

  const { data: props } = await ctx.supabase
    .from("card_proposals")
    .select("card_id")
    .eq("status", "open")
    .in("card_id", ids);

  const { data: sugg } = await ctx.supabase
    .from("card_comments")
    .select("card_id")
    .eq("resolved", false)
    .not("field", "is", null)
    .not("suggested_value", "is", null)
    .in("card_id", ids);

  const pc = new Map<string, number>();
  for (const p of props ?? []) pc.set(p.card_id, (pc.get(p.card_id) ?? 0) + 1);
  const sc = new Map<string, number>();
  for (const s of sugg ?? []) sc.set(s.card_id, (sc.get(s.card_id) ?? 0) + 1);

  return list
    .map((c: any) => ({
      cardId: c.id,
      title: c.title ?? null,
      status: c.status,
      openProposals: pc.get(c.id) ?? 0,
      openSuggestions: sc.get(c.id) ?? 0,
    }))
    .filter((i) => i.openProposals > 0 || i.openSuggestions > 0)
    .sort((a, b) => b.openProposals + b.openSuggestions - (a.openProposals + a.openSuggestions));
}
