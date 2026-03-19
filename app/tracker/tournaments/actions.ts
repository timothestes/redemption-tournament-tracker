"use server";

import { createClient } from "../../../utils/supabase/server";
import { getSupabaseAdmin } from "../../../lib/pricing/supabase-admin";

// System user that owns published tournament deck copies
const REDEMPTIONCCG_USER_ID = "a0a8e980-f372-4ebd-be25-d2f26507e98f";

// ─── Types ──────────────────────────────────────────────────────────

export interface TournamentDecklistRow {
  id: string;
  tournament_id: string;
  participant_id: string;
  deck_id: string;
  deck_name: string;
  deck_format: string | null;
  deck_card_count: number;
  preview_card_1: string | null;
  preview_card_2: string | null;
}

export interface DeckSearchResult {
  id: string;
  name: string;
  format: string | null;
  card_count: number;
  preview_card_1: string | null;
  preview_card_2: string | null;
  is_public: boolean;
  username?: string | null;
}

// ─── Load tournament decklists ──────────────────────────────────────

export async function loadTournamentDecklistsAction(tournamentId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tournament_decklists")
    .select(`
      id,
      tournament_id,
      participant_id,
      deck_id,
      decks!tournament_decklists_deck_id_fkey (
        name,
        format,
        card_count,
        preview_card_1,
        preview_card_2
      )
    `)
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error("Error loading tournament decklists:", error);
    return { success: false, error: error.message, decklists: [] };
  }

  const decklists: TournamentDecklistRow[] = (data || []).map((row: any) => ({
    id: row.id,
    tournament_id: row.tournament_id,
    participant_id: row.participant_id,
    deck_id: row.deck_id,
    deck_name: row.decks?.name || "Unknown",
    deck_format: row.decks?.format || null,
    deck_card_count: row.decks?.card_count || 0,
    preview_card_1: row.decks?.preview_card_1 || null,
    preview_card_2: row.decks?.preview_card_2 || null,
  }));

  return { success: true, decklists };
}

// ─── Search decks (admin's own + public) ────────────────────────────

export async function searchDecksForTournamentAction(query: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Not authenticated", decks: [] };
  }

  const term = query.trim();
  if (!term) {
    return { success: true, decks: [] };
  }

  // Search admin's own decks
  const { data: ownDecks } = await supabase
    .from("decks")
    .select("id, name, format, card_count, preview_card_1, preview_card_2, is_public, user_id")
    .eq("user_id", user.id)
    .ilike("name", `%${term}%`)
    .order("updated_at", { ascending: false })
    .limit(10);

  // Search public decks (excluding own)
  const { data: publicDecks } = await supabase
    .from("decks")
    .select("id, name, format, card_count, preview_card_1, preview_card_2, is_public, user_id")
    .eq("is_public", true)
    .neq("user_id", user.id)
    .ilike("name", `%${term}%`)
    .order("view_count", { ascending: false })
    .limit(10);

  // Get usernames for public decks
  const publicUserIds = [...new Set((publicDecks || []).map((d: any) => d.user_id).filter(Boolean))];
  let usernameMap = new Map<string, string>();
  if (publicUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", publicUserIds);
    for (const p of profiles || []) {
      if (p.username) usernameMap.set(p.id, p.username);
    }
  }

  const results: DeckSearchResult[] = [
    ...(ownDecks || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      format: d.format,
      card_count: d.card_count || 0,
      preview_card_1: d.preview_card_1,
      preview_card_2: d.preview_card_2,
      is_public: d.is_public,
      username: "You" as string | null,
    })),
    ...(publicDecks || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      format: d.format,
      card_count: d.card_count || 0,
      preview_card_1: d.preview_card_1,
      preview_card_2: d.preview_card_2,
      is_public: d.is_public,
      username: usernameMap.get(d.user_id) || null,
    })),
  ];

  return { success: true, decks: results };
}

// ─── Attach deck to participant ─────────────────────────────────────

export async function attachDeckToParticipantAction(
  tournamentId: string,
  participantId: string,
  deckId: string
) {
  const supabase = await createClient();

  // Upsert: if participant already has a deck, replace it
  const { data: existing } = await supabase
    .from("tournament_decklists")
    .select("id")
    .eq("participant_id", participantId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("tournament_decklists")
      .update({ deck_id: deckId })
      .eq("id", existing.id);

    if (error) {
      console.error("Error updating tournament decklist:", error);
      return { success: false, error: error.message };
    }
  } else {
    const { error } = await supabase
      .from("tournament_decklists")
      .insert({
        tournament_id: tournamentId,
        participant_id: participantId,
        deck_id: deckId,
      });

    if (error) {
      console.error("Error attaching deck:", error);
      return { success: false, error: error.message };
    }
  }

  return { success: true };
}

// ─── Detach deck from participant ───────────────────────────────────

