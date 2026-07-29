import { createClient } from "@supabase/supabase-js";
import { deleteTestUser } from "./deleteUser";

/**
 * Sweep any `@e2e.test` accounts still standing after the run.
 *
 * Per-test cleanup handles the normal path, but it cannot handle the abnormal
 * one: when a test exceeds its timeout Playwright tears the worker down and the
 * cleanup hook never runs. The spectator specs talk to a REMOTE SpacetimeDB, so
 * they time out on latency often enough for that to matter — and every timeout
 * used to leave two accounts behind permanently.
 *
 * That is how 300 orphaned users accumulated between May and July 2026, which
 * was not cosmetic: leftover `profiles` rows hold the usernames a later run
 * wants, and `spectator/lobby-lifecycle` started failing with
 * `duplicate key value violates unique constraint "profiles_username_key"`.
 *
 * Scoped strictly to the `.test` TLD, which is IANA-reserved and can never be a
 * real address, so this cannot touch a live account.
 */
export default async function globalTeardown(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !service) return;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.warn(`e2e teardown: could not list users: ${error.message}`);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users = (data as any).users as Array<{ id: string; email?: string }>;
  const leftovers = users.filter((u) => u.email?.endsWith("@e2e.test"));
  if (leftovers.length === 0) return;

  // Their tournaments cascade from auth.users; decks and profiles do not, which
  // deleteTestUser handles.
  let removed = 0;
  for (const u of leftovers) {
    if (await deleteTestUser(admin, u.id)) removed++;
  }
  console.log(
    `e2e teardown: swept ${removed}/${leftovers.length} leftover @e2e.test accounts`,
  );
}
