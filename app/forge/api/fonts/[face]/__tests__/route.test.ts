import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({
  requireForge: vi.fn(),
  notFoundResponse: () => new Response("Not Found", { status: 404 }),
}));
// Never import the real @vercel/blob; an unexpected read must be visible.
vi.mock("@/app/forge/lib/art", () => ({
  FORGE_FONT_FACES: ["title", "stat"],
  readForgeFont: vi.fn(),
}));

import { GET } from "@/app/forge/api/fonts/[face]/route";
import { requireForge } from "@/app/forge/lib/auth";
import { readForgeFont } from "@/app/forge/lib/art";

const call = (face: string) =>
  GET(new Request(`http://localhost/forge/api/fonts/${face}`), { params: Promise.resolve({ face }) });
const member = () => (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue({ role: "playtester" });
const okBlob = () => ({ statusCode: 200, stream: new ReadableStream(), blob: { contentType: "application/octet-stream" } });

describe("GET /forge/api/fonts/[face]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s non-members without touching the store (the area stays secret)", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await call("title");
    expect(res.status).toBe(404);
    expect(readForgeFont).not.toHaveBeenCalled();
  });

  it("404s unknown faces even for members, before any store read", async () => {
    member();
    const res = await call("body");
    expect(res.status).toBe(404);
    expect(readForgeFont).not.toHaveBeenCalled();
  });

  it("streams a known face to a member as a privately cacheable TTF", async () => {
    member();
    (readForgeFont as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const res = await call("stat");
    expect(res.status).toBe(200);
    expect(readForgeFont).toHaveBeenCalledWith("stat");
    expect(res.headers.get("Content-Type")).toBe("font/ttf");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("404s when the font is missing from the store or the read fails", async () => {
    member();
    (readForgeFont as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ statusCode: 404, stream: null, blob: null });
    expect((await call("title")).status).toBe(404);
    (readForgeFont as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("store down"));
    expect((await call("title")).status).toBe(404);
  });
});
