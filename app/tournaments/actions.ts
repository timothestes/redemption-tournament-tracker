"use server";

import { createClient } from "@/utils/supabase/server";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { normalizeTournamentFormat, type FormatId } from "@/lib/formats";

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

  // Keep a listing visible for a few days after its start date. Categories often
  // get played a day or two late (low turnout / time), and the host still needs
  // the "Host This Event" link during that window.
  const grace = new Date();
  grace.setDate(grace.getDate() - 3);
  const graceDate = grace.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("tournament_listings")
    .select(
      "id, title, tournament_type, start_date, end_date, start_time, city, state, venue_name, venue_address, host_name, formats, door_fee, description, linked_tournament_id"
    )
    .eq("status", "upcoming")
    .gte("start_date", graceDate)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("Failed to load tournament listings:", error.message);
    return [];
  }

  return (data as TournamentListing[]) || [];
}

// ─── Public results (published only) ─────────────────────────────────
//
// Admin client, no auth — but every loader below checks results_published
// === true FIRST and returns { success: false } otherwise. deck_snapshot is
// never read/returned here; decklist links come from
// tournament_decklists.published_deck_id, and only when decklists_published
// === true.

export interface PublicResultsIndexEvent {
  id: string;
  name: string;
  category: string | null;
  deckFormat: string | null;
  endedAt: string | null;
  playerCount: number;
}

export async function loadPublicResultsIndexAction(
  limit = 50
): Promise<{ success: boolean; events: PublicResultsIndexEvent[] }> {
  const admin = getSupabaseAdmin();

  const { data: tournaments, error } = await admin
    .from("tournaments")
    .select("id, name, category, deck_format, ended_at")
    .eq("results_published", true);

  if (error || !tournaments) {
    return { success: false, events: [] };
  }

  const limited = [...tournaments]
    .sort((a: any, b: any) => {
      const aTime = a.ended_at ? new Date(a.ended_at).getTime() : 0;
      const bTime = b.ended_at ? new Date(b.ended_at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);

  // One in-grouped query for all participant counts, rather than one count
  // query per event.
  const ids = limited.map((t: any) => t.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: participantRows } = await admin
      .from("participants")
      .select("tournament_id")
      .in("tournament_id", ids);
    for (const p of participantRows ?? []) {
      counts.set(p.tournament_id, (counts.get(p.tournament_id) ?? 0) + 1);
    }
  }

  const events: PublicResultsIndexEvent[] = limited.map((t: any) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    deckFormat: t.deck_format,
    endedAt: t.ended_at,
    playerCount: counts.get(t.id) ?? 0,
  }));

  return { success: true, events };
}

export interface PublicResultsStandingRow {
  place: number | null;
  name: string | null;
  matchPoints: number | null;
  differential: number | null;
  publishedDeckId: string | null;
}

export async function loadPublicResultsAction(tournamentId: string): Promise<
  | { success: false }
  | {
      success: true;
      name: string;
      category: string | null;
      deckFormat: FormatId | "Other" | null;
      endedAt: string | null;
      decklistsPublished: boolean;
      standings: PublicResultsStandingRow[];
    }
> {
  const admin = getSupabaseAdmin();

  const { data: tournament, error } = await admin
    .from("tournaments")
    .select("id, name, category, deck_format, ended_at, results_published, decklists_published")
    .eq("id", tournamentId)
    .maybeSingle();

  // Gate FIRST: unpublished tournaments never reach the participants/decklist
  // queries below, let alone anything that could expose deck_snapshot.
  if (error || !tournament || tournament.results_published !== true) {
    return { success: false };
  }

  const { data: participants } = await admin
    .from("participants")
    .select("id, place, name, match_points, differential")
    .eq("tournament_id", tournamentId);

  const decklistMap = new Map<string, string>(); // participant_id -> published_deck_id
  if (tournament.decklists_published === true) {
    const { data: decklists } = await admin
      .from("tournament_decklists")
      .select("participant_id, published_deck_id")
      .eq("tournament_id", tournamentId);
    for (const d of decklists ?? []) {
      if (d.published_deck_id) decklistMap.set(d.participant_id, d.published_deck_id);
    }
  }

  const standings: PublicResultsStandingRow[] = (participants ?? [])
    .slice()
    .sort((a: any, b: any) => {
      if (a.place !== null && b.place !== null) return a.place - b.place;
      if (a.place !== null) return -1;
      if (b.place !== null) return 1;
      return (b.match_points ?? 0) - (a.match_points ?? 0);
    })
    .map((p: any) => ({
      place: p.place,
      name: p.name,
      matchPoints: p.match_points,
      differential: p.differential,
      publishedDeckId: decklistMap.get(p.id) ?? null,
    }));

  return {
    success: true,
    name: tournament.name,
    category: tournament.category,
    deckFormat: normalizeTournamentFormat(tournament.deck_format),
    endedAt: tournament.ended_at,
    decklistsPublished: tournament.decklists_published === true,
    standings,
  };
}
