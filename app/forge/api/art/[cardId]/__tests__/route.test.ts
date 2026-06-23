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

describe("GET /forge/api/art/[cardId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the caller is not a Forge member", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });
});
