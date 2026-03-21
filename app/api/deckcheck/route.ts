import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { checkDeck } from "@/utils/deckcheck";
import { DeckCheckCard } from "@/utils/deckcheck/types";

/**
 * Create a Supabase client that bypasses RLS for the deckcheck API.
 * Uses the service role key so we can look up any deck (public or private).
 * Falls back to the regular server client if service role key is not set.
 */
async function createDeckcheckClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    return createSupabaseClient(url, serviceKey);
  }
  return createServerClient();
}

/**
 * Parse raw decklist text (tab-separated: "quantity\tname") into DeckCheckCard arrays.
 * Expects a "Reserve:" line separating main deck from reserve.
 */
function parseDecklistText(text: string): { mainCards: DeckCheckCard[]; reserveCards: DeckCheckCard[] } {
  const mainCards: DeckCheckCard[] = [];
  const reserveCards: DeckCheckCard[] = [];
  let inReserve = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.toLowerCase() === "reserve:" || trimmed.toLowerCase() === "reserve") {
      inReserve = true;
      continue;
    }

    // Skip token lines
    if (trimmed.toLowerCase() === "tokens:" || trimmed.toLowerCase() === "tokens") break;

    // Parse "quantity\tname" or "quantity name"
    const match = trimmed.match(/^(\d+)\s+(.+)/);
    if (!match) continue;

    const quantity = parseInt(match[1], 10);
    const name = match[2].trim();
    if (!quantity || !name) continue;

    const card: DeckCheckCard = { name, set: "", quantity };

    if (inReserve) {
      reserveCards.push(card);
    } else {
      mainCards.push(card);
    }
  }

  return { mainCards, reserveCards };
}

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

  const rawBody = body as {
    deckId?: string;
    deck_id?: string;
    cards?: DeckCheckCard[];
    reserve?: DeckCheckCard[];
    format?: string;
    decklist?: string;
    decklist_type?: string;
  };

  // Accept both camelCase and snake_case for deck ID
  const deckId = rawBody.deckId || rawBody.deck_id;
  const { cards, reserve, format, decklist, decklist_type } = rawBody;

  // Validate that we have at least one input method
  if (!deckId && !cards && !decklist) {
    return NextResponse.json(
      { error: "Request must include 'deckId', 'cards', or 'decklist' text" },
      { status: 400 }
    );
  }

  try {
    // Option C: Raw decklist text — parse into cards
    if (!deckId && !cards && decklist) {
      const { mainCards, reserveCards } = parseDecklistText(decklist);
      const fmt = decklist_type === "type_2" ? "Type 2" : format || "Type 1";
      const result = await checkDeck(mainCards, reserveCards, fmt);
      return NextResponse.json(result);
    }

    if (deckId) {
      // Bearer token = trusted caller (downstream API) → bypass RLS
      // No token = browser user → RLS enforces ownership/public access
      const supabase = verifyAuth(request)
        ? await createDeckcheckClient()
        : await createServerClient();

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
