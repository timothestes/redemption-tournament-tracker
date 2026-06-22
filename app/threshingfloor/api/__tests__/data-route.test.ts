import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../auth", async (orig) => {
  const real: any = await orig();
  return { ...real, requireThreshingFloor: vi.fn() };
});

// Keep isUuid real; stub only the data loader.
vi.mock("@/lib/api/cache", async (orig) => {
  const real: any = await orig();
  return { ...real, loadPublicDeckDetail: vi.fn() };
});

// The deck branch never touches these, but route.ts imports them at module load.
vi.mock("@/app/tournaments/actions", () => ({ loadUpcomingListings: vi.fn() }));
vi.mock("@/app/spoilers/actions", () => ({ loadPublicSpoilersAction: vi.fn() }));

import { GET } from "../data/route";
import * as auth from "../auth";
import * as cache from "@/lib/api/cache";
import { NextRequest } from "next/server";

const req = (url: string) => new NextRequest(url);
const UUID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  (auth.requireThreshingFloor as any).mockResolvedValue({ supabase: {}, user: { id: "u1" } });
});

describe("GET /threshingfloor/api/data?kind=deck", () => {
  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await GET(req(`http://x/threshingfloor/api/data?kind=deck&id=${UUID}`));
    expect(r.status).toBe(404);
  });

  it("400s when id is not a uuid", async () => {
    const r = await GET(req("http://x/threshingfloor/api/data?kind=deck&id=nope"));
    expect(r.status).toBe(400);
  });

  it("404s when the deck is not found", async () => {
    (cache.loadPublicDeckDetail as any).mockResolvedValue(null);
    const r = await GET(req(`http://x/threshingfloor/api/data?kind=deck&id=${UUID}`));
    expect(r.status).toBe(404);
  });

  it("returns the cards array alongside the metadata", async () => {
    const cards = [
      { name: "Abishai (Ki)", set: "Ki", quantity: 1, zone: "main" },
      { name: "The Second Coming", set: "Wo", quantity: 1, zone: "reserve" },
    ];
    (cache.loadPublicDeckDetail as any).mockResolvedValue({
      name: "My Deck",
      username: "John",
      format: "Type 2",
      card_count: 2,
      cards,
    });

    const r = await GET(req(`http://x/threshingfloor/api/data?kind=deck&id=${UUID}`));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ name: "My Deck", creator: "John", format: "T2", card_count: 2 });
    expect(body.cards).toEqual(cards);
  });
});
