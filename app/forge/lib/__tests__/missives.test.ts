import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({
  requireElder: vi.fn(),
}));
vi.mock("@/utils/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { sendEmail } from "@/utils/email";
import { revalidatePath } from "next/cache";
import {
  getMissiveDirectory,
  sendMissive,
  sendMissiveTest,
  listRecentMissives,
} from "../missives";

const DIRECTORY_ROWS = [
  { user_id: "caller", display_name: "Smith", role: "elder", email: "c@x.com", set_ids: [] },
  { user_id: "p1", display_name: "Alice", role: "playtester", email: "alice@x.com", set_ids: [] },
  { user_id: "p2", display_name: "Bob", role: "playtester", email: "bob@x.com", set_ids: [] },
];

function ctx(rpcImpl?: any, fromImpl?: any) {
  return {
    role: "elder",
    user: { id: "caller", email: "c@x.com" },
    supabase: {
      rpc: vi.fn(
        rpcImpl ??
          (async (name: string) => {
            if (name === "forge_member_directory") return { data: DIRECTORY_ROWS, error: null };
            if (name === "forge_log_missive") return { data: "missive-id", error: null };
            return { data: null, error: null };
          })
      ),
      from: vi.fn(
        fromImpl ??
          (() => ({
            select: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          }))
      ),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("getMissiveDirectory", () => {
  it("returns empty for a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await getMissiveDirectory();
    expect(r).toEqual({ members: [], sets: [] });
  });

  it("maps directory rows to camelCase and fetches sets", async () => {
    const c = ctx(undefined, () => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => ({
          data: [{ id: "s1", name: "Set One" }],
          error: null,
        })),
      })),
    }));
    (requireElder as any).mockResolvedValue(c);
    const r = await getMissiveDirectory();
    expect(r.members).toEqual([
      { userId: "caller", displayName: "Smith", role: "elder", email: "c@x.com", setIds: [] },
      { userId: "p1", displayName: "Alice", role: "playtester", email: "alice@x.com", setIds: [] },
      { userId: "p2", displayName: "Bob", role: "playtester", email: "bob@x.com", setIds: [] },
    ]);
    expect(r.sets).toEqual([{ id: "s1", name: "Set One" }]);
  });
});

