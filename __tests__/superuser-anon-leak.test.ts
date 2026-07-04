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

describe.runIf(ENABLED)("Superuser portal anon-leak guardrail", () => {
  const anon = createClient(URL!, ANON!);

  it("anon sees zero rows in admin_users", async () => {
    const { data, error } = await anon.from("admin_users").select("*").limit(1000);
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
      const { error } = await anon.rpc(fn, args);
      expect(error, `anon was able to execute ${fn} — a definer grant leaked`).not.toBeNull();
    });
  }
});
