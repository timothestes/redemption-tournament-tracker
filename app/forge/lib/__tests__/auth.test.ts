import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/utils/supabase/server";
import { requireForge, requireElder, requireForgeSuperadmin } from "../auth";

function mockClient({ user, role }: { user: any; role: string | null }) {
  (createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: user ? null : new Error("no session"),
      })),
    },
    rpc: vi.fn(async (fn: string) =>
      fn === "my_forge_role" ? { data: role, error: null } : { data: null, error: null }
    ),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("requireForge", () => {
  it("returns null when not signed in", async () => {
    mockClient({ user: null, role: null });
    expect(await requireForge()).toBeNull();
  });
  it("returns null when signed in but not a member", async () => {
    mockClient({ user: { id: "u1" }, role: null });
    expect(await requireForge()).toBeNull();
  });
  it("returns ctx with role for a member", async () => {
    mockClient({ user: { id: "u1" }, role: "playtester" });
    const ctx = await requireForge();
    expect(ctx?.role).toBe("playtester");
    expect(ctx?.user.id).toBe("u1");
  });
});

describe("requireElder", () => {
  it("null for a playtester", async () => {
    mockClient({ user: { id: "u1" }, role: "playtester" });
    expect(await requireElder()).toBeNull();
  });
  it("ok for an elder", async () => {
    mockClient({ user: { id: "u1" }, role: "elder" });
    expect((await requireElder())?.role).toBe("elder");
  });
  it("ok for a superadmin", async () => {
    mockClient({ user: { id: "u1" }, role: "superadmin" });
    expect((await requireElder())?.role).toBe("superadmin");
  });
});

describe("requireForgeSuperadmin", () => {
  it("null for an elder", async () => {
    mockClient({ user: { id: "u1" }, role: "elder" });
    expect(await requireForgeSuperadmin()).toBeNull();
  });
  it("ok for a superadmin", async () => {
    mockClient({ user: { id: "u1" }, role: "superadmin" });
    expect((await requireForgeSuperadmin())?.role).toBe("superadmin");
  });
});
