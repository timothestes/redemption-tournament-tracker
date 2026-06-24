"use server";

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";

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
