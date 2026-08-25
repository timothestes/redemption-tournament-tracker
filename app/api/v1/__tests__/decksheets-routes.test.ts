import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRateLimit = vi.fn(async () => ({ success: true, limit: 30, remaining: 29, reset: 0 }));
vi.mock("@/lib/api/rateLimit", () => ({
  rateLimitForUnauthIp: (ip: string) => mockRateLimit(),
  extractClientIp: () => "1.2.3.4",
}));
vi.mock("@/lib/decksheets/upload", () => ({
  uploadDeckArtifact: vi.fn(async (path: string) => ({
    filename: path, downloadUrl: `https://example.test/${path}`, createdAt: "2026-08-23T00:00:00.000Z",
  })),
}));

import { POST as aodPost } from "@/app/api/v1/aod-count/route";
import { POST as pdfPost } from "@/app/api/v1/generate-decklist/route";
import { POST as imagePost } from "@/app/api/v1/generate-decklist-image/route";

const req = (body: unknown, raw = false) =>
  new Request("http://x/api/v1/x", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

// "Son of God" (bare) is NOT a catalog name; "Shield of Faith" is verified real
// (lib/cards/generated/cardData.json has exactly one entry). The resolver merges
// 40 identical lines into a single card at quantity 40 -> mainSize 40, passes min-40.
const DECK_40 = Array.from({ length: 40 }, () => "1\tShield of Faith").join("\n");

describe("contract parity", () => {
  // vi.clearAllMocks() before re-arming the default: a bare mockResolvedValue
  // reset (no clear) leaves the previous test's mockRejectedValue-derived
  // internal mock state around, which spuriously flags the *next* rejection
  // as an unhandled promise rejection even though guard() awaits + catches it
  // synchronously. app/join/__tests__/actions.test.ts's beforeEach uses the
  // same clear-then-arm order.
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: 0 });
  });

  it("missing fields → 400 {error:'invalid request'}", async () => {
    const res = await aodPost(req({ decklist: "1\tShield of Faith" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request" });
  });

  it("non-JSON body → 400 {error:'invalid request'}", async () => {
    const res = await aodPost(req("not json", true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request" });
  });

  it("limit violation → 400 {status:'error', message:<verbatim>}", async () => {
    const res = await pdfPost(req({ decklist: "1\tShield of Faith", decklist_type: "type_1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      status: "error",
      message: "Please load a deck that contains at least 40 cards in the main deck.",
    });
  });

  it("aod success → 200 with aod_count + createdAt", async () => {
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.message).toBe("aod count calculated successfully");
    expect(typeof body.data.aod_count).toBe("number");
    expect(typeof body.data.createdAt).toBe("string");
  });

  it("include_breakdown adds soul_aod_count + whiff_percentage", async () => {
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1", include_breakdown: true }));
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(["aod_count", "createdAt", "soul_aod_count", "whiff_percentage"]);
  });

  it("PDF success → 201 with bare-uuid filename (no extension)", async () => {
    const res = await pdfPost(req({ decklist: DECK_40, decklist_type: "type_1", deck_id: "ignored" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe("decklist generated successfully");
    expect(body.data.filename).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rate-limited → 429 {status:'error', message}", async () => {
    mockRateLimit.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 0 });
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1" }));
    expect(res.status).toBe(429);
    expect((await res.json()).status).toBe("error");
  });

  it("limiter throwing fails open (200, not 500)", async () => {
    mockRateLimit.mockRejectedValue(new Error("KV env missing"));
    const res = await aodPost(req({ decklist: DECK_40, decklist_type: "type_1" }));
    expect(res.status).toBe(200);
  });
});

describe("image route — error paths (success path deferred to Task 12's golden run)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: 0 });
  });

  it("missing fields → 400 {error:'invalid request'}", async () => {
    const res = await imagePost(req({ decklist: "1\tShield of Faith" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request" });
  });

  it("non-JSON body → 400 {error:'invalid request'}", async () => {
    const res = await imagePost(req("not json", true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid request" });
  });

  it("limit violation (bypass assertions still enforced) → 400 {status:'error', message:<verbatim>}", async () => {
    const deck141 = Array.from({ length: 141 }, () => "1\tShield of Faith").join("\n");
    const res = await imagePost(req({ decklist: deck141, decklist_type: "type_1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      status: "error",
      message: "Please load a deck that contains 140 or less cards in the main deck.",
    });
  });

  it("rate-limited → 429 {status:'error', message}", async () => {
    mockRateLimit.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 0 });
    const res = await imagePost(req({ decklist: DECK_40, decklist_type: "type_1" }));
    expect(res.status).toBe(429);
    expect((await res.json()).status).toBe("error");
  });
});
