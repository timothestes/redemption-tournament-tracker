"use server";

import { createClient } from "../../utils/supabase/server";

export interface CollectionCardRow {
  card_name: string;
  card_set: string;
  card_img_file: string;
  quantity: number;
}

const PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 500;
const CONFLICT_KEY = "user_id,card_name,card_set,card_img_file";

async function getAuthedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase: null, user: null };
  }
  return { supabase, user };
}

/** Load every row for the user's collection, batched past the 1000-row limit. */
async function loadAllRows(supabase: any, userId: string): Promise<CollectionCardRow[]> {
  let rows: CollectionCardRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch, error } = await supabase
      .from("collection_cards")
      .select("card_name, card_set, card_img_file, quantity")
      .eq("user_id", userId)
      .order("card_name")
      .order("card_set")
      .order("card_img_file")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    rows = rows.concat(batch || []);
    hasMore = (batch?.length || 0) === PAGE_SIZE;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function loadCollectionAction() {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to view your collection", cards: [] as CollectionCardRow[] };
    }
    const cards = await loadAllRows(supabase, user.id);
    return { success: true, cards };
  } catch (error) {
    console.error("Error in loadCollectionAction:", error);
    return { success: false, error: "Failed to load collection", cards: [] as CollectionCardRow[] };
  }
}

export async function setCollectionCardQuantityAction(
  cardName: string,
  cardSet: string,
  cardImgFile: string,
  quantity: number
) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to manage your collection" };
    }

    if (quantity <= 0) {
      const { error } = await supabase
        .from("collection_cards")
        .delete()
        .eq("user_id", user.id)
        .eq("card_name", cardName)
        .eq("card_set", cardSet)
        .eq("card_img_file", cardImgFile);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("collection_cards").upsert(
        {
          user_id: user.id,
          card_name: cardName,
          card_set: cardSet,
          card_img_file: cardImgFile,
          quantity,
          updated_at: new Date().toISOString(),
        },
        { onConflict: CONFLICT_KEY }
      );
      if (error) throw error;
    }

    return { success: true };
  } catch (error) {
    console.error("Error in setCollectionCardQuantityAction:", error);
    return { success: false, error: "Failed to update collection" };
  }
}

/**
 * Bulk import rows from CSV.
 *  - merge:   add imported quantities to existing ones
 *  - replace: wipe the collection, then insert imported rows
 * Rows with the same identity are pre-summed; quantities are clamped to >= 1.
 */
export async function bulkImportCollectionAction(
  rows: CollectionCardRow[],
  mode: "merge" | "replace"
) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to import a collection" };
    }

    // Collapse duplicate identities within the import itself
    const incoming = new Map<string, CollectionCardRow>();
    for (const row of rows) {
      if (!row.card_name || row.quantity <= 0) continue;
      const key = `${row.card_name}|${row.card_set}|${row.card_img_file}`;
      const existing = incoming.get(key);
      if (existing) {
        existing.quantity += row.quantity;
      } else {
        incoming.set(key, { ...row });
      }
    }

    if (mode === "replace") {
      const { error } = await supabase
        .from("collection_cards")
        .delete()
        .eq("user_id", user.id);
      if (error) throw error;
    } else {
      // Merge: add to existing quantities
      const current = await loadAllRows(supabase, user.id);
      for (const row of current) {
        const key = `${row.card_name}|${row.card_set}|${row.card_img_file}`;
        const imported = incoming.get(key);
        if (imported) imported.quantity += row.quantity;
      }
    }

    const now = new Date().toISOString();
    const toUpsert = Array.from(incoming.values()).map((row) => ({
      user_id: user.id,
      card_name: row.card_name,
      card_set: row.card_set,
      card_img_file: row.card_img_file,
      quantity: row.quantity,
      updated_at: now,
    }));

    for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = toUpsert.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error } = await supabase
        .from("collection_cards")
        .upsert(chunk, { onConflict: CONFLICT_KEY });
      if (error) throw error;
    }

    return { success: true, imported: toUpsert.length };
  } catch (error) {
    console.error("Error in bulkImportCollectionAction:", error);
    return { success: false, error: "Failed to import collection" };
  }
}

export async function clearCollectionAction() {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to manage your collection" };
    }
    const { error } = await supabase
      .from("collection_cards")
      .delete()
      .eq("user_id", user.id);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error("Error in clearCollectionAction:", error);
    return { success: false, error: "Failed to clear collection" };
  }
}

/**
 * Owned quantities aggregated by `name|set` (summed across printings/imgFiles).
 * Used by the YTG cart to subtract cards the user already owns. Returns an
 * empty map when signed out so callers can degrade gracefully.
 */
export async function getOwnedQuantitiesAction(): Promise<{
  success: boolean;
  owned: Record<string, number>;
}> {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, owned: {} };
    }
    const rows = await loadAllRows(supabase, user.id);
    const owned: Record<string, number> = {};
    for (const row of rows) {
      const key = `${row.card_name}|${row.card_set}`;
      owned[key] = (owned[key] || 0) + row.quantity;
    }
    return { success: true, owned };
  } catch (error) {
    console.error("Error in getOwnedQuantitiesAction:", error);
    return { success: false, owned: {} };
  }
}
