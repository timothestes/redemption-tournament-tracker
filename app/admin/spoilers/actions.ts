"use server";

import { createClient } from "../../../utils/supabase/server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "../../../utils/adminUtils";

export interface Spoiler {
  id: string;
  card_name: string;
  set_name: string;
  set_number: string | null;
  image_url: string;
  image_width: number | null;
  image_height: number | null;
  spoil_date: string;
  visible: boolean;
  sort_order: number | null;
  created_at: string;
  created_by: string | null;
}

export async function createSpoilerAction(data: {
  card_name: string;
  set_name: string;
  set_number?: string;
  image_url: string;
  image_width?: number;
  image_height?: number;
  spoil_date?: string;
}) {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    const trimmedName = data.card_name.trim();
    const trimmedSet = data.set_name.trim();
    if (!trimmedName) return { success: false, error: "Card name is required" };
    if (!trimmedSet) return { success: false, error: "Set name is required" };
    if (!data.image_url) return { success: false, error: "Image is required" };

    const { data: spoiler, error } = await supabase
      .from("spoilers")
      .insert({
        card_name: trimmedName,
        set_name: trimmedSet,
        set_number: data.set_number?.trim() || null,
        image_url: data.image_url,
        image_width: data.image_width || null,
        image_height: data.image_height || null,
        spoil_date: data.spoil_date || new Date().toISOString().split("T")[0],
        visible: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Create spoiler error:", error);
      return { success: false, error: "Failed to create spoiler" };
    }

    revalidatePath("/admin/spoilers");
    revalidatePath("/spoilers");
    if (spoiler?.id) revalidatePath(`/spoilers/${spoiler.id}`);
    return { success: true, spoiler };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized"))
      return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function loadSpoilersAdminAction(setFilter?: string) {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    let query = supabase
      .from("spoilers")
      .select("*")
      .order("spoil_date", { ascending: false })
      .order("set_name")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (setFilter) {
      query = query.eq("set_name", setFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Load spoilers error:", error);
      return { success: false, spoilers: [] as Spoiler[], error: "Failed to load spoilers" };
    }

    return { success: true, spoilers: (data || []) as Spoiler[] };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized"))
      return { success: false, spoilers: [] as Spoiler[], error: "Unauthorized" };
    return { success: false, spoilers: [] as Spoiler[], error: "An unexpected error occurred" };
  }
}

export async function loadSpoilerSetsAdminAction() {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("spoilers")
      .select("set_name")
      .order("set_name");

    if (error) {
      return { success: false, sets: [] as string[] };
    }

    const uniqueSets = [...new Set((data || []).map((d: any) => d.set_name))];
    return { success: true, sets: uniqueSets };
  } catch {
    return { success: false, sets: [] as string[] };
  }
}

export async function updateSpoilerAction(
  id: string,
  data: {
    card_name?: string;
    set_name?: string;
    set_number?: string | null;
    spoil_date?: string;
    visible?: boolean;
    sort_order?: number | null;
  }
) {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    const updates: any = {};
    if (data.card_name !== undefined) {
      const trimmed = data.card_name.trim();
      if (!trimmed) return { success: false, error: "Card name cannot be empty" };
      updates.card_name = trimmed;
    }
    if (data.set_name !== undefined) {
      const trimmed = data.set_name.trim();
      if (!trimmed) return { success: false, error: "Set name cannot be empty" };
      updates.set_name = trimmed;
    }
    if (data.set_number !== undefined) updates.set_number = data.set_number;
    if (data.spoil_date !== undefined) updates.spoil_date = data.spoil_date;
    if (data.visible !== undefined) updates.visible = data.visible;
    if (data.sort_order !== undefined) updates.sort_order = data.sort_order;

    const { error } = await supabase
      .from("spoilers")
      .update(updates)
      .eq("id", id);

    if (error) {
      console.error("Update spoiler error:", error);
      return { success: false, error: "Failed to update spoiler" };
    }

    revalidatePath("/admin/spoilers");
    revalidatePath("/spoilers");
    revalidatePath(`/spoilers/${id}`);
    return { success: true };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized"))
      return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function toggleSetVisibilityAction(setName: string, visible: boolean) {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    const { error } = await supabase
      .from("spoilers")
      .update({ visible })
      .eq("set_name", setName);

    if (error) {
      console.error("Toggle set visibility error:", error);
      return { success: false, error: "Failed to update visibility" };
    }

    revalidatePath("/admin/spoilers");
    revalidatePath("/spoilers");
    return { success: true };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized"))
      return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function deleteSpoilerAction(id: string) {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    const { error } = await supabase.from("spoilers").delete().eq("id", id);

    if (error) {
      console.error("Delete spoiler error:", error);
      return { success: false, error: "Failed to delete spoiler" };
    }

    revalidatePath("/admin/spoilers");
    revalidatePath("/spoilers");
    revalidatePath(`/spoilers/${id}`);
    return { success: true };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized"))
      return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function updateVisibilityBulkAction(ids: string[], visible: boolean) {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    const { error } = await supabase
      .from("spoilers")
      .update({ visible })
      .in("id", ids);

    if (error) {
      console.error("Bulk visibility update error:", error);
      return { success: false, error: "Failed to update visibility" };
    }

    revalidatePath("/admin/spoilers");
    revalidatePath("/spoilers");
    return { success: true };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized"))
      return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function deleteSpoilersBulkAction(ids: string[]) {
  try {
    await requirePermission("manage_spoilers");
    const supabase = await createClient();

    const { error } = await supabase.from("spoilers").delete().in("id", ids);

    if (error) {
      console.error("Bulk delete spoilers error:", error);
      return { success: false, error: "Failed to delete spoilers" };
    }

    revalidatePath("/admin/spoilers");
    revalidatePath("/spoilers");
    return { success: true };
  } catch (e: any) {
    if (e?.message?.includes("Unauthorized"))
      return { success: false, error: "Unauthorized" };
    return { success: false, error: "An unexpected error occurred" };
  }
}
