import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../auth", async (orig) => {
  const real: any = await orig();
  return { ...real, requireThreshingFloor: vi.fn() };
});

import { GET, PUT } from "../store/[key]/route";
import * as auth from "../auth";
import { NextRequest } from "next/server";

// Minimal chainable supabase stub. Each test sets `results` to what the
// terminal call(s) resolve to, in order.
function makeSupabase(results: any[]) {
  let call = 0;
  const next = () => results[Math.min(call++, results.length - 1)];
  const chain: any = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    insert: vi.fn(() => chain),
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
const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

beforeEach(() => vi.clearAllMocks());

describe("GET /threshingfloor/api/store/[key]", () => {
  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await GET(req("http://x/threshingfloor/api/store/players"), ctx("players"));
    expect(r.status).toBe(404);
  });

  it("400s on a key outside the allowlist", async () => {
    authorized([]);
    const r = await GET(req("http://x/threshingfloor/api/store/secrets"), ctx("secrets"));
    expect(r.status).toBe(400);
  });

  it("404s when the key has no stored value yet", async () => {
    authorized([{ data: null, error: null }]);
    const r = await GET(req("http://x/threshingfloor/api/store/players"), ctx("players"));
    expect(r.status).toBe(404);
  });

  it("returns the stored value", async () => {
    authorized([
      { data: { key: "players", data: { Hendrix: { format: "T1" } }, updated_at: "t" }, error: null },
    ]);
    const r = await GET(req("http://x/threshingfloor/api/store/players"), ctx("players"));
    expect(r.status).toBe(200);
    expect((await r.json()).data.Hendrix.format).toBe("T1");
  });
});

describe("PUT /threshingfloor/api/store/[key]", () => {
  const put = (key: string, body: any) =>
    PUT(
      req("http://x/threshingfloor/api/store/" + key, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
      ctx(key)
    );

  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await put("players", { data: {} });
    expect(r.status).toBe(404);
  });

  it("400s on a key outside the allowlist", async () => {
    authorized([]);
    const r = await put("secrets", { data: {} });
    expect(r.status).toBe(400);
  });

  it("400s when data is a primitive", async () => {
    authorized([]);
    const r = await put("players", { data: "nope" });
    expect(r.status).toBe(400);
  });

  // ---- No-token path: first write uses INSERT ----
  it("inserts a new array value (tournaments) and returns key + updated_at", async () => {
    authorized([{ data: { key: "tournaments", updated_at: "t" }, error: null }]);
    const r = await put("tournaments", { data: ["Regionals", "Nationals"] });
    expect(r.status).toBe(200);
    expect((await r.json()).key).toBe("tournaments");
  });

  it("inserts a new object value (players) and returns key + updated_at", async () => {
    authorized([{ data: { key: "players", updated_at: "2026-06-13T00:00:00Z" }, error: null }]);
    const r = await put("players", { data: { Hendrix: { format: "T1" } } });
    expect(r.status).toBe(200);
    expect((await r.json()).key).toBe("players");
  });

  it("409s when the row was created concurrently (unique violation, no token)", async () => {
    authorized([{ data: null, error: { code: "23505" } }]);
    const r = await put("players", { data: {} });
    expect(r.status).toBe(409);
  });

  it("500s on a non-unique insert error", async () => {
    authorized([{ data: null, error: { code: "08006" } }]);
    const r = await put("players", { data: {} });
    expect(r.status).toBe(500);
  });

  // ---- Token path: overwrite with optimistic concurrency ----
  it("409s when lastSeenUpdatedAt is stale", async () => {
    authorized([{ data: { updated_at: "2026-01-02T00:00:00Z" }, error: null }]);
    const r = await put("players", { data: {}, lastSeenUpdatedAt: "2026-01-01T00:00:00Z" });
    expect(r.status).toBe(409);
  });

  it("upserts when lastSeenUpdatedAt matches", async () => {
    authorized([
      { data: { updated_at: "2026-06-13T00:00:00Z" }, error: null }, // existing row, token matches
      { data: { key: "players", updated_at: "2026-06-13T01:00:00Z" }, error: null },
    ]);
    const r = await put("players", { data: { Hendrix: {} }, lastSeenUpdatedAt: "2026-06-13T00:00:00Z" });
    expect(r.status).toBe(200);
    expect((await r.json()).updated_at).toBe("2026-06-13T01:00:00Z");
  });

  it("500s when the existing-row check errors (token path)", async () => {
    authorized([{ data: null, error: { code: "08006" } }]);
    const r = await put("players", { data: {}, lastSeenUpdatedAt: "t" });
    expect(r.status).toBe(500);
  });
});
