"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { findCardStrict } from "./lib/editorShared";
import { validateOverrideFields } from "./lib/validateOverride";

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

export async function listCatalogState(): Promise<{
  overrides: OverrideRow[];
  imageVersions: ImageVersionRow[];
}> {
  const ctx = await requireSuperuser();
  if (!ctx) return { overrides: [], imageVersions: [] };
  const [{ data: overrides }, { data: imageVersions }] = await Promise.all([
    ctx.supabase
      .from("card_overrides")
      .select("card_name, set_code, fields, note, updated_at")
      .order("card_name", { ascending: true }),
    ctx.supabase
      .from("card_image_versions")
      .select("img_file, version, note, updated_at")
      .order("img_file", { ascending: true }),
  ]);
  return {
    overrides: (overrides as OverrideRow[] | null) ?? [],
    imageVersions: (imageVersions as ImageVersionRow[] | null) ?? [],
  };
}

export async function saveOverride(
  name: string,
  set: string,
  rawFields: Record<string, unknown>,
  note: string,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const ctx = await requireSuperuser();
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
  const ctx = await requireSuperuser();
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
