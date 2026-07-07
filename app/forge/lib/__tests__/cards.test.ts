import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({ validateArtFile: vi.fn(), uploadForgeArt: vi.fn(), uploadForgeFinished: vi.fn() }));

import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt, uploadForgeFinished } from "@/app/forge/lib/art";
import { saveCard, getCard, listForgeCards, uploadArt, uploadFinished } from "../cards";

function ctx(rpcImpl?: any, queryRows?: any[]) {
  const order = vi.fn(async () => ({ data: queryRows ?? [], error: null }));
  const eqList = vi.fn(() => ({ order }));
  const maybeSingle = vi.fn(async () => ({ data: (queryRows ?? [])[0] ?? null, error: null }));
  const eqOne = vi.fn(() => ({ maybeSingle }));
  const isFn = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ order, maybeSingle, is: isFn })) }));
  return {
    role: "elder",
    user: { id: "u1", email: "e@x" },
    supabase: {
      rpc: vi.fn(rpcImpl ?? (async () => ({ data: "2026-06-23T00:00:00Z", error: null }))),
      from: vi.fn(() => ({ select })),
    },
    isFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("saveCard", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await saveCard("c1", { name: "x" })).ok).toBe(false);
  });
  it("calls forge_save_card with the card id + snapshot and returns updatedAt", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await saveCard("c1", { name: "Goliath", cardType: ["EvilCharacter"] });
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_save_card", { p_card_id: "c1", p_snapshot: { name: "Goliath", cardType: ["EvilCharacter"] } },
    ]);
    expect(r.updatedAt).toBe("2026-06-23T00:00:00Z");
  });
});

describe("getCard / listForgeCards", () => {
  it("returns null when not a member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await getCard("c1")).toBeNull();
    expect(await listForgeCards()).toEqual([]);
  });
  it("maps a row into ForgeCardFull", async () => {
    const row = { id: "c1", title: "Goliath", working_snapshot: { name: "Goliath" }, working_art_key: "k", working_art_is_placeholder: false, status: "private_idea", updated_at: "t", set_id: null, published_version_id: null, approved_version_id: null };
    (requireForge as any).mockResolvedValue(ctx(undefined, [row]));
    const got = await getCard("c1");
    expect(got).toMatchObject({ id: "c1", title: "Goliath", snapshot: { name: "Goliath" }, hasArt: true, status: "private_idea", setId: null });
  });
  it("listForgeCards selects only private ideas (set_id IS NULL)", async () => {
    const c = ctx(undefined, []);
    (requireForge as any).mockResolvedValue(c);
    await listForgeCards();
    expect(c.isFn).toHaveBeenCalledWith("set_id", null);
  });
});

describe("uploadFinished", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await uploadFinished("c1", new FormData());
    expect(r.ok).toBe(false);
  });
  it("uploads and calls forge_set_working_finished with the returned key", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockResolvedValue("forge-finished/abc");
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "c.png", { type: "image/png" }));
    const r = await uploadFinished("c1", fd);
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_set_working_finished", { p_card_id: "c1", p_key: "forge-finished/abc" },
    ]);
  });
});

describe("getCard maps hasFinished", () => {
  it("hasFinished true when working_finished_key present", async () => {
    const row = { id: "c1", title: "T", working_snapshot: {}, working_art_key: null, working_art_is_placeholder: false, working_finished_key: "forge-finished/x", status: "draft", updated_at: "t", set_id: null, published_version_id: null, approved_version_id: null };
    (requireForge as any).mockResolvedValue(ctx(undefined, [row]));
    expect((await getCard("c1"))?.hasFinished).toBe(true);
  });
});

describe("upload decode failures", () => {
  it("uploadArt returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeArt as any).mockRejectedValue(new Error("unsupported image format"));
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    expect(await uploadArt("c1", fd)).toEqual({ ok: false, error: "Could not read image file." });
  });

  it("uploadFinished returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockRejectedValue(new Error("unsupported image format"));
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "c.png", { type: "image/png" }));
    expect(await uploadFinished("c1", fd)).toEqual({ ok: false, error: "Could not read image file." });
  });
});
