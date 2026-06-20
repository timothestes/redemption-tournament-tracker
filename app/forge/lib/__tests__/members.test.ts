import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({
  requireElder: vi.fn(),
  requireForgeSuperadmin: vi.fn(),
  requireForge: vi.fn(),
}));
vi.mock("@/utils/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  wrapEmailInTemplate: (s: string) => s,
}));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));

import { requireElder, requireForgeSuperadmin } from "@/app/forge/lib/auth";
import { requireForge } from "@/app/forge/lib/auth";
import { sendEmail } from "@/utils/email";
import { createClient } from "@/utils/supabase/server";
import { mintInvite, redeemInvite, setProfile, changeRole, removeMember, addMember } from "../members";

function ctx(role: string, rpcImpl?: any) {
  return {
    role,
    user: { id: "caller", email: "c@x.com" },
    supabase: { rpc: vi.fn(rpcImpl ?? (async () => ({ data: "invite-id", error: null }))) },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("mintInvite", () => {
  it("rejects when caller is not an elder/superadmin", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await mintInvite({ role: "playtester" });
    expect(r.ok).toBe(false);
  });

  it("an elder cannot mint an elder invite (needs superadmin)", async () => {
    (requireElder as any).mockResolvedValue(ctx("elder"));
    (requireForgeSuperadmin as any).mockResolvedValue(null);
    const r = await mintInvite({ role: "elder" });
    expect(r.ok).toBe(false);
  });

  it("mints: hashes the token (raw never sent to RPC) and emails the URL", async () => {
    const c = ctx("superadmin");
    (requireElder as any).mockResolvedValue(c);
    (requireForgeSuperadmin as any).mockResolvedValue(c);
    const r = await mintInvite({ role: "elder", email: "new@x.com" });
    expect(r.ok).toBe(true);
    // RPC got a 64-hex hash, not a raw base64url token
    const passedHash = (c.supabase.rpc as any).mock.calls[0][1].p_token_hash;
    expect(passedHash).toMatch(/^[0-9a-f]{64}$/);
    // email sent, and the raw token in the URL is NOT the stored hash
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const html = (sendEmail as any).mock.calls[0][0].html as string;
    const url = (r as any).url as string;
    expect(html).toContain(url);
    expect(url).toContain("/invite/");
    expect(url).not.toContain(passedHash);
  });
});

describe("redeemInvite", () => {
  it("returns the role on success, hashes the token, and passes p_nda_agreed=true for 'I agree'", async () => {
    const rpc = vi.fn(async () => ({ data: "playtester", error: null }));
    (createClient as any).mockResolvedValue({ rpc });
    const r = await redeemInvite("raw-token-123", "  I Agree ");
    expect(r).toEqual({ ok: true, role: "playtester" });
    expect((rpc as any).mock.calls[0][1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((rpc as any).mock.calls[0][1].p_token_hash).not.toBe("raw-token-123");
    expect((rpc as any).mock.calls[0][1].p_nda_agreed).toBe(true);
  });
  it("passes p_nda_agreed=false when the text is not 'I agree'", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    (createClient as any).mockResolvedValue({ rpc });
    const r = await redeemInvite("raw-token-123", "nope");
    expect(r).toEqual({ ok: false });
    expect((rpc as any).mock.calls[0][1].p_nda_agreed).toBe(false);
  });
  it("returns {ok:false} when the RPC yields null (no oracle)", async () => {
    (createClient as any).mockResolvedValue({ rpc: vi.fn(async () => ({ data: null, error: null })) });
    expect(await redeemInvite("bad", "I agree")).toEqual({ ok: false });
  });
});

describe("changeRole / removeMember / addMember", () => {
  it("changeRole rejects non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await changeRole("u", "playtester")).ok).toBe(false);
  });
  it("changeRole calls forge_change_role for an elder", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    (requireElder as any).mockResolvedValue({ supabase: { rpc } });
    const r = await changeRole("u9", "playtester");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_change_role", { p_user_id: "u9", p_new_role: "playtester" });
  });
  it("removeMember surfaces an RPC error", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "not authorized to remove a elder member" } }));
    (requireElder as any).mockResolvedValue({ supabase: { rpc } });
    const r = await removeMember("u9");
    expect(r.ok).toBe(false);
  });
  it("addMember calls forge_add_member", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    (requireElder as any).mockResolvedValue({ supabase: { rpc } });
    const r = await addMember("u2", "playtester");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_add_member", { p_user_id: "u2", p_role: "playtester" });
  });
});

describe("setProfile", () => {
  it("rejects a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect((await setProfile({ displayName: "X" })).ok).toBe(false);
  });
  it("rejects an empty display name", async () => {
    (requireForge as any).mockResolvedValue({ supabase: { rpc: vi.fn() } });
    expect((await setProfile({ displayName: "   " })).ok).toBe(false);
  });
  it("calls forge_set_profile for a member", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    (requireForge as any).mockResolvedValue({ supabase: { rpc } });
    const r = await setProfile({ displayName: "Tim", avatarUrl: "https://x/y.png" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_set_profile", {
      p_display_name: "Tim",
      p_avatar_url: "https://x/y.png",
    });
  });
});
