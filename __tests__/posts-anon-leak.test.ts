import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deleteTestUser } from "../e2e/deleteUser";

// Load local env (Next convention); CI provides these as secrets.
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Opt-in: only under `npm run test:security`, so the default unit run stays
// hermetic. Clients are built per test/hook, never in the describe body
// (vitest evaluates a skipped describe.runIf body).
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON && !!SERVICE;

type TestUser = { id: string; email: string; client: SupabaseClient };
const PASSWORD = "Testpass12345";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// `Promise.all([makeUser(...), makeUser(...), makeUser(...)])` only assigns
// posterA/posterB/plain if all three resolve — if one throws AFTER its own
// createUser already succeeded (e.g. the admin_users insert or sign-in step
// fails), the destructuring never runs and afterAll has nothing to clean up.
// Every id lands here the instant createUser succeeds, independent of the
// rest of makeUser, so afterAll can always find and delete it.
const createdUserIds: string[] = [];

async function makeUser(admin: SupabaseClient, permissions: string[]): Promise<TestUser> {
  const email = `posts-${permissions.length ? "poster" : "plain"}-${stamp}-${Math.random().toString(36).slice(2, 5)}@e2e.test`;
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

describe.runIf(ENABLED)("posts RLS guardrail", () => {
  let admin: SupabaseClient;
  let posterA: TestUser;
  let posterB: TestUser;
  let plain: TestUser;
  let draftId = "";
  let publishedId = "";

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    [posterA, posterB, plain] = await Promise.all([
      makeUser(admin, ["publish_posts"]),
      makeUser(admin, ["publish_posts"]),
      makeUser(admin, []),
    ]);
    const { data: d, error: dErr } = await admin
      .from("posts")
      .insert({ title: "Leak draft", slug: `leak-draft-${stamp}`, author_id: posterA.id })
      .select("id")
      .single();
    if (dErr || !d) throw new Error(`seed draft failed: ${dErr?.message}`);
    draftId = d.id;
    const { data: p, error: pErr } = await admin
      .from("posts")
      .insert({
        title: "Leak published",
        slug: `leak-pub-${stamp}`,
        author_id: posterA.id,
        status: "published",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (pErr || !p) throw new Error(`seed published failed: ${pErr?.message}`);
    publishedId = p.id;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    // Iterate createdUserIds (not [posterA, posterB, plain]) so a partial
    // beforeAll failure still cleans up whichever accounts were created.
    for (const id of createdUserIds) {
      await admin.from("admin_users").delete().eq("user_id", id);
      const gone = await deleteTestUser(admin, id);
      expect(gone, `test user ${id} leaked`).toBe(true);
    }
  }, 60_000);

  it("anon sees the published post and not the draft", async () => {
    const anon = createClient(URL!, ANON!);
    const { data } = await anon.from("posts").select("id, status").in("id", [draftId, publishedId]);
    expect((data ?? []).map((r) => r.id)).toEqual([publishedId]);
  });

  it("another poster cannot see the draft", async () => {
    const { data } = await posterB.client.from("posts").select("id").eq("id", draftId);
    expect(data ?? []).toHaveLength(0);
  });

  it("the author sees their own draft", async () => {
    const { data } = await posterA.client.from("posts").select("id").eq("id", draftId);
    expect(data ?? []).toHaveLength(1);
  });

  it("a user without publish_posts cannot insert", async () => {
    const { error } = await plain.client
      .from("posts")
      .insert({ title: "Nope", slug: `leak-nope-${stamp}`, author_id: plain.id });
    expect(error?.code, "insert should be rejected by RLS (42501)").toBe("42501");
  });

  it("a poster cannot insert a post as someone else", async () => {
    const { error } = await posterB.client
      .from("posts")
      .insert({ title: "Spoof", slug: `leak-spoof-${stamp}`, author_id: posterA.id });
    expect(error?.code).toBe("42501");
  });

  it("a poster cannot update another poster's published post", async () => {
    const { data } = await posterB.client
      .from("posts")
      .update({ title: "Hijacked" })
      .eq("id", publishedId)
      .select("id");
    expect(data ?? []).toHaveLength(0); // RLS filters the row out silently
    const { data: check } = await admin.from("posts").select("title").eq("id", publishedId).single();
    expect(check?.title).toBe("Leak published");
  });

  it("the author can update their own post", async () => {
    const { data, error } = await posterA.client
      .from("posts")
      .update({ excerpt: "edited" })
      .eq("id", publishedId)
      .select("excerpt")
      .single();
    expect(error).toBeNull();
    expect(data?.excerpt).toBe("edited");
  });

  it("anon cannot write", async () => {
    const anon = createClient(URL!, ANON!);

    const { error } = await anon
      .from("posts")
      .insert({ title: "Anon draft", slug: `leak-anon-insert-${stamp}`, author_id: posterA.id });
    expect(error?.code, "anon insert should be rejected by RLS (42501)").toBe("42501");

    const { data: updated } = await anon.from("posts").update({ title: "Anon hijack" }).eq("id", publishedId).select("id");
    expect(updated ?? []).toHaveLength(0); // RLS filters the row out silently
    const { data: afterUpdate } = await admin.from("posts").select("title").eq("id", publishedId).single();
    expect(afterUpdate?.title).toBe("Leak published");

    const { data: deleted } = await anon.from("posts").delete().eq("id", publishedId).select("id");
    expect(deleted ?? []).toHaveLength(0);
    const { data: afterDelete } = await admin.from("posts").select("id").eq("id", publishedId).maybeSingle();
    expect(afterDelete).not.toBeNull();
  });

  it("a poster cannot delete another poster's post", async () => {
    const { data } = await posterB.client.from("posts").delete().eq("id", draftId).select("id");
    expect(data ?? []).toHaveLength(0);
    const { data: check } = await admin.from("posts").select("id").eq("id", draftId).maybeSingle();
    expect(check).not.toBeNull();
  });

  it("a poster can insert their own draft", async () => {
    const { data, error } = await posterA.client
      .from("posts")
      .insert({ title: "Poster's own draft", slug: `leak-own-draft-${stamp}`, author_id: posterA.id })
      .select("status")
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("draft");
    // Cleaned up by afterAll's deleteTestUser, which deletes all of
    // posterA's posts before deleting the profile.
  });
});
