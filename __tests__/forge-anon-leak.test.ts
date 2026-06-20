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
const FORGE_TABLES = ["playtest_members"];

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
});
