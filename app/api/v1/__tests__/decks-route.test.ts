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
  return { ...real, loadPublicDecksList: vi.fn() };
});

import { GET, OPTIONS } from "../decks/route";
import * as auth from "@/lib/api/auth";
import * as rl from "@/lib/api/rateLimit";
import * as cache from "@/lib/api/cache";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/decks", () => {
  it("returns 401 when no Authorization header is present", async () => {
    (auth.extractBearerToken as any).mockReturnValue(null);
    const r = await GET(req("https://x/api/v1/decks"));
    expect(r.status).toBe(401);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 401 when the bearer key is invalid", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_bad");
    (auth.verifyApiKey as any).mockResolvedValue(null);
    const r = await GET(req("https://x/api/v1/decks", { authorization: "Bearer rtt_bad" }));
    expect(r.status).toBe(401);
  });

  it("returns 400 for invalid query params", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_good");
    (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
    (rl.rateLimitForKey as any).mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 1000 });
    const r = await GET(req("https://x/api/v1/decks?sort=banana"));
    expect(r.status).toBe(400);
  });

  it("returns 429 when rate-limited (keys present)", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_good");
    (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
    (rl.rateLimitForKey as any).mockResolvedValue({ success: false, limit: 60, remaining: 0, reset: 1234567890 });
    const r = await GET(req("https://x/api/v1/decks"));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).not.toBeNull();
    expect(r.headers.get("X-RateLimit-Reset")).toBe("1234567890");
  });

  it("returns 200 with the cached list body and rate-limit + cache-control headers", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_good");
    (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
    (rl.rateLimitForKey as any).mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 999 });
    (cache.loadPublicDecksList as any).mockResolvedValue({
      data: [],
      pagination: { page: 1, page_size: 24, total: 0, has_more: false },
    });

    const r = await GET(req("https://x/api/v1/decks"));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toMatch(/s-maxage=300/);
    expect(r.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(auth.touchLastUsedAt).toHaveBeenCalledWith("k");
  });
});

describe("OPTIONS /api/v1/decks", () => {
  it("returns 204 with CORS preflight headers and bypasses auth", async () => {
    const r = await OPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(auth.verifyApiKey).not.toHaveBeenCalled();
  });
});
