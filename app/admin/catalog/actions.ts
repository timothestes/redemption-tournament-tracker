"use server";

import { revalidatePath } from "next/cache";
import { requireCatalogEditor } from "@/app/admin/permissions/lib/auth";
import { findCardStrict } from "./lib/editorShared";
import { validateOverrideFields } from "./lib/validateOverride";
import { validateAlias } from "./lib/validateAlias";

export type OverrideRow = {
  card_name: string;
  set_code: string;
  fields: Record<string, string>;
  note: string;
  updated_at: string;
};
export type ImageVersionRow = {
  img_file: string;
  version: number;
  note: string | null;
  updated_at: string;
};

export type AliasRow = {
  id: string;
  alias: string;
  card_name: string;
  set_code: string;
};

export async function listCatalogState(): Promise<{
  overrides: OverrideRow[];
  imageVersions: ImageVersionRow[];
  aliases: AliasRow[];
}> {
  const ctx = await requireCatalogEditor();
  if (!ctx) return { overrides: [], imageVersions: [], aliases: [] };
  const [{ data: overrides }, { data: imageVersions }, { data: aliases }] = await Promise.all([
    ctx.supabase
      .from("card_overrides")
      .select("card_name, set_code, fields, note, updated_at")
      .order("card_name", { ascending: true }),
    ctx.supabase
      .from("card_image_versions")
      .select("img_file, version, note, updated_at")
      .order("img_file", { ascending: true }),
    // Every alias, not just the selected card's: they are globally unique, and
    // the editor has to be able to say which card already claimed one.
    ctx.supabase
      .from("card_aliases")
      .select("id, alias, card_name, set_code")
      .order("alias", { ascending: true }),
  ]);
  return {
    overrides: (overrides as OverrideRow[] | null) ?? [],
    imageVersions: (imageVersions as ImageVersionRow[] | null) ?? [],
    aliases: (aliases as AliasRow[] | null) ?? [],
  };
}

export async function saveOverride(
  name: string,
  set: string,
  rawFields: Record<string, unknown>,
  note: string,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const ctx = await requireCatalogEditor();
  if (!ctx) return { ok: false, error: "Not authorized" };

  // Strict identity (spec F3): a typo'd set must never resolve to another print.
  if (!findCardStrict(name, set)) {
    return { ok: false, error: `No catalog card matches exactly "${name}" | "${set}"` };
  }

  const validated = validateOverrideFields(rawFields);
  if (validated.ok === false) return { ok: false, error: validated.error };

  // Empty override = no override: delete the row (the pending dashboard still
  // surfaces the deletion via the bundled-overlay diff — spec F4).
  if (Object.keys(validated.fields).length === 0) {
    const { error } = await ctx.supabase
      .from("card_overrides")
      .delete()
      .eq("card_name", name)
      .eq("set_code", set);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/catalog");
    return { ok: true, deleted: true };
  }

  const trimmedNote = note.trim();
  if (!trimmedNote) return { ok: false, error: "A note is required — future-you wants the why" };

  const { error } = await ctx.supabase.from("card_overrides").upsert(
    {
      card_name: name,
      set_code: set,
      fields: validated.fields,
      note: trimmedNote,
      updated_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "card_name,set_code" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/catalog");
  return { ok: true, deleted: false };
}

export async function deleteOverride(
  name: string,
  set: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireCatalogEditor();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase
    .from("card_overrides")
    .delete()
    .eq("card_name", name)
    .eq("set_code", set);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/catalog");
  return { ok: true };
}

/**
 * Claim an alias for one printing. Aliases are global, so this re-reads the
 * table rather than trusting the client's list — two curators in two tabs
 * would otherwise race, and the DB's unique index would surface as a raw
 * Postgres error instead of a sentence.
 */
export async function saveCardAlias(
  name: string,
  set: string,
  rawAlias: string,
): Promise<{ ok: true; alias: AliasRow } | { ok: false; error: string }> {
  const ctx = await requireCatalogEditor();
  if (!ctx) return { ok: false, error: "Not authorized" };

  // Strict identity, same rule saveOverride uses: a typo'd set must never
  // resolve to another print.
  if (!findCardStrict(name, set)) {
    return { ok: false, error: `No catalog card matches exactly "${name}" | "${set}"` };
  }

  const { data: rows, error: readError } = await ctx.supabase.from("card_aliases").select("alias");
  if (readError) return { ok: false, error: readError.message };

  const validated = validateAlias(rawAlias, (rows ?? []).map((r) => r.alias as string));
  if (validated.ok === false) return { ok: false, error: validated.error };

  const { data, error } = await ctx.supabase
    .from("card_aliases")
    .insert({
      alias: validated.alias,
      card_name: name,
      set_code: set,
      updated_by: ctx.user.id,
    })
    .select("id, alias, card_name, set_code")
    .single();
  if (error) {
    // 23505 = the unique index caught a race the read above could not see.
    if (error.code === "23505") return { ok: false, error: `"${validated.alias}" is already in use` };
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/catalog");
  return { ok: true, alias: data as AliasRow };
}

export async function deleteCardAlias(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireCatalogEditor();
  if (!ctx) return { ok: false, error: "Not authorized" };
  // `.select()` so a delete that matched nothing — someone else removed it, or
  // RLS hides it — is reported instead of being drawn as success.
  const { data, error } = await ctx.supabase.from("card_aliases").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) return { ok: false, error: "That alias is already gone — reload the page" };
  revalidatePath("/admin/catalog");
  return { ok: true };
}
