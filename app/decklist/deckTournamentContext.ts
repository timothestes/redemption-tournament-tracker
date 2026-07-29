import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { normalizeTournamentFormat } from "@/lib/formats";

/**
 * Tournament context for a published decklist copy.
 *
 * A published copy is an archival record owned by the service account: its own
 * `decks` row timestamps and byline say nothing, while the event, the player
 * and the finish are the whole point. That context lives across `tournaments` /
 * `participants`, both of which are RLS-restricted to the host — a spectator's
 * session can never read them — so this uses the admin client behind an
 * explicit publish gate, the same shape as app/tournaments/actions.ts.
 */
export interface DeckTournamentContext {
  tournament_id: string;
  tournament_name: string;
  category: string | null;
  deck_format: string | null;
  ended_at: string | null;
  /** Whether /tournaments/results/<id> is reachable — decklists and results publish separately. */
  results_published: boolean;
  placement: number | null;
  player_name: string | null;
  match_points: number | null;
  differential: number | null;
  participant_count: number;
}

/**
 * Returns the tournament a published deck copy came from, or null when the deck
 * has no association (every ordinary community deck) or the host has taken the
 * decklists down.
 */
export async function loadDeckTournamentContext(
  publishedDeckId: string
): Promise<DeckTournamentContext | null> {
  try {
    const admin = getSupabaseAdmin();

    const { data: link } = await admin
      .from("tournament_decklists")
      .select("tournament_id, participant_id")
      .eq("published_deck_id", publishedDeckId)
      .maybeSingle();

    if (!link) return null;

    const { data: tournament } = await admin
      .from("tournaments")
      .select("id, name, category, deck_format, ended_at, results_published, decklists_published")
      .eq("id", link.tournament_id)
      .maybeSingle();

    // Gate FIRST: an unpublished tournament exposes nothing, and the
    // participant queries below never run.
    if (!tournament || tournament.decklists_published !== true) return null;

    const [participantResult, countResult] = await Promise.all([
      admin
        .from("participants")
        .select("place, name, match_points, differential")
        .eq("id", link.participant_id)
        .maybeSingle(),
      admin
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", link.tournament_id),
    ]);

    const participant = participantResult.data;
    // Decklists and results publish independently, so `decklists_published`
    // alone doesn't license the standings. Placement is already public either
    // way — publishTournamentDecklistsAction bakes it into the copy's name
    // ("Kevin - 1st Place - Nationals 2026") — but match points and
    // differential exist nowhere else, so a host who published decks while
    // keeping standings private must not have them leak out here. Withheld at
    // the loader, not the view, so they never reach the browser at all.
    const resultsPublished = tournament.results_published === true;

    return {
      tournament_id: tournament.id,
      tournament_name: tournament.name,
      category: tournament.category ?? null,
      deck_format: normalizeTournamentFormat(tournament.deck_format),
      ended_at: tournament.ended_at ?? null,
      results_published: resultsPublished,
      placement: participant?.place ?? null,
      player_name: participant?.name ?? null,
      match_points: resultsPublished ? participant?.match_points ?? null : null,
      differential: resultsPublished ? participant?.differential ?? null : null,
      participant_count: countResult.count ?? 0,
    };
  } catch (error) {
    // A deck page must still render if the admin client or a tournament query
    // fails — the deck itself is already loaded by then.
    console.error("Error loading deck tournament context:", error);
    return null;
  }
}
