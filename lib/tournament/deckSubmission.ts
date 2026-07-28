import { checkDeck, type DeckCheckCard, type DeckCheckIssue } from "@/utils/deckcheck";
import type { FormatId } from "@/lib/formats";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeckSnapshotCard {
  name: string;
  set: string;
  imgFile: string | null;
  quantity: number;
  zone: "main" | "reserve";
}

export interface DeckSnapshot {
  deckName: string;
  deckFormat: string;
  cards: DeckSnapshotCard[];
}

export type SubmissionBuild =
  | {
      success: true;
      snapshot: DeckSnapshot;
      isLegal: boolean;
      issues: DeckCheckIssue[];
      hasUnresolvedCards: boolean;
    }
  | { success: false; error: "deck_not_found" | "deck_not_accessible" };

/**
 * Single point where a deck is read, validated with checkDeck, and
 * serialized into an immutable snapshot. Access rule enforced here:
 * requester must own the deck OR the deck's visibility !== 'private'.
 * Callers decide policy (join/resubmit require isLegal && !hasUnresolvedCards;
 * host attach records the verdict but does not block).
 */
export async function buildDeckSubmission(
  admin: SupabaseClient,
  deckId: string,
  requestingUserId: string,
  tournamentFormat: FormatId
): Promise<SubmissionBuild> {
  const { data: deck, error } = await admin
    .from("decks")
    .select("id, user_id, name, format, visibility")
    .eq("id", deckId)
    .single();
  if (error || !deck) return { success: false, error: "deck_not_found" };
  const isOwner = deck.user_id === requestingUserId;
  if (isOwner === false && deck.visibility === "private")
    return { success: false, error: "deck_not_accessible" };

  const { data: rows, error: cardsError } = await admin
    .from("deck_cards")
    .select("card_name, card_set, card_img_file, quantity, zone")
    .eq("deck_id", deckId)
    .in("zone", ["main", "reserve"]); // maybeboard NEVER ships
  if (cardsError) return { success: false, error: "deck_not_found" };

  // ONE read: these rows are both what we validate and what we snapshot.
  const toCheckCard = (r: any): DeckCheckCard => ({
    name: r.card_name,
    set: r.card_set,
    quantity: r.quantity,
    imgFile: r.card_img_file ?? undefined,
  });
  const main = (rows ?? []).filter((r) => r.zone === "main").map(toCheckCard);
  const reserve = (rows ?? []).filter((r) => r.zone === "reserve").map(toCheckCard);

  const result = await checkDeck(main, reserve, tournamentFormat);

  return {
    success: true,
    snapshot: {
      deckName: deck.name ?? "Untitled Deck",
      // Provenance: the deck's DECLARED format. The validation format is
      // implied by the tournament + is_legal; don't overwrite the record.
      deckFormat: deck.format ?? "",
      cards: (rows ?? []).map((r) => ({
        name: r.card_name,
        set: r.card_set,
        imgFile: r.card_img_file ?? null,
        quantity: r.quantity,
        zone: r.zone,
      })),
    },
    isLegal: result.valid,
    issues: result.issues,
    hasUnresolvedCards: result.issues.some((i) => i.rule === "card-not-found"),
  };
}
