"use server";

import { revalidatePath } from "next/cache";
import { requireForge } from "@/app/forge/lib/auth";
import { deckCardCount } from "@/app/forge/lib/deckSerialize";
import type { ForgeDeckSummary, ForgeDeckDetail, ForgeDeckView, SharedForgeDeckSummary, SaveForgeDeckInput, ForgeDeckEntry } from "@/app/forge/lib/deckTypes";

export async function listForgeDecks(): Promise<ForgeDeckSummary[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, cards, updated_at, is_shared")
    .eq("owner_id", ctx.user.id)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((d: any): ForgeDeckSummary => ({
    id: d.id, name: d.name, format: d.format,
    cardCount: deckCardCount((d.cards ?? []) as ForgeDeckEntry[]),
    updatedAt: d.updated_at,
    isShared: d.is_shared === true,
  }));
}

export async function getForgeDeck(id: string): Promise<ForgeDeckDetail | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, paragon, cards, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id, name: data.name, format: data.format,
    paragon: data.paragon ?? null, entries: (data.cards ?? []) as ForgeDeckEntry[],
    ownerId: data.owner_id,
  };
}

// Other members' shared decks, newest first, with owner display names
// (playtest_members is readable by any Forge member).
export async function listSharedForgeDecks(): Promise<SharedForgeDeckSummary[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, cards, owner_id, updated_at")
    .eq("is_shared", true)
    .neq("owner_id", ctx.user.id)
    .order("updated_at", { ascending: false });
  if (!data || data.length === 0) return [];
  const ownerIds = [...new Set(data.map((d: any) => d.owner_id))];
  const { data: members } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, display_name")
    .in("user_id", ownerIds);
  const names = new Map((members ?? []).map((m: any) => [m.user_id, m.display_name]));
  return data.map((d: any): SharedForgeDeckSummary => ({
    id: d.id, name: d.name, format: d.format,
    cardCount: deckCardCount((d.cards ?? []) as ForgeDeckEntry[]),
    updatedAt: d.updated_at,
    ownerName: names.get(d.owner_id) ?? "Forge member",
  }));
}

// One deck for the read-only view page. RLS admits owners and shared decks;
// anything else (or a non-member) comes back null and the caller 404s.
export async function getForgeDeckView(id: string): Promise<ForgeDeckView | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_decks")
    .select("id, name, format, paragon, cards, owner_id, is_shared, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const { data: member } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", data.owner_id)
    .maybeSingle();
  return {
    id: data.id, name: data.name, format: data.format,
    paragon: data.paragon ?? null, entries: (data.cards ?? []) as ForgeDeckEntry[],
    ownerName: member?.display_name ?? "Forge member",
    isOwner: data.owner_id === ctx.user.id,
    isShared: data.is_shared === true,
    updatedAt: data.updated_at,
  };
}

// Copy any deck the caller can read (their own or a shared one) into their
// collection. Entries are copied verbatim — forge card refs the copier can't
// resolve render as placeholders, same as loading. Copies start private.
export async function copyForgeDeck(id: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data: src } = await ctx.supabase
    .from("forge_decks")
    .select("name, format, paragon, cards")
    .eq("id", id)
    .maybeSingle();
  if (!src) return { ok: false, error: "Deck not found" };
  const { data, error } = await ctx.supabase
    .from("forge_decks")
    .insert({
      owner_id: ctx.user.id,
      name: `${src.name} (Copy)`,
      format: src.format,
      paragon: src.paragon ?? null,
      cards: src.cards ?? [],
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return { ok: false, error: "Could not copy deck" };
  revalidatePath("/forge/play/decks");
  return { ok: true, id: data.id };
}

export async function setForgeDeckShared(id: string, shared: boolean): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase
    .from("forge_decks")
    .update({ is_shared: shared })
    .eq("id", id)
    .eq("owner_id", ctx.user.id);
  if (error) return { ok: false, error: "Could not update sharing" };
  revalidatePath("/forge/play/decks");
  return { ok: true };
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
    const { error } = await ctx.supabase.from("forge_decks").update(row).eq("id", input.id).eq("owner_id", ctx.user.id);
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
  const { error } = await ctx.supabase.from("forge_decks").delete().eq("id", id).eq("owner_id", ctx.user.id);
  if (error) return { ok: false, error: "Could not delete deck" };
  revalidatePath("/forge/play/decks");
  return { ok: true };
}
