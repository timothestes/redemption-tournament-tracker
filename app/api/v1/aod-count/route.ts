import { NextResponse } from "next/server";
import { guard } from "@/lib/decksheets/routeGuard";
import { DeckCheckError } from "@/lib/decksheets/errors";
import { parseDecklistText } from "@/lib/decksheets/parse";
import { resolveDeck } from "@/lib/decksheets/resolve";
import { enforceLimits } from "@/lib/decksheets/limits";
import { calculateAodBreakdown } from "@/lib/decksheets/counts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await guard(req);
  if (limited) return limited;
  let data: any;
  try { data = await req.json(); } catch { return NextResponse.json({ error: "invalid request" }, { status: 400 }); }
  if (!data || typeof data !== "object" || !("decklist" in data) || !("decklist_type" in data))
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const deck = resolveDeck(parseDecklistText(String(data.decklist)));
    enforceLimits(deck, String(data.decklist_type), true);
    const breakdown = calculateAodBreakdown(deck.main);
    const responseData = data.include_breakdown
      ? { ...breakdown, createdAt: new Date().toISOString() }
      : { aod_count: breakdown.aod_count, createdAt: new Date().toISOString() };
    return NextResponse.json(
      { status: "success", message: "aod count calculated successfully", data: responseData }, { status: 200 });
  } catch (err) {
    if (err instanceof DeckCheckError)
      return NextResponse.json({ status: "error", message: err.message }, { status: 400 });
    console.error(err);
    return NextResponse.json({ status: "error", message: "something unexpected happened" }, { status: 500 });
  }
}
