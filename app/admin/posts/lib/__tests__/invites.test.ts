import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/admin/permissions/lib/auth", () => ({ requireSuperuser: vi.fn() }));
vi.mock("@/utils/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  wrapEmailInTemplate: (s: string) => s,
}));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));

import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { sendEmail } from "@/utils/email";
import { createClient } from "@/utils/supabase/server";
import { mintPosterInvite, listPosterInvites, redeemPosterInvite } from "../invites";

function ctx(rpcImpl?: (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>) {
  return {
    user: { id: "caller", email: "c@x.com" },
    supabase: { rpc: vi.fn(rpcImpl ?? (async () => ({ data: null, error: null }))) },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("mintPosterInvite", () => {
  it("rejects when the caller is not the superuser", async () => {
    (requireSuperuser as any).mockResolvedValue(null);
    const r = await mintPosterInvite("x@y.com");
    expect(r.ok).toBe(false);
  });

  it("mints: hashes the token (raw never sent to RPC) and emails the URL", async () => {
    const c = ctx();
    (requireSuperuser as any).mockResolvedValue(c);
    const r = await mintPosterInvite("new@x.com");
    expect(r.ok).toBe(true);
    const passedHash = (c.supabase.rpc as any).mock.calls[0][1].p_token_hash;
    expect(passedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const html = (sendEmail as any).mock.calls[0][0].html as string;
    const url = (r as { url: string }).url;
    expect(html).toContain(url);
    expect(url).toContain("/invite/poster/");
    expect(url).not.toContain(passedHash);
  });

  it("does not email when no address is given, but still returns a copyable link", async () => {
    const c = ctx();
    (requireSuperuser as any).mockResolvedValue(c);
    const r = await mintPosterInvite(null);
    expect(r.ok).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((r as { url: string }).url).toContain("/invite/poster/");
  });
});

describe("listPosterInvites", () => {
  it("returns [] when the caller is not the superuser", async () => {
    (requireSuperuser as any).mockResolvedValue(null);
    expect(await listPosterInvites()).toEqual([]);
  });

  it("returns the RPC rows for the superuser", async () => {
    const rows = [{ id: "1", email: null, invited_by: "u", expires_at: "t", used_at: null, created_at: "t" }];
    (requireSuperuser as any).mockResolvedValue(ctx(async () => ({ data: rows, error: null })));
    expect(await listPosterInvites()).toEqual(rows);
  });
});

describe("redeemPosterInvite", () => {
  it("hashes the token and returns ok:true on success", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    (createClient as any).mockResolvedValue({ rpc });
    const r = await redeemPosterInvite("raw-token-123");
    expect(r).toEqual({ ok: true });
    expect((rpc as any).mock.calls[0][1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((rpc as any).mock.calls[0][1].p_token_hash).not.toBe("raw-token-123");
  });

  it("returns ok:false when the RPC yields false (no oracle)", async () => {
    (createClient as any).mockResolvedValue({ rpc: vi.fn(async () => ({ data: false, error: null })) });
    expect(await redeemPosterInvite("bad")).toEqual({ ok: false });
  });

  it("returns ok:false on an RPC error", async () => {
    (createClient as any).mockResolvedValue({ rpc: vi.fn(async () => ({ data: null, error: { message: "x" } })) });
    expect(await redeemPosterInvite("bad")).toEqual({ ok: false });
  });
});
