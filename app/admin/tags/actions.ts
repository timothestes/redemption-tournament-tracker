"use server";

import { createClient } from "../../../utils/supabase/server";
import { revalidatePath } from "next/cache";
import { requireRegistrationAdmin } from "../../../utils/adminUtils";

export async function createGlobalTagAction(name: string, color: string) {
  try {
    await requireRegistrationAdmin();
    const supabase = await createClient();

    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: "Tag name cannot be empty" };
    if (trimmed.length > 50) return { success: false, error: "Tag name must be 50 characters or less" };

    const { data, error } = await supabase
      .from("global_tags")
      .insert({ name: trimmed, color })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return { success: false, error: "A tag with that name already exists" };
      return { success: false, error: "Failed to create tag" };
    }

    revalidatePath("/admin/tags");
    return { success: true, tag: data };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized")) return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function updateGlobalTagAction(id: string, name: string, color: string) {
  try {
    await requireRegistrationAdmin();
    const supabase = await createClient();

    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: "Tag name cannot be empty" };
    if (trimmed.length > 50) return { success: false, error: "Tag name must be 50 characters or less" };

    const { error } = await supabase
      .from("global_tags")
      .update({ name: trimmed, color })
      .eq("id", id);

    if (error) {
      if (error.code === "23505") return { success: false, error: "A tag with that name already exists" };
      return { success: false, error: "Failed to update tag" };
    }

    revalidatePath("/admin/tags");
    return { success: true };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized")) return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function deleteGlobalTagAction(id: string) {
  try {
    await requireRegistrationAdmin();
    const supabase = await createClient();

    const { error } = await supabase
      .from("global_tags")
      .delete()
      .eq("id", id);

    if (error) return { success: false, error: "Failed to delete tag" };

    revalidatePath("/admin/tags");
    return { success: true };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized")) return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function loadGlobalTagsAdminAction() {
  try {
    await requireRegistrationAdmin();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("global_tags")
      .select("id, name, color, created_at")
      .order("name");

    if (error) return { success: false, tags: [], error: "Failed to load tags" };
    return { success: true, tags: data || [] };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized")) return { success: false, tags: [], error: "Unauthorized" };
    return { success: false, tags: [], error: "An unexpected error occurred" };
  }
}
