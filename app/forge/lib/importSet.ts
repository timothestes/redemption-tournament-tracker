"use server";

// Lackey set import: creates one Forge card from a parsed carddata row + optional
// finished-card image. Elder-gated; every write goes through the existing SECURITY
// DEFINER RPCs, which re-check authorization — same trust model as cards.ts.

import { revalidatePath } from "next/cache";
import { requireElder } from "./auth";
import { uploadForgeFinished, validateArtFile } from "./art";
import type { DesignCard } from "./designCard";

const MAX_NAME_LENGTH = 200;
const MAX_SNAPSHOT_BYTES = 32_000; // forge_save_card enforces 64KB; fail earlier & clearer

export interface ImportCardInput { name: string; snapshot: DesignCard; }
export type ImportCardResult =
  | { ok: true; cardId: string; skipped: boolean }
  | { ok: false; error: string };

export async function importLackeyCard(
  setId: string,
  input: ImportCardInput,
  formData: FormData,
): Promise<ImportCardResult> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not available" };

  const name = (input?.name ?? "").trim();
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, error: "Invalid card name" };

  let snapshotBytes = 0;
  try {
    snapshotBytes = new TextEncoder().encode(JSON.stringify(input.snapshot ?? {})).length;
  } catch {
    return { ok: false, error: "Invalid card data" };
  }
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) return { ok: false, error: "Card data too large" };

  const fileEntry = formData.get("file");
  if (fileEntry !== null && !(fileEntry instanceof File)) return { ok: false, error: "Invalid image" };
  // Explicit re-narrow: with strict:false, TS won't narrow FormDataEntryValue via the guard above.
  const file = fileEntry instanceof File ? fileEntry : null;
  if (file) {
    const invalid = validateArtFile(file);
    if (invalid) return { ok: false, error: invalid };
  }

  // Idempotency: a card with this title already in the target set → skip (safe re-runs).
  const { data: existing, error: existErr } = await ctx.supabase
    .from("forge_cards")
    .select("id")
    .eq("set_id", setId)
    .eq("title", name)
    .limit(1);
  if (existErr) return { ok: false, error: existErr.message };
  if (existing && existing.length > 0) {
    return { ok: true, cardId: existing[0].id as string, skipped: true };
  }

  const { data: cardId, error: createErr } = await ctx.supabase
    .rpc("forge_create_card", { p_title: name });
  if (createErr || !cardId) {
    return { ok: false, error: createErr?.message ?? "Failed to create card" };
  }

  const { error: saveErr } = await ctx.supabase
    .rpc("forge_save_card", { p_card_id: cardId, p_snapshot: input.snapshot ?? {} });
  if (saveErr) return { ok: false, error: saveErr.message };

  if (file) {
    let key: string;
    try {
      key = await uploadForgeFinished(file);
    } catch {
      return { ok: false, error: "Image upload failed" };
    }
    const { error: artErr } = await ctx.supabase
      .rpc("forge_set_working_finished", { p_card_id: cardId, p_key: key });
    if (artErr) return { ok: false, error: artErr.message };
  }

  const { error: shareErr } = await ctx.supabase
    .rpc("forge_share_card_to_set", { p_card_id: cardId, p_set_id: setId });
  if (shareErr) return { ok: false, error: shareErr.message };

  revalidatePath(`/forge/sets/${setId}/cards`);
  return { ok: true, cardId: cardId as string, skipped: false };
}
