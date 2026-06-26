import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { createSet, saveSetNotes, listSets, grantSet, revokeSet } from "../sets";

function ctx(opts: { rpc?: any; rows?: any[] } = {}) {
  const order = vi.fn(async () => ({ data: opts.rows ?? [], error: null }));
  const eq = vi.fn(() => ({ order, eq, maybeSingle: vi.fn(async () => ({ data: (opts.rows ?? [])[0] ?? null, error: null })) }));
  const select = vi.fn(() => ({ eq, order }));
  return {
    role: "elder",
    user: { id: "u1", email: "e@x" },
    supabase: {
      rpc: vi.fn(opts.rpc ?? (async () => ({ data: "set-1", error: null }))),
      from: vi.fn(() => ({ select })),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("createSet", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await createSet("Genesis")).ok).toBe(false);
  });
  it("calls forge_create_set and returns the new id", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await createSet("Genesis");
    expect(r).toEqual({ ok: true, id: "set-1" });
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_create_set", { p_name: "Genesis" }]);
  });
});

describe("saveSetNotes", () => {
  it("calls forge_save_set_notes and returns updatedAt", async () => {
    const c = ctx({ rpc: async () => ({ data: "2026-06-24T00:00:00Z", error: null }) });
    (requireElder as any).mockResolvedValue(c);
    const r = await saveSetNotes("set-1", "# themes");
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_save_set_notes", { p_set_id: "set-1", p_notes: "# themes" }]);
  });
});

describe("listSets", () => {
  it("returns [] when not a member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await listSets()).toEqual([]);
  });
});

describe("grantSet / revokeSet", () => {
  it("grantSet rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await grantSet("s1", "u1")).ok).toBe(false);
  });

  it("grantSet calls forge_grant_set and returns ok", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: null }) });
    (requireElder as any).mockResolvedValue(c);
    expect((await grantSet("s1", "u1")).ok).toBe(true);
    expect(c.supabase.rpc).toHaveBeenCalledWith("forge_grant_set", { p_set_id: "s1", p_user_id: "u1" });
  });

  it("revokeSet surfaces an RPC error", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: { message: "boom" } }) });
    (requireElder as any).mockResolvedValue(c);
    expect((await revokeSet("s1", "u1")).ok).toBe(false);
  });
});
