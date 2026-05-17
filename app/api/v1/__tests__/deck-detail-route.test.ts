import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  extractBearerToken: vi.fn(),
  verifyApiKey: vi.fn(),
  touchLastUsedAt: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  extractClientIp: vi.fn(() => "1.2.3.4"),
  rateLimitForKey: vi.fn(),
  rateLimitForUnauthIp: vi.fn(async () => ({ success: true, limit: 30, remaining: 29, reset: 1000 })),
}));
vi.mock("@/lib/api/cache", async (orig) => {
  const real: any = await orig();
  return { ...real, loadPublicDeckDetail: vi.fn() };
});

import { GET } from "../decks/[id]/route";
import * as auth from "@/lib/api/auth";
import * as rl from "@/lib/api/rateLimit";
import * as cache from "@/lib/api/cache";

function req() {
  return new Request("https://x/api/v1/decks/abc", { headers: { authorization: "Bearer rtt_good" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth.extractBearerToken as any).mockReturnValue("rtt_good");
  (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
  (rl.rateLimitForKey as any).mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 999 });
});

describe("GET /api/v1/decks/:id", () => {
  it("returns 400 for malformed UUID", async () => {
    const r = await GET(req(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(r.status).toBe(400);
    expect(cache.loadPublicDeckDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when the cached loader returns null", async () => {
    (cache.loadPublicDeckDetail as any).mockResolvedValue(null);
    const r = await GET(req(), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    expect(r.status).toBe(404);
  });

  it("returns 200 with the cached body + cache-control header when found", async () => {
    (cache.loadPublicDeckDetail as any).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "X",
      cards: [],
    });
    const r = await GET(req(), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toMatch(/s-maxage=300/);
  });
});
