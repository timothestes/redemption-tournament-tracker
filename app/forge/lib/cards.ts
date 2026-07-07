"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt, uploadForgeFinished } from "@/app/forge/lib/art";
import type { DesignCard } from "@/app/forge/lib/designCard";

export async function createCard(
  title: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_create_card", { p_title: title });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create card" };
  revalidatePath("/forge/ideas");
  return { ok: true, id: data };
}

// Create a card already placed in a set (the "New card in this set" tile). The RPC
// enforces set-elder; requireForge is enough here since the RPC is the real gate.
export async function createCardInSet(
  setId: string,
  title: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_create_card_in_set", {
    p_title: title,
    p_set_id: setId,
  });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create card" };
  revalidatePath(`/forge/sets/${setId}/cards`);
  return { ok: true, id: data };
}

export async function uploadArt(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  let key: string;
  try {
    key = await uploadForgeArt(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
  // Art is normalized at upload (trim/resize/JPEG); original_key mirrors the stored key.
  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: key,
    p_original_key: key,
  });
  if (error) return { ok: false, error: "Could not save art" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}

export async function uploadFinished(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  let key: string;
  try {
    key = await uploadForgeFinished(file);
  } catch {
    return { ok: false, error: "Could not read image file." };
  }
  const { error } = await ctx.supabase.rpc("forge_set_working_finished", {
    p_card_id: cardId,
    p_key: key,
  });
  if (error) return { ok: false, error: "Could not save finished card" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}

export async function setPlaceholder(
  cardId: string,
  isPlaceholder: boolean
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_set_art_placeholder", {
    p_card_id: cardId,
    p_is_placeholder: isPlaceholder,
  });
  if (error) return { ok: false, error: "Could not update placeholder" };
  revalidatePath("/forge/ideas");
  return { ok: true };
}

export type ForgeCardFull = {
  id: string;
  title: string | null;
  snapshot: DesignCard;
  hasArt: boolean;
  hasFinished: boolean;
  isPlaceholder: boolean;
  status: string;
  updatedAt: string;
  setId: string | null;
  publishedVersionId: string | null;
  approvedVersionId: string | null;
};

function toFull(row: any): ForgeCardFull {
  return {
    id: row.id,
    title: row.title,
    snapshot: (row.working_snapshot ?? {}) as DesignCard,
    hasArt: !!row.working_art_key,
    hasFinished: !!row.working_finished_key,
    isPlaceholder: !!row.working_art_is_placeholder,
    status: row.status,
    updatedAt: row.updated_at,
    setId: row.set_id ?? null,
    publishedVersionId: row.published_version_id ?? null,
    approvedVersionId: row.approved_version_id ?? null,
  };
}

const CARD_COLS = "id, title, working_snapshot, working_art_key, working_art_is_placeholder, working_finished_key, status, updated_at, set_id, published_version_id, approved_version_id";

export async function saveCard(
  cardId: string,
  snapshot: DesignCard
): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_save_card", {
    p_card_id: cardId,
    p_snapshot: snapshot,
  });
  if (error) return { ok: false, error: "Could not save card" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true, updatedAt: typeof data === "string" ? data : undefined };
}

export async function getCard(cardId: string): Promise<ForgeCardFull | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .eq("id", cardId)
    .maybeSingle();
  return data ? toFull(data) : null;
}

// Caller's OWN cards only (single-author Phase 1a). Full snapshot is the caller's
// own data — used to render grid thumbnails.
export async function listForgeCards(): Promise<ForgeCardFull[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .eq("owner_id", ctx.user.id)
    .is("set_id", null)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(toFull);
}

