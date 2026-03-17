"use server";

import { createClient } from "@/utils/supabase/server";

export interface TournamentListing {
  id: string;
  title: string;
  tournament_type: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  city: string;
  state: string;
  venue_name: string | null;
  venue_address: string | null;
  host_name: string | null;
  formats: { format: string; entry_fee: string | null }[];
  door_fee: string | null;
  description: string | null;
  linked_tournament_id: string | null;
}

export async function loadUpcomingListings(): Promise<TournamentListing[]> {
  const supabase = await createClient();

  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("tournament_listings")
    .select(
      "id, title, tournament_type, start_date, end_date, start_time, city, state, venue_name, venue_address, host_name, formats, door_fee, description, linked_tournament_id"
    )
    .eq("status", "upcoming")
    .gte("start_date", today)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("Failed to load tournament listings:", error.message);
    return [];
  }

  return (data as TournamentListing[]) || [];
}
