import { NextResponse } from "next/server";
import { rateLimitForUnauthIp, extractClientIp } from "@/lib/api/rateLimit";
import { DeckCheckError } from "@/lib/decksheets/errors";
import { parseDecklistText } from "@/lib/decksheets/parse";
import { resolveDeck } from "@/lib/decksheets/resolve";
import { enforceLimits } from "@/lib/decksheets/limits";
import { calculateMCount, calculateAodBreakdown } from "@/lib/decksheets/counts";
import { generateDeckImage } from "@/lib/decksheets/deckImage";
import { uploadDeckArtifact } from "@/lib/decksheets/upload";

export const runtime = "nodejs";

async function guard(req: Request): Promise<NextResponse | null> {
  try {
    const rl = await rateLimitForUnauthIp(extractClientIp(req));
    if (rl.success === false)
      return NextResponse.json({ status: "error", message: "Too many requests. Please try again shortly." }, { status: 429 });
  } catch { /* fail open: limiter must never 500 (join/actions.ts pattern) */ }
  return null;
}

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
    const mCountValue = data.m_count ? calculateMCount(deck.main) : null;
    const aodCountValue = data.aod_count ? calculateAodBreakdown(deck.main).aod_count : null;
    const bytes = await generateDeckImage({
      deckType: String(data.decklist_type), deck, nCardColumns: Number(data.n_card_columns ?? 10),
      mCountValue, aodCountValue, isLegal: data.is_legal ?? null,
    });
    const uuid = crypto.randomUUID();
    const uploaded = await uploadDeckArtifact(`${uuid}.webp`, bytes, "image/webp");
    return NextResponse.json(
      { status: "success", message: "deck image generated successfully", data: uploaded }, { status: 201 });
  } catch (err) {
    if (err instanceof DeckCheckError)
      return NextResponse.json({ status: "error", message: err.message }, { status: 400 });
    console.error(err);
    return NextResponse.json({ status: "error", message: "something unexpected happened" }, { status: 500 });
  }
}
