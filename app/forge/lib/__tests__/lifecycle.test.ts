import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { shareToSet, publish, approve, deleteCard } from "../lifecycle";

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
  it("publish calls forge_publish_card", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await publish("c1");
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_publish_card", { p_card_id: "c1" }]);
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
