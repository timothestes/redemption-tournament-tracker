import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { shareToSet, publish, approve, deleteCard } from "../lifecycle";
import { bulkLifecycle, bulkShareToSet } from "../lifecycle";

function ctx(rpc?: any) {
  return { role: "elder", user: { id: "u1" }, supabase: { rpc: vi.fn(rpc ?? (async () => ({ data: null, error: null }))) } };
}
beforeEach(() => vi.clearAllMocks());

describe("lifecycle actions", () => {
  it("reject a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await publish("c1")).ok).toBe(false);
  });
  it("shareToSet calls forge_share_card_to_set with both ids", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    expect((await shareToSet("c1", "s1")).ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_share_card_to_set", { p_card_id: "c1", p_set_id: "s1" }]);
  });
  it("publish calls forge_publish_card with a null note by default", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await publish("c1");
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_publish_card", { p_card_id: "c1", p_note: null }]);
  });
  it("publish passes a trimmed note and blanks become null", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await publish("c1", "  fixed toughness typo  ");
    expect((c.supabase.rpc as any).mock.calls[0][1]).toEqual({ p_card_id: "c1", p_note: "fixed toughness typo" });
    await publish("c2", "   ");
    expect((c.supabase.rpc as any).mock.calls[1][1]).toEqual({ p_card_id: "c2", p_note: null });
  });
  it("approve surfaces an RPC error as ok:false", async () => {
    const c = ctx(async () => ({ data: null, error: { message: "nope" } }));
    (requireElder as any).mockResolvedValue(c);
    expect((await approve("c1")).ok).toBe(false);
  });
  it("deleteCard calls forge_delete_card", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await deleteCard("c1");
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_delete_card", { p_card_id: "c1" }]);
  });
});

function bulkCtx(rows: { id: string; status: string }[], rpcError: any = null) {
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
  const supabase = {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(async () => ({ data: rows, error: null })),
      })),
    })),
  };
  return { role: "elder", user: { id: "u1" }, supabase };
}

describe("bulkLifecycle", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await bulkLifecycle("release", ["c1"])).ok).toBe(false);
  });

  it("runs eligible cards, skips ineligible ones", async () => {
    const c = bulkCtx([
      { id: "c1", status: "draft" },
      { id: "c2", status: "approved" },   // not eligible for release
      { id: "c3", status: "playtesting" },
    ]);
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkLifecycle("release", ["c1", "c2", "c3"]);
    expect(r).toEqual({ ok: true, done: 2, skipped: 1, failed: 0 });
    expect((c.supabase.rpc as any).mock.calls.map((x: any) => x[1].p_card_id)).toEqual(["c1", "c3"]);
    expect((c.supabase.rpc as any).mock.calls[0][0]).toBe("forge_publish_card");
  });

  it("counts unknown ids (RLS-hidden) as skipped", async () => {
    const c = bulkCtx([{ id: "c1", status: "draft" }]);
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkLifecycle("release", ["c1", "ghost"]);
    expect(r).toEqual({ ok: true, done: 1, skipped: 1, failed: 0 });
  });

  it("counts RPC errors as failed, keeps going", async () => {
    const c = bulkCtx(
      [{ id: "c1", status: "draft" }, { id: "c2", status: "draft" }],
      { message: "boom" },
    );
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkLifecycle("release", ["c1", "c2"]);
    expect(r).toEqual({ ok: true, done: 0, skipped: 0, failed: 2 });
  });

  it("rejects more than 500 ids", async () => {
    (requireElder as any).mockResolvedValue(bulkCtx([]));
    const r = await bulkLifecycle("release", Array.from({ length: 501 }, (_, i) => `c${i}`));
    expect(r.ok).toBe(false);
  });
});

describe("bulkShareToSet", () => {
  it("shares only private ideas, passes the set id", async () => {
    const c = bulkCtx([
      { id: "c1", status: "private_idea" },
      { id: "c2", status: "draft" },      // already in a set — skipped
    ]);
    (requireElder as any).mockResolvedValue(c);
    const r = await bulkShareToSet("s1", ["c1", "c2"]);
    expect(r).toEqual({ ok: true, done: 1, skipped: 1, failed: 0 });
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_share_card_to_set", { p_card_id: "c1", p_set_id: "s1" },
    ]);
  });
});
