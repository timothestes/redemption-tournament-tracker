"use server";

import { requireForge } from "@/app/forge/lib/auth";
import type { ReviewCardRow, ReviewOpenItem } from "@/app/forge/lib/reviewView";

export type SetReviewQueue = { cards: ReviewCardRow[]; items: ReviewOpenItem[] };

// Open proposals and unresolved field-anchored suggestions on a set's cards.
// (General unresolved comments are NOT counted — only suggestions with a value.)
// Returns the raw open items, with `cards` narrowed to those holding at least
// one; buildReviewQueue() does the counting so the client can re-filter by date
// or kind without another round trip.
export async function getSetReviewQueue(setId: string): Promise<SetReviewQueue> {
  const ctx = await requireForge();
  if (!ctx) return { cards: [], items: [] };
  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, status")
    .eq("set_id", setId);
  const list = cards ?? [];
  if (list.length === 0) return { cards: [], items: [] };
  const ids = list.map((c: any) => c.id);

  const { data: props } = await ctx.supabase
    .from("card_proposals")
    .select("card_id, created_at")
    .eq("status", "open")
    .in("card_id", ids);

  const { data: sugg } = await ctx.supabase
    .from("card_comments")
    .select("card_id, created_at")
    .eq("resolved", false)
    .not("field", "is", null)
    .not("suggested_value", "is", null)
    .in("card_id", ids);

  const items: ReviewOpenItem[] = [
    ...(props ?? []).map((p: any) => ({ cardId: p.card_id, kind: "proposal" as const, createdAt: p.created_at })),
    ...(sugg ?? []).map((s: any) => ({ cardId: s.card_id, kind: "suggestion" as const, createdAt: s.created_at })),
  ];
  const open = new Set(items.map((i) => i.cardId));

  return {
    cards: list
      .filter((c: any) => open.has(c.id))
      .map((c: any) => ({ id: c.id, title: c.title ?? null, status: c.status })),
    items,
  };
}
