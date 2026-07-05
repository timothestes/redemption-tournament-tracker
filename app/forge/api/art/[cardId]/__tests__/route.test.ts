import { describe, it, expect, vi, beforeEach } from "vitest";

// The route builds its own Supabase client; mock the factory so each test can
// shape auth + RPC results hermetically.
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));
// Blob read must never be reached on denied paths; stub it so an accidental
// call would be obvious (and to avoid importing the real @vercel/blob).
vi.mock("@/app/forge/lib/art", () => ({ readForgeArt: vi.fn() }));

import { GET } from "@/app/forge/api/art/[cardId]/route";
import { createClient } from "@/utils/supabase/server";
import { readForgeArt } from "@/app/forge/lib/art";

/**
 * One `forge_art_key` RPC now does the member gate + version resolution + key
 * lookup server-side (SECURITY INVOKER, RLS-checked — migration 066). The
 * route only distinguishes: session valid? key returned? blob readable?
 */
function mockSupabase(opts: { user?: boolean; artKey?: string | null; rpcError?: boolean }) {
  const rpc = vi.fn((fn: string) => {
    if (fn === "forge_art_key") {
      return Promise.resolve(
        opts.rpcError
          ? { data: null, error: { message: "boom" } }
          : { data: opts.artKey ?? null, error: null },
      );
    }
    // forge_log_art_download audit
    return Promise.resolve({ data: null, error: null });
  });
  const getUser = vi.fn().mockResolvedValue(
    opts.user === false
      ? { data: { user: null }, error: { message: "no session" } }
      : { data: { user: { id: "u1" } }, error: null },
  );
  const client = { auth: { getUser }, rpc };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}

const okBlob = () => ({
  statusCode: 200,
  stream: new ReadableStream(),
  blob: { contentType: "image/png" },
});

describe("GET /forge/api/art/[cardId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the caller has no session, even if a key would resolve", async () => {
    mockSupabase({ user: false, artKey: "forge-art/x" });
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("returns 404 when the RPC yields no key (non-member, unknown card, placeholder…)", async () => {
    mockSupabase({ artKey: null });
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("returns 404 when the RPC errors (e.g. malformed card id)", async () => {
    mockSupabase({ rpcError: true });
    const req = new Request("http://localhost/forge/api/art/not-a-uuid") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "not-a-uuid" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("maps query params onto the RPC (approved + finished)", async () => {
    const client = mockSupabase({ artKey: "forge-finished/k" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?v=approved&kind=finished") as never;
    await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(client.rpc).toHaveBeenCalledWith("forge_art_key", {
      p_card_id: "abc",
      p_approved: true,
      p_kind: "finished",
    });
    expect(readForgeArt).toHaveBeenCalledWith("forge-finished/k");
  });

  it("defaults to the working art view when no params are given", async () => {
    const client = mockSupabase({ artKey: "forge-art/w" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(client.rpc).toHaveBeenCalledWith("forge_art_key", {
      p_card_id: "abc",
      p_approved: false,
      p_kind: "art",
    });
  });

  it("returns 404 when the blob read returns null (dangling key)", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the blob read throws", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("blob down"));
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
  });

  it("streams the art with private no-store cache when present", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("serves an immutable private cache header when a t cache-buster is present", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?v=approved&t=v1") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });

  it("sets attachment disposition and logs the audit on ?download=1", async () => {
    const client = mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?download=1") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(client.rpc).toHaveBeenCalledWith("forge_log_art_download", { p_card_id: "abc" });
    // download responses must never be cached
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
