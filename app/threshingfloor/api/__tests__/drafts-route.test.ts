import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../auth", async (orig) => {
  const real: any = await orig();
  return { ...real, requireThreshingFloor: vi.fn() };
});

import { GET as listGET } from "../drafts/route";
import { GET as oneGET, PUT, DELETE } from "../drafts/[episode]/route";
import * as auth from "../auth";
import { NextRequest } from "next/server";

// Minimal chainable supabase stub. Each test sets `result` (and optionally
// `results` for sequential calls) to what the terminal call resolves to.
function makeSupabase(results: any[]) {
  let call = 0;
  const next = () => results[Math.min(call++, results.length - 1)];
  const chain: any = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    single: vi.fn(async () => next()),
    maybeSingle: vi.fn(async () => next()),
    then: (resolve: any) => Promise.resolve(next()).then(resolve),
  };
  return chain;
}

function authorized(results: any[]) {
  (auth.requireThreshingFloor as any).mockResolvedValue({
    supabase: makeSupabase(results),
    user: { id: "user-1" },
  });
}

const req = (url: string, init?: RequestInit) => new NextRequest(url, init as any);
const ctx = (episode: string) => ({ params: Promise.resolve({ episode }) });

beforeEach(() => vi.clearAllMocks());

describe("GET /threshingfloor/api/drafts", () => {
  it("returns 404 when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await listGET(req("http://x/threshingfloor/api/drafts"));
    expect(r.status).toBe(404);
  });

  it("returns the sorted list", async () => {
    authorized([
      {
        data: [
          { episode_number: "99", updated_at: "2026-01-01T00:00:00Z" },
          { episode_number: "100", updated_at: "2026-01-02T00:00:00Z" },
        ],
        error: null,
      },
    ]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts"));
    expect(r.status).toBe(200);
    expect((await r.json()).map((d: any) => d.episode_number)).toEqual(["100", "99"]);
  });

  it("returns 400 for non-numeric ?before=", async () => {
    authorized([]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts?before=draft"));
    expect(r.status).toBe(400);
  });

  it("returns the previous episode's full row for ?before=", async () => {
    authorized([
      { data: [{ episode_number: "98" }, { episode_number: "draft" }], error: null },
      { data: { episode_number: "98", data: { "rank-1": "Bo" }, updated_at: "t" }, error: null },
    ]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts?before=100"));
    expect(r.status).toBe(200);
    expect((await r.json()).episode_number).toBe("98");
  });

  it("returns 404 for ?before= with no earlier numeric episode", async () => {
    authorized([{ data: [{ episode_number: "draft" }], error: null }]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts?before=100"));
    expect(r.status).toBe(404);
  });
});

describe("PUT /threshingfloor/api/drafts/[episode]", () => {
  const put = (episode: string, body: any) =>
    PUT(
      req("http://x/threshingfloor/api/drafts/" + episode, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
      ctx(episode)
    );

  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await put("100", { data: {} });
    expect(r.status).toBe(404);
  });

  it("400s on an invalid episode segment", async () => {
    authorized([]);
    const r = await put("%20%20", { data: {} });
    expect(r.status).toBe(400);
  });

  it("400s when data is not an object", async () => {
    authorized([]);
    const r = await put("100", { data: "nope" });
    expect(r.status).toBe(400);
  });

  it("409s when lastSeenUpdatedAt mismatches", async () => {
    authorized([{ data: { updated_at: "2026-01-02T00:00:00Z" }, error: null }]);
    const r = await put("100", { data: {}, lastSeenUpdatedAt: "2026-01-01T00:00:00Z" });
    expect(r.status).toBe(409);
  });

  it("upserts and returns episode_number + updated_at", async () => {
    authorized([
      { data: null, error: null }, // no existing row
      { data: { episode_number: "100", updated_at: "2026-06-12T00:00:00Z" }, error: null },
    ]);
    const r = await put("100", { data: { "ep-num": "100" } });
    expect(r.status).toBe(200);
    expect((await r.json()).episode_number).toBe("100");
  });
});

describe("GET/DELETE /threshingfloor/api/drafts/[episode]", () => {
  it("GET returns 404 for a missing draft", async () => {
    authorized([{ data: null, error: null }]);
    const r = await oneGET(req("http://x/threshingfloor/api/drafts/100"), ctx("100"));
    expect(r.status).toBe(404);
  });

  it("DELETE returns success", async () => {
    authorized([{ error: null }]);
    const r = await DELETE(req("http://x/threshingfloor/api/drafts/100"), ctx("100"));
    expect(r.status).toBe(200);
    expect((await r.json()).success).toBe(true);
  });
});