export async function detachDeckFromParticipantAction(participantId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("tournament_decklists")
    .delete()
    .eq("participant_id", participantId);

  if (error) {
    console.error("Error detaching deck:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ─── Publish all decklists ──────────────────────────────────────────

export async function publishTournamentDecklistsAction(
  tournamentId: string,
  deckFormat: string
) {
  const supabase = await createClient();
  const admin = getSupabaseAdmin();

  // Get tournament name for the deck copies
  const { data: tournament, error: tournError } = await supabase
    .from("tournaments")
    .select("name")
    .eq("id", tournamentId)
    .single();

  if (tournError || !tournament) {
    return { success: false, error: "Tournament not found" };
  }

  // Get all decklists with participant names
  const { data: decklists, error: fetchError } = await supabase
    .from("tournament_decklists")
    .select(`
      id,
      deck_id,
      published_deck_id,
      participant_id,
      participants!inner ( name )
    `)
    .eq("tournament_id", tournamentId);

  if (fetchError) {
    console.error("Error fetching decklists:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!decklists || decklists.length === 0) {
    return { success: false, error: "No decklists to publish" };
  }

  // Calculate and persist placements first
  const { data: participants, error: partError } = await supabase
    .from("participants")
    .select("id, match_points, differential, dropped_out")
    .eq("tournament_id", tournamentId)
    .order("match_points", { ascending: false });

  if (!partError && participants) {
    const sorted = [...participants].sort((a, b) => {
      // Dropped players always rank after active players
      if (a.dropped_out !== b.dropped_out) return a.dropped_out ? 1 : -1;
      const mpDiff = (b.match_points || 0) - (a.match_points || 0);
      if (mpDiff !== 0) return mpDiff;
      return (b.differential || 0) - (a.differential || 0);
    });

    for (let i = 0; i < sorted.length; i++) {
      await supabase
        .from("participants")
        .update({ place: i + 1 })
        .eq("id", sorted[i].id);
    }
  }

  // Check if copies already exist (previous publish that was unpublished)
  const existingPublishedIds = (decklists as any[])
    .map((dl: any) => dl.published_deck_id)
    .filter(Boolean);

  if (existingPublishedIds.length > 0) {
    const { data: existingCopies } = await admin
      .from("decks")
      .select("id")
      .in("id", existingPublishedIds)
      .eq("user_id", REDEMPTIONCCG_USER_ID);

    if (existingCopies && existingCopies.length === existingPublishedIds.length) {
      // All copies still exist — just make them public again
      await admin
        .from("decks")
        .update({ is_public: true })
        .in("id", existingPublishedIds)
        .eq("user_id", REDEMPTIONCCG_USER_ID);

      // Mark tournament as published
      const { error: updateError } = await supabase
        .from("tournaments")
        .update({ decklists_published: true, deck_format: deckFormat })
        .eq("id", tournamentId);

      if (updateError) {
        console.error("Error publishing tournament:", updateError);
        return { success: false, error: updateError.message };
      }

      return { success: true };
    }
  }

  // No existing copies — create them fresh
  for (const dl of decklists as any[]) {
    const participantName = dl.participants?.name || "Unknown";

    // Fetch original deck metadata
    const { data: origDeck } = await admin
      .from("decks")
      .select("name, description, format, paragon, preview_card_1, preview_card_2, card_count")
      .eq("id", dl.deck_id)
      .single();

    if (!origDeck) continue;

    // Fetch original deck cards
    const { data: origCards } = await admin
      .from("deck_cards")
      .select("card_name, card_set, card_img_file, quantity, is_reserve")
      .eq("deck_id", dl.deck_id);

    // Create copy owned by RedemptionCCG.app
    const deckName = `${participantName} - ${tournament.name}`;
    const { data: newDeck, error: createError } = await admin
      .from("decks")
      .insert({
        user_id: REDEMPTIONCCG_USER_ID,
        name: deckName,
        description: origDeck.description || null,
        format: deckFormat !== "Other" ? deckFormat : origDeck.format,
        paragon: origDeck.paragon || null,
        preview_card_1: origDeck.preview_card_1 || null,
        preview_card_2: origDeck.preview_card_2 || null,
        card_count: origDeck.card_count || 0,
        is_public: true,
      })
      .select("id")
      .single();

    if (createError || !newDeck) {
      console.error("Error creating deck copy:", createError);
      continue;
    }

    // Copy cards to the new deck
    if (origCards && origCards.length > 0) {
      const cardRows = origCards.map((c: any) => ({
        deck_id: newDeck.id,
        card_name: c.card_name,
        card_set: c.card_set || null,
        card_img_file: c.card_img_file || null,
        quantity: c.quantity,
        is_reserve: c.is_reserve,
      }));

      await admin.from("deck_cards").insert(cardRows);
    }

    // Store published copy ID separately — deck_id stays as the user's original
    await admin
      .from("tournament_decklists")
      .update({ published_deck_id: newDeck.id })
      .eq("id", dl.id);
  }

  // Mark tournament as published with format
  const { error: updateError } = await supabase
    .from("tournaments")
    .update({
      decklists_published: true,
      deck_format: deckFormat,
    })
    .eq("id", tournamentId);

  if (updateError) {
    console.error("Error publishing tournament:", updateError);
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

// ─── Unpublish decklists ────────────────────────────────────────────

export async function unpublishTournamentDecklistsAction(tournamentId: string) {
  const supabase = await createClient();
  const admin = getSupabaseAdmin();

  // Find published copy IDs
  const { data: tdRows } = await supabase
    .from("tournament_decklists")
    .select("id, published_deck_id")
    .eq("tournament_id", tournamentId);

  const publishedDeckIds = (tdRows || [])
    .map((r: any) => r.published_deck_id)
    .filter(Boolean);

  // Delete the published copies (cards first for FK constraint)
  if (publishedDeckIds.length > 0) {
    await admin
      .from("deck_cards")
      .delete()
      .in("deck_id", publishedDeckIds);

    // Clear the published_deck_id references before deleting decks
    await admin
      .from("tournament_decklists")
      .update({ published_deck_id: null })
      .eq("tournament_id", tournamentId);

    await admin
      .from("decks")
      .delete()
      .in("id", publishedDeckIds)
      .eq("user_id", REDEMPTIONCCG_USER_ID);
  }

  // Toggle the tournament flag — deck_id links to original decks are untouched
  const { error } = await supabase
    .from("tournaments")
    .update({ decklists_published: false })
    .eq("id", tournamentId);

  if (error) {
    console.error("Error unpublishing:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
