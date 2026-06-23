import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load local env (Next convention); CI provides these as secrets.
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Opt-in: only runs under `npm run test:security` so the default unit run stays
// hermetic (no network). Requires the Supabase env to be present.
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON;

// Every table that holds Forge secret data. EXTEND THIS as new Forge tables are
// added in later plans. The anon (public) role must see ZERO rows in each.
const FORGE_TABLES = ["playtest_members", "forge_invites", "forge_audit", "forge_cards"];

describe.runIf(ENABLED)("Forge anon-leak guardrail", () => {
  const anon = createClient(URL!, ANON!);

  for (const table of FORGE_TABLES) {
    it(`anon sees zero rows in ${table}`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1000);
      const rows = data ?? [];
      // A permission error (REVOKE) or an empty result (RLS) is fine; a leak is not.
      expect(
        rows.length,
        `anon leaked ${rows.length} row(s) from ${table} (error: ${error?.message ?? "none"})`
      ).toBe(0);
    });
  }

  // Spec leak-test step 3: no Forge SECURITY DEFINER function is callable by anon.
  // (Calling with empty/placeholder args is fine — anon lacks EXECUTE, so PostgREST
  // rejects before the body runs. A success here means a grant leaked.)
  const FORGE_RPCS: Array<[string, Record<string, unknown>]> = [
    ["my_forge_role", {}],
    ["forge_role_of", { uid: "00000000-0000-0000-0000-000000000000" }],
    ["is_forge_member", {}],
    ["is_forge_elder_or_super", {}],
    ["forge_role_outranks", { actor_role: "elder", target_role: "playtester" }],
    ["forge_mint_invite", { p_token_hash: "x", p_role: "playtester", p_set_ids: [], p_email: null, p_expires_at: null }],
    ["forge_redeem_invite", { p_token_hash: "x", p_nda_agreed: false }],
    ["forge_add_member", { p_user_id: "00000000-0000-0000-0000-000000000000", p_role: "playtester" }],
    ["forge_remove_member", { p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_change_role", { p_user_id: "00000000-0000-0000-0000-000000000000", p_new_role: "playtester" }],
    ["forge_set_profile", { p_display_name: "x", p_avatar_url: null }],
    ["forge_list_invites", {}],
    ["forge_create_card", { p_title: "x" }],
    ["forge_set_working_art", { p_card_id: "00000000-0000-0000-0000-000000000000", p_key: "x", p_original_key: "x" }],
    ["forge_set_art_placeholder", { p_card_id: "00000000-0000-0000-0000-000000000000", p_is_placeholder: true }],
    ["forge_log_art_download", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
  ];

  for (const [fn, args] of FORGE_RPCS) {
    it(`anon cannot execute ${fn}`, async () => {
      const { error } = await anon.rpc(fn, args);
      expect(error, `anon was able to execute ${fn} — a definer grant leaked`).not.toBeNull();
    });
  }
});
