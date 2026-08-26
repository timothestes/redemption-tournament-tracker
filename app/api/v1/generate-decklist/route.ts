import { NextResponse } from "next/server";
import { guard } from "@/lib/decksheets/routeGuard";
import { DeckCheckError } from "@/lib/decksheets/errors";
import { parseDecklistText } from "@/lib/decksheets/parse";
import { resolveDeck } from "@/lib/decksheets/resolve";
import { enforceLimits } from "@/lib/decksheets/limits";
import { calculateMCount, calculateAodBreakdown } from "@/lib/decksheets/counts";
import { generateDeckCheckPdf } from "@/lib/decksheets/pdf";
import { uploadDeckArtifact } from "@/lib/decksheets/upload";

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
    const decklistType = String(data.decklist_type);
    enforceLimits(deck, decklistType, false);
    if (decklistType !== "type_1" && decklistType !== "paragon" && decklistType !== "type_2") {
      // Flask's make_pdf leaves `template_path` unbound for any other decklist_type
      // (text_to_pdf.py:387-392) -> NameError -> its generic except -> 500 with this
      // exact envelope. The deck-size assertions above already ran, so an invalid
      // deck combined with an unknown type still 400s on the size error, matching
      // Flask's execution order (assertions happen before make_pdf's template lookup).
      throw new Error(`Unsupported decklist_type: ${decklistType}`);
    }
    const mCountValue = data.m_count ? calculateMCount(deck.main) : null;
    const aodCountValue = data.aod_count ? calculateAodBreakdown(deck.main).aod_count : null;
    const bytes = await generateDeckCheckPdf({
      deckType: decklistType, deck, name: String(data.name ?? ""),
      event: String(data.event ?? ""), showAlignment: Boolean(data.show_alignment),
      mCountValue, aodCountValue, isLegal: data.is_legal ?? null,
    });
    const uuid = crypto.randomUUID();
    const uploaded = await uploadDeckArtifact(uuid, bytes, "application/pdf");
    return NextResponse.json(
      { status: "success", message: "decklist generated successfully", data: uploaded }, { status: 201 });
  } catch (err) {
    if (err instanceof DeckCheckError)
      return NextResponse.json({ status: "error", message: err.message }, { status: 400 });
    console.error(err);
    return NextResponse.json({ status: "error", message: "something unexpected happened" }, { status: 500 });
  }
}
