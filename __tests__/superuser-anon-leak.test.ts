import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load local env (Next convention); CI provides these as secrets.
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Opt-in: only runs under `npm run test:security` (same switch as the forge
// suite) so the default unit run stays hermetic (no network).
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON;

// Built per test, not once in the describe body: vitest still evaluates the
// body of a skipped `describe.runIf`, so constructing the client up there
// threw "supabaseUrl is required" and failed the whole default run in any
// checkout without a .env.local (a fresh clone or a git worktree).
const anonClient = () => createClient(URL!, ANON!);

describe.runIf(ENABLED)("Superuser portal anon-leak guardrail", () => {
  it("anon sees zero rows in admin_users", async () => {
    const { data, error } = await anonClient().from("admin_users").select("*").limit(1000);
    const rows = data ?? [];
    // A permission error (REVOKE) or an empty result (RLS) is fine; a leak is not.
    expect(
      rows.length,
      `anon leaked ${rows.length} row(s) from admin_users (error: ${error?.message ?? "none"})`
    ).toBe(0);
  });

  // No superuser-portal function is callable by anon. (Calling with placeholder
  // args is fine — anon lacks EXECUTE, so PostgREST rejects before the body runs.)
  const SUPER_RPCS: Array<[string, Record<string, unknown>]> = [
    ["is_superuser", {}],
    ["super_list_admins", {}],
    ["super_search_users", { p_query: "xx" }],
    ["super_set_admin_permissions", { p_user_id: "00000000-0000-0000-0000-000000000000", p_permissions: [] }],
    ["super_remove_admin", { p_user_id: "00000000-0000-0000-0000-000000000000" }],
  ];

  for (const [fn, args] of SUPER_RPCS) {
    it(`anon cannot execute ${fn}`, async () => {
      const { error } = await anonClient().rpc(fn, args);
      expect(error, `anon was able to execute ${fn} — a definer grant leaked`).not.toBeNull();
    });
  }

  // Catalog editor tables (migration 092): superuser-only via RLS + anon revoke.
  for (const table of ["card_overrides", "card_image_versions"] as const) {
    it(`anon sees zero rows in ${table}`, async () => {
      const { data, error } = await anonClient().from(table).select("*").limit(1000);
      const rows = data ?? [];
      expect(
        rows.length,
        `anon leaked ${rows.length} row(s) from ${table} (error: ${error?.message ?? "none"})`
      ).toBe(0);
    });

    it(`anon cannot write to ${table}`, async () => {
      const { error } = await anonClient()
        .from(table)
        .insert(
          table === "card_overrides"
            ? { card_name: "x", set_code: "x", fields: {}, note: "x", updated_by: "00000000-0000-0000-0000-000000000000" }
            : { img_file: "x", version: 1, updated_by: "00000000-0000-0000-0000-000000000000" }
        );
      expect(error, `anon was able to insert into ${table}`).not.toBeNull();
    });
  }
});
