import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { checkDeck } from "@/utils/deckcheck";
import { DeckCheckCard } from "@/utils/deckcheck/types";

function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  const expectedToken = process.env.DECKCHECK_API_TOKEN;
  if (!expectedToken) return false;

  return token === expectedToken;
}

export async function POST(request: NextRequest) {
  // Allow same-origin requests (browser/internal) without auth.
  // External API consumers must provide a Bearer token.
  const origin = request.headers.get("origin");
  const isSameOrigin =
    origin &&
    (origin.includes("localhost") ||
      origin.includes(process.env.NEXT_PUBLIC_SITE_URL ?? ""));

  if (!isSameOrigin && !verifyAuth(request)) {
    return NextResponse.json(
      { error: "Unauthorized — provide a valid Bearer token" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const { deckId, cards, reserve, format } = body as {
    deckId?: string;
    cards?: DeckCheckCard[];
    reserve?: DeckCheckCard[];
    format?: string;
  };

  // Validate that we have either a deckId or a cards array
  if (!deckId && !cards) {
    return NextResponse.json(
      { error: "Request must include either 'deckId' or 'cards'" },
      { status: 400 }
    );
  }

  try {
    if (deckId) {
      const supabase = await createClient();

      // Fetch the deck
      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .select("id, format")
        .eq("id", deckId)
        .single();

      if (deckError || !deck) {
        return NextResponse.json(
          { error: "Deck not found" },
          { status: 404 }
        );
      }

      // Fetch all cards for the deck
      const { data: deckCards, error: cardsError } = await supabase
        .from("deck_cards")
        .select("card_name, card_set, quantity, is_reserve")
        .eq("deck_id", deckId);

      if (cardsError) {
        return NextResponse.json(
          { error: "Failed to fetch deck cards" },
          { status: 500 }
        );
      }

      // Split into main deck and reserve
      const mainCards: DeckCheckCard[] = [];
      const reserveCards: DeckCheckCard[] = [];

      for (const card of deckCards || []) {
        const deckCheckCard: DeckCheckCard = {
          name: card.card_name,
          set: card.card_set,
          quantity: card.quantity,
        };

        if (card.is_reserve) {
          reserveCards.push(deckCheckCard);
        } else {
          mainCards.push(deckCheckCard);
        }
      }

      const result = await checkDeck(mainCards, reserveCards, deck.format);
      return NextResponse.json(result);
    }

    // Direct card validation
    const result = await checkDeck(cards!, reserve || [], format);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Deck check error:", error);
    return NextResponse.json(
      { error: "Internal server error during deck check" },
      { status: 500 }
    );
  }
}
