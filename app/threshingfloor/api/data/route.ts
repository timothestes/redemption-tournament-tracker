import { NextRequest, NextResponse } from "next/server";
import { loadUpcomingListings } from "@/app/tournaments/actions";
import { loadPublicSpoilersAction } from "@/app/spoilers/actions";
import { isUuid, loadPublicDeckDetail } from "@/lib/api/cache";
import { notFoundResponse, requireThreshingFloor } from "../auth";

// GET /threshingfloor/api/data?kind=tournaments | spoilers | deck&id=<uuid>
export async function GET(request: NextRequest) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();

  const kind = request.nextUrl.searchParams.get("kind");

  if (kind === "tournaments") {
    return NextResponse.json(await loadUpcomingListings());
  }

  if (kind === "spoilers") {
    const { spoilers } = await loadPublicSpoilersAction();
    return NextResponse.json(spoilers);
  }

  if (kind === "deck") {
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!isUuid(id)) {
      return NextResponse.json({ error: "id must be a deck uuid" }, { status: 400 });
    }
    const deck = await loadPublicDeckDetail(id);
    if (!deck) return notFoundResponse();
    // null format means Type 1 (legacy decks; see loadListFresh in lib/api/cache.ts)
    const format =
      deck.format === "Type 2" ? "T2" : deck.format === "Type 1" || deck.format === null ? "T1" : "";
    return NextResponse.json({
      name: deck.name,
      creator: deck.username,
      format,
      card_count: deck.card_count,
      cards: deck.cards,
    });
  }

  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}
