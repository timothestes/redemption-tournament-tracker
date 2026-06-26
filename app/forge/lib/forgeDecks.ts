"use server";

import { revalidatePath } from "next/cache";
import { requireForge } from "@/app/forge/lib/auth";
import { deckCardCount } from "@/app/forge/lib/deckSerialize";
import type { ForgeDeckSummary, ForgeDeckDetail, SaveForgeDeckInput, ForgeDeckEntry } from "@/app/forge/lib/deckTypes";

export async function listForgeDecks(): Promise<ForgeDeckSummary[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, cards, updated_at")
    .eq("owner_id", ctx.user.id)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((d: any): ForgeDeckSummary => ({
    id: d.id, name: d.name, format: d.format,
    cardCount: deckCardCount((d.cards ?? []) as ForgeDeckEntry[]),
    updatedAt: d.updated_at,
  }));
}

export async function getForgeDeck(id: string): Promise<ForgeDeckDetail | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, paragon, cards")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id, name: data.name, format: data.format,
    paragon: data.paragon ?? null, entries: (data.cards ?? []) as ForgeDeckEntry[],
  };
}

export async function saveForgeDeck(
  input: SaveForgeDeckInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const isParagon = input.format.toLowerCase().includes("paragon");
  const row = {
    owner_id: ctx.user.id,
    name: input.name.trim() || "Untitled deck",
    format: input.format,
    paragon: isParagon ? (input.paragon ?? null) : null,
    cards: input.entries,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await ctx.supabase.from("forge_decks").update(row).eq("id", input.id);
    if (error) return { ok: false, error: "Could not save deck" };
    revalidatePath("/forge/play/decks");
    return { ok: true, id: input.id };
  }
  const { data, error } = await ctx.supabase.from("forge_decks").insert(row).select("id").maybeSingle();
  if (error || !data?.id) return { ok: false, error: "Could not save deck" };
  revalidatePath("/forge/play/decks");
  return { ok: true, id: data.id };
}

export async function deleteForgeDeck(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.from("forge_decks").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not delete deck" };
  revalidatePath("/forge/play/decks");
  return { ok: true };
}
