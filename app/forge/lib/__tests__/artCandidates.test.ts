import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(() => null),
  uploadForgeArt: vi.fn(),
  uploadForgeArtRaw: vi.fn(),
  readForgeArt: vi.fn(),
}));
vi.mock("@/app/forge/lib/imageCrop", () => ({
  clampCropRect: vi.fn((r) => r),
  cropCardImage: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { uploadForgeArt, uploadForgeArtRaw, readForgeArt } from "@/app/forge/lib/art";
import { clampCropRect, cropCardImage } from "@/app/forge/lib/imageCrop";
import { addArtCandidate, applyCrop, deleteArtCandidate } from "../artCandidates";

/** Supabase mock: from() returns a self-chaining builder resolving to `rows`
 * keyed by table name; rpc() resolves from `rpcResults` keyed by fn name. */
function mockCtx(opts: {
  rows?: Record<string, unknown>;
  rpcResults?: Record<string, { error: null | { message: string } }>;
}) {
  const from = vi.fn((table: string) => {
    const result = { data: opts.rows?.[table] ?? null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) builder[m] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(() => Promise.resolve(result));
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  const rpc = vi.fn((fn: string) =>
    Promise.resolve(opts.rpcResults?.[fn] ?? { data: null, error: null })
  );
  const ctx = { supabase: { from, rpc }, user: { id: "u1" }, role: "elder" };
  (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return { from, rpc };
}

const fd = () => {
  const f = new FormData();
  f.set("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
  return f;
};

describe("addArtCandidate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads, registers the candidate, and auto-activates on an art-less card", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: null } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_add_art_candidate", { p_card_id: "card1", p_key: "forge-art/k1" });
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", { p_card_id: "card1", p_key: "forge-art/k1", p_original_key: "forge-art/k1" });
  });

  it("does not auto-activate when the card already has art", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: "forge-art/existing" } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k2");
    await addArtCandidate("card1", fd());
    expect(rpc).not.toHaveBeenCalledWith("forge_set_working_art", expect.anything());
  });

  it("maps the cap error to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_add_art_candidate: { error: { message: "candidate limit reached (12)" } } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k3");
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/12 images/);
  });

  it("refuses when not an elder", async () => {
    (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await addArtCandidate("card1", fd());
    expect(r.ok).toBe(false);
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });
});

describe("deleteArtCandidate", () => {
  beforeEach(() => vi.clearAllMocks());
  it("maps the active-source refusal to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_delete_art_candidate: { error: { message: "candidate is the source of the current artwork" } } } });
    const r = await deleteArtCandidate("card1", "cand1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/source of the current artwork/i);
  });
});

describe("applyCrop", () => {
  // vi.clearAllMocks() clears call history but NOT a prior mockReturnValue —
  // the first test below overrides clampCropRect to return null, so restore
  // its passthrough default here or that override leaks into later tests.
  beforeEach(() => {
    vi.clearAllMocks();
    (clampCropRect as ReturnType<typeof vi.fn>).mockImplementation((r) => r);
  });

  it("rejects an invalid rect before touching the blob store", async () => {
    mockCtx({});
    (clampCropRect as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const r = await applyCrop("card1", "cand1", { x: 0, y: 0, width: 0, height: 0 });
    expect(r.ok).toBe(false);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("crops, uploads raw, and saves cropped-as-working with the candidate as original", async () => {
    const { rpc } = mockCtx({ rows: { forge_card_art_candidates: { key: "forge-art/src" } } });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([new Uint8Array([1, 2])]).stream(),
    });
    (cropCardImage as ReturnType<typeof vi.fn>).mockResolvedValue({ data: Buffer.from([3]), contentType: "image/jpeg" });
    (uploadForgeArtRaw as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/cropped");
    const r = await applyCrop("card1", "cand1", { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", {
      p_card_id: "card1",
      p_key: "forge-art/cropped",
      p_original_key: "forge-art/src",
    });
  });
});
