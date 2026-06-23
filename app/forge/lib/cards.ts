"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt } from "@/app/forge/lib/art";

export type ForgeCardRow = {
  id: string;
  title: string | null;
  working_art_key: string | null;
  working_art_is_placeholder: boolean;
  updated_at: string;
};

export async function createCard(
  title: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_create_card", { p_title: title });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create card" };
  revalidatePath("/forge/art");
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

  const key = await uploadForgeArt(file);
  // No image processing in 1a.3: the uploaded file IS the original.
  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: key,
    p_original_key: key,
  });
  if (error) return { ok: false, error: "Could not save art" };
  revalidatePath("/forge/art");
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
  revalidatePath("/forge/art");
  return { ok: true };
}

export async function listMyForgeCards(): Promise<ForgeCardRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, working_art_key, working_art_is_placeholder, updated_at")
    .eq("owner_id", ctx.user.id)
    .order("updated_at", { ascending: false });
  return (data ?? []) as ForgeCardRow[];
}
