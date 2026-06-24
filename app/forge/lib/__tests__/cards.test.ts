import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({ validateArtFile: vi.fn(), uploadForgeArt: vi.fn() }));

import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { saveCard, getCard, listForgeCards } from "../cards";

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
