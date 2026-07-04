"use server";

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";
import { isEligible, type LifecycleAction } from "@/app/forge/lib/lifecycleCopy";

type Result = { ok: boolean; error?: string };

async function call(fn: string, args: Record<string, unknown>, fail: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc(fn, args);
  if (error) return { ok: false, error: fail };
  // Card and set views both depend on lifecycle; refresh broadly.
  revalidatePath("/forge", "layout");
  return { ok: true };
}

export async function shareToSet(cardId: string, setId: string): Promise<Result> {
  return call("forge_share_card_to_set", { p_card_id: cardId, p_set_id: setId }, "Could not share card");
}
export async function sendToPrivate(cardId: string): Promise<Result> {
  return call("forge_send_card_to_private", { p_card_id: cardId }, "Could not send card to private");
}
export async function publish(cardId: string): Promise<Result> {
  return call("forge_publish_card", { p_card_id: cardId }, "Could not publish card");
}
export async function approve(cardId: string): Promise<Result> {
  return call("forge_approve_card", { p_card_id: cardId }, "Could not approve card");
}
export async function unapprove(cardId: string): Promise<Result> {
  return call("forge_unapprove_card", { p_card_id: cardId }, "Could not unapprove card");
}
export async function archive(cardId: string): Promise<Result> {
  return call("forge_archive_card", { p_card_id: cardId }, "Could not archive card");
}
export async function unarchive(cardId: string): Promise<Result> {
  return call("forge_unarchive_card", { p_card_id: cardId }, "Could not unarchive card");
}
export async function deleteCard(cardId: string): Promise<Result> {
  return call("forge_delete_card", { p_card_id: cardId }, "Could not delete card");
}

export type BulkResult =
  | { ok: true; done: number; skipped: number; failed: number }
  | { ok: false; error: string };

const BULK_RPC: Record<LifecycleAction, string> = {
  release: "forge_publish_card",
  markFinal: "forge_approve_card",
  reopen: "forge_unapprove_card",
  shelve: "forge_archive_card",
  restore: "forge_unarchive_card",
  returnToIdeas: "forge_send_card_to_private",
  delete: "forge_delete_card",
};

// Statuses are read once up front (RLS-scoped) and ineligible cards are skipped
// deterministically — no Postgres error-string parsing. Ids RLS hides are skipped too.
async function runBulk(
  cardIds: string[],
  eligible: (status: string) => boolean,
  call: (supabase: any, id: string) => Promise<{ error: any }>,
): Promise<BulkResult> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (cardIds.length === 0) return { ok: true, done: 0, skipped: 0, failed: 0 };
  if (cardIds.length > 500) return { ok: false, error: "Too many cards selected" };

  const { data: rows, error: readErr } = await ctx.supabase
    .from("forge_cards")
    .select("id, status")
    .in("id", cardIds);
  if (readErr) return { ok: false, error: "Could not read cards" };
  const byId = new Map((rows ?? []).map((r: any) => [r.id as string, r.status as string]));

  let done = 0, skipped = 0, failed = 0;
  for (const id of cardIds) {
    const status = byId.get(id);
    if (!status || !eligible(status)) { skipped++; continue; }
    const { error } = await call(ctx.supabase, id);
    if (error) failed++; else done++;
  }
  revalidatePath("/forge", "layout");
  return { ok: true, done, skipped, failed };
}

export async function bulkLifecycle(action: LifecycleAction, cardIds: string[]): Promise<BulkResult> {
  const fn = BULK_RPC[action];
  if (!fn) return { ok: false, error: "Unknown action" };
  return runBulk(
    cardIds,
    (status) => isEligible(action, status),
    (supabase, id) => supabase.rpc(fn, { p_card_id: id }),
  );
}

export async function bulkShareToSet(setId: string, cardIds: string[]): Promise<BulkResult> {
  return runBulk(
    cardIds,
    (status) => status === "private_idea",
    (supabase, id) => supabase.rpc("forge_share_card_to_set", { p_card_id: id, p_set_id: setId }),
  );
}
