"use server";

import { createClient } from "../../utils/supabase/server";

export interface PublicSpoiler {
  id: string;
  card_name: string;
  set_name: string;
  set_number: string | null;
  image_url: string;
  image_width: number | null;
  image_height: number | null;
  spoil_date: string;
}

export async function loadPublicSpoilersAction() {
  const supabase = await createClient();

  // RLS handles visibility filtering (visible = true AND spoil_date <= today)
  const { data, error } = await supabase
    .from("spoilers")
    .select(
      "id, card_name, set_name, set_number, image_url, image_width, image_height, spoil_date"
    )
    .order("spoil_date", { ascending: false })
    .order("set_name")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load public spoilers error:", error);
    return { spoilers: [] as PublicSpoiler[] };
  }

  return { spoilers: (data || []) as PublicSpoiler[] };
}

export async function loadSpoilerByIdAction(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("spoilers")
    .select(
      "id, card_name, set_name, set_number, image_url, image_width, image_height, spoil_date"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return { spoiler: null, related: [] as PublicSpoiler[] };
  }

  // Fetch other visible cards from the same set
  const { data: related } = await supabase
    .from("spoilers")
    .select(
      "id, card_name, set_name, set_number, image_url, image_width, image_height, spoil_date"
    )
    .eq("set_name", data.set_name)
    .neq("id", id)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  return {
    spoiler: data as PublicSpoiler,
    related: (related || []) as PublicSpoiler[],
  };
}