describe("sendMissive", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await sendMissive({ subject: "Hi", body: "Body", recipientIds: ["p1"] });
    expect(r).toEqual({ ok: false, sent: 0, failed: 0, error: "Not authorized" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an empty subject", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    const r = await sendMissive({ subject: "   ", body: "Body", recipientIds: ["p1"] });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a subject over 150 chars", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    const r = await sendMissive({ subject: "a".repeat(151), body: "Body", recipientIds: ["p1"] });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an empty body", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    const r = await sendMissive({ subject: "Hi", body: "   ", recipientIds: ["p1"] });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a body over 20000 chars", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    const r = await sendMissive({ subject: "Hi", body: "a".repeat(20001), recipientIds: ["p1"] });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects 0 recipients", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    const r = await sendMissive({ subject: "Hi", body: "Body", recipientIds: [] });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects more than 100 recipients", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    const ids = Array.from({ length: 101 }, (_, i) => `p${i}`);
    const r = await sendMissive({ subject: "Hi", body: "Body", recipientIds: ids });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks the sender when they have no display name", async () => {
    const c = ctx(async (name: string) => {
      if (name === "forge_member_directory") {
        return {
          data: [
            { user_id: "caller", display_name: null, role: "elder", email: "c@x.com", set_ids: [] },
            { user_id: "p1", display_name: "Alice", role: "playtester", email: "alice@x.com", set_ids: [] },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    (requireElder as any).mockResolvedValue(c);
    const r = await sendMissive({ subject: "Hi", body: "Body", recipientIds: ["p1"] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Set your Forge display name before sending an announcement.");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("drops unknown recipientIds and only emails directory addresses", async () => {
    vi.useFakeTimers();
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const promise = sendMissive({
      subject: "Hi",
      body: "Body",
      recipientIds: ["p1", "unknown-id"],
    });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await promise;
    vi.useRealTimers();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail as any).mock.calls[0][0].to).toBe("alice@x.com");
    expect(r.ok).toBe(true);
    expect(c.supabase.rpc).toHaveBeenCalledWith(
      "forge_log_missive",
      expect.objectContaining({ p_recipient_ids: ["p1"] })
    );
  });

  it("happy path: 2 recipients get personalized, prefixed, reply-to'd emails and the send is logged", async () => {
    expect(process.env.FORGE_FROM_EMAIL).toBeUndefined();
    vi.useFakeTimers();
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const promise = sendMissive({
      subject: "Update",
      body: "Hello {name}",
      recipientIds: ["p1", "p2"],
    });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await promise;
    vi.useRealTimers();

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const call1 = (sendEmail as any).mock.calls[0][0];
    const call2 = (sendEmail as any).mock.calls[1][0];
    expect(call1.subject).toBe("[Forge] Update");
    expect(call2.subject).toBe("[Forge] Update");
    expect(call1.to).toBe("alice@x.com");
    expect(call2.to).toBe("bob@x.com");
    expect(call1.html).toContain("Alice");
    expect(call2.html).toContain("Bob");
    expect(call1.replyTo).toBe("c@x.com");
    expect(call2.replyTo).toBe("c@x.com");
    expect(call1.from).toBe("The Forge <noreply@landofredemption.com>");
    expect(call2.from).toBe("The Forge <noreply@landofredemption.com>");

    expect(c.supabase.rpc).toHaveBeenCalledWith("forge_log_missive", {
      p_subject: "Update",
      p_body_text: "Hello {name}",
      p_recipient_ids: ["p1", "p2"],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/forge/announcements");
    expect(r).toEqual({ ok: true, sent: 2, failed: 0, error: undefined });
  });

  it("counts a failed send, still logs, and returns ok:false", async () => {
    vi.useFakeTimers();
    (sendEmail as any)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "boom" });
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const promise = sendMissive({
      subject: "Update",
      body: "Hello {name}",
      recipientIds: ["p1", "p2"],
    });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await promise;
    vi.useRealTimers();

    expect(r.ok).toBe(false);
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
    expect(c.supabase.rpc).toHaveBeenCalledWith(
      "forge_log_missive",
      expect.objectContaining({ p_recipient_ids: ["p1", "p2"] })
    );
  });

  it("returns a directory error when the directory RPC fails, without sending anything", async () => {
    const c = ctx(async (name: string) => {
      if (name === "forge_member_directory") {
        return { data: null, error: { message: "db down" } };
      }
      return { data: null, error: null };
    });
    (requireElder as any).mockResolvedValue(c);
    const r = await sendMissive({ subject: "Hi", body: "Body", recipientIds: ["p1"] });
    expect(r).toEqual({
      ok: false,
      sent: 0,
      failed: 0,
      error: "Could not load the member directory.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns an unconfigured-email error and does not log when every send fails", async () => {
    vi.useFakeTimers();
    (sendEmail as any)
      .mockResolvedValueOnce({ success: false, error: "Email service not configured" })
      .mockResolvedValueOnce({ success: false, error: "Email service not configured" });
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const promise = sendMissive({
      subject: "Update",
      body: "Hello {name}",
      recipientIds: ["p1", "p2"],
    });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await promise;
    vi.useRealTimers();

    expect(r).toEqual({
      ok: false,
      sent: 0,
      failed: 2,
      error: "No emails were sent — email service may be unconfigured.",
    });
    expect(c.supabase.rpc).not.toHaveBeenCalledWith("forge_log_missive", expect.anything());
  });
});

describe("sendMissiveTest", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await sendMissiveTest({ subject: "Hi", body: "Body" });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks the sender when they have no display name", async () => {
    const c = ctx(async (name: string) => {
      if (name === "forge_member_directory") {
        return {
          data: [{ user_id: "caller", display_name: null, role: "elder", email: "c@x.com", set_ids: [] }],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    (requireElder as any).mockResolvedValue(c);
    const r = await sendMissiveTest({ subject: "Hi", body: "Body" });
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends exactly one email to the caller with the TEST prefix and does not log", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await sendMissiveTest({ subject: "Update", body: "Hello {name}" });

    expect(r.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = (sendEmail as any).mock.calls[0][0];
    expect(call.to).toBe("c@x.com");
    expect(call.subject).toBe("[TEST] [Forge] Update");
    expect(call.replyTo).toBe("c@x.com");
    expect(call.html).toContain("Smith");

    expect(c.supabase.rpc).not.toHaveBeenCalledWith("forge_log_missive", expect.anything());
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("listRecentMissives", () => {
  it("returns empty for a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect(await listRecentMissives()).toEqual([]);
  });

  it("maps rows to camelCase", async () => {
    const c = ctx(undefined, () => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(async () => ({
            data: [
              {
                id: "m1",
                sender: "caller",
                subject: "Hi",
                recipient_count: 3,
                sent_at: "2026-01-01T00:00:00Z",
              },
            ],
            error: null,
          })),
        })),
      })),
    }));
    (requireElder as any).mockResolvedValue(c);
    const r = await listRecentMissives();
    expect(r).toEqual([
      { id: "m1", sender: "caller", subject: "Hi", recipientCount: 3, sentAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});
