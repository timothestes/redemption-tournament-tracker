import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../auth", async (orig) => {
  const real: any = await orig();
  return { ...real, requireThreshingFloor: vi.fn() };
});

import { POST, DELETE } from "../drafts/[episode]/publish/route";
import * as auth from "../auth";
import { NextRequest } from "next/server";

function makeSupabase(results: any[]) {
  let call = 0;
  const next = () => results[Math.min(call++, results.length - 1)];
  const chain: any = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    single: vi.fn(async () => next()),
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
const ctx = (episode: string) => ({ params: Promise.resolve({ episode }) });
const post = (episode: string, body: any) =>
  POST(new NextRequest("http://x/threshingfloor/api/drafts/" + episode + "/publish", {
    method: "POST", body: JSON.stringify(body),
  }), ctx(episode));

beforeEach(() => vi.clearAllMocks());

describe("POST publish", () => {
  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await post("100", { data: {} });
    expect(r.status).toBe(404);
  });

  it("400s on non-object data", async () => {
    authorized([]);
    const r = await post("100", { data: "nope" });
    expect(r.status).toBe(400);
  });

  it("publishes and returns episode, published_at, and public url", async () => {
    authorized([{ data: { episode_number: "100", published_at: "2026-06-12T00:00:00Z" }, error: null }]);
    const r = await post("100", { data: { "ep-num": "100" } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.episode_number).toBe("100");
    expect(j.published_at).toBe("2026-06-12T00:00:00Z");
    expect(j.url).toBe("/threshingfloor/episodes/100");
  });
});

describe("DELETE unpublish", () => {
  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx("100"));
    expect(r.status).toBe(404);
  });

  it("returns success", async () => {
    authorized([{ error: null }]);
    const r = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx("100"));
    expect(r.status).toBe(200);
    expect((await r.json()).success).toBe(true);
  });
});
