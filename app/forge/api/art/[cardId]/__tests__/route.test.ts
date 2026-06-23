import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth gate so we can force the unauthenticated branch hermetically.
vi.mock("@/app/forge/lib/auth", () => ({
  requireForge: vi.fn(),
  notFoundResponse: () => new Response("Not Found", { status: 404 }),
}));
// Blob read must never be reached on the unauth path; stub it so an accidental
// call would be obvious (and to avoid importing the real @vercel/blob).
vi.mock("@/app/forge/lib/art", () => ({ readForgeArt: vi.fn() }));

import { GET } from "@/app/forge/api/art/[cardId]/route";
import { requireForge } from "@/app/forge/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";

function memberCtx(workingArtKey: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: workingArtKey === null ? null : { working_art_key: workingArtKey },
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { supabase: { from, rpc }, user: { id: "u1", email: "e@x" }, role: "elder" };
}

describe("GET /forge/api/art/[cardId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the caller is not a Forge member", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("returns 404 when the blob read returns null (dangling key)", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(memberCtx("forge-art/x"));
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the blob read throws", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(memberCtx("forge-art/x"));
    (readForgeArt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("blob down"));
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
  });

  it("streams the art with private no-store cache when present", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(memberCtx("forge-art/x"));
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream(),
      blob: { contentType: "image/png" },
    });
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sets attachment disposition and logs the audit on ?download=1", async () => {
    const ctx = memberCtx("forge-art/x");
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream(),
      blob: { contentType: "image/png" },
    });
    const req = new Request("http://localhost/forge/api/art/abc?download=1") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(ctx.supabase.rpc).toHaveBeenCalledWith("forge_log_art_download", { p_card_id: "abc" });
  });
});
