// __tests__/poster-invites-leak.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { deleteTestUser } from "../e2e/deleteUser";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON && !!SERVICE;

type TestUser = { id: string; email: string; client: SupabaseClient };
const PASSWORD = "Testpass12345";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const createdUserIds: string[] = [];

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function makeUser(admin: SupabaseClient, permissions: string[]): Promise<TestUser> {
  const email = `poster-invite-${stamp}-${Math.random().toString(36).slice(2, 5)}@e2e.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  if (permissions.length > 0) {
    const { error: permErr } = await admin.from("admin_users").insert({ user_id: data.user.id, permissions });
    if (permErr) throw new Error(`admin_users insert failed: ${permErr.message}`);
  }
  const client = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`);
  return { id: data.user.id, email, client };
}

// Seeded directly with the service-role client (bypassing mint_poster_invite's
// is_superuser() gate), same as posts-anon-leak.test.ts seeds posts directly.
async function seedInvite(
  admin: SupabaseClient,
  invitedBy: string,
  opts: { email?: string | null; expiresAt?: string } = {}
): Promise<string> {
  const raw = `raw-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await admin.from("poster_invites").insert({
    token_hash: hashToken(raw),
    email: opts.email ?? null,
    invited_by: invitedBy,
    expires_at: opts.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
  });
  if (error) throw new Error(`seed invite failed: ${error.message}`);
  return raw;
}

describe.runIf(ENABLED)("poster invites RLS/RPC guardrail", () => {
  let admin: SupabaseClient;
  let poster: TestUser;
  let other: TestUser;
  let existingAdmin: TestUser;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    [poster, other, existingAdmin] = await Promise.all([
      makeUser(admin, []),
      makeUser(admin, []),
      makeUser(admin, ["manage_tags"]),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      await admin.from("admin_users").delete().eq("user_id", id);
      const gone = await deleteTestUser(admin, id);
      expect(gone, `test user ${id} leaked`).toBe(true);
    }
  }, 60_000);

  it("a non-superuser cannot mint an invite", async () => {
    const { data, error } = await poster.client.rpc("mint_poster_invite", {
      p_token_hash: hashToken("nope"),
      p_email: null,
      p_expires_at: null,
    });
    expect(data ?? null).toBeNull();
    expect(error).not.toBeNull();
  });

  it("a non-superuser sees no invites", async () => {
    const { data } = await poster.client.rpc("list_poster_invites");
    expect(data ?? []).toHaveLength(0);
  });

  it("redeeming with an email-bound invite as the wrong person fails and grants nothing", async () => {
    const raw = await seedInvite(admin, poster.id, { email: `nobody-${stamp}@e2e.test` });
    const { data } = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(false);
    const { data: row } = await admin.from("admin_users").select("permissions").eq("user_id", other.id).maybeSingle();
    expect(row).toBeNull();
  });

  it("the bound email can redeem, and gains publish_posts", async () => {
    const raw = await seedInvite(admin, poster.id, { email: poster.email });
    const { data } = await poster.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(true);
    const { data: row } = await admin.from("admin_users").select("permissions").eq("user_id", poster.id).single();
    expect(row?.permissions).toEqual(["publish_posts"]);
  });

  it("an already-used invite cannot be redeemed again", async () => {
    const raw = await seedInvite(admin, poster.id, { email: null });
    const first = await poster.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(first.data).toBe(true);
    const second = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(second.data).toBe(false);
  });

  it("an open (no email) invite can be redeemed by anyone signed in", async () => {
    const raw = await seedInvite(admin, poster.id, { email: null });
    const { data } = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(true);
    const { data: row } = await admin.from("admin_users").select("permissions").eq("user_id", other.id).single();
    expect(row?.permissions).toEqual(["publish_posts"]);
  });

  it("redeeming merges publish_posts without dropping an existing permission", async () => {
    const raw = await seedInvite(admin, poster.id, { email: null });
    const { data } = await existingAdmin.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(true);
    const { data: row } = await admin
      .from("admin_users")
      .select("permissions")
      .eq("user_id", existingAdmin.id)
      .single();
    expect(row?.permissions).toEqual(["manage_tags", "publish_posts"]);
  });

  it("an expired invite cannot be redeemed", async () => {
    const raw = await seedInvite(admin, poster.id, {
      email: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { data } = await other.client.rpc("redeem_poster_invite", { p_token_hash: hashToken(raw) });
    expect(data).toBe(false);
  });
});
