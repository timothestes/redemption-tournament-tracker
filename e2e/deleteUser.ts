import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Delete a seeded test user for real.
 *
 * `auth.admin.deleteUser` alone does NOT work on this project. Several public
 * tables reference `auth.users` with `ON DELETE NO ACTION`, so the delete fails
 * with a 500 ("Database error deleting user") and — because every call site
 * wrapped it in a try/catch or ignored the error — the account silently stayed.
 *
 * That leak reached 300 orphaned `@e2e.test` users before anyone noticed, and
 * it was not inert: leftover `profiles` rows hold the usernames a fresh seed
 * wants, which is what made `spectator/lobby-lifecycle` fail with
 * `duplicate key value violates unique constraint "profiles_username_key"`.
 *
 * The blocking children, confirmed against the live schema:
 *   profiles.id          NO ACTION   ← auto-created by the signup trigger
 *   decks.user_id        NO ACTION
 *   deck_folders.user_id NO ACTION
 * Everything else that matters (tournaments, playtest_members, forge_*,
 * collection_cards, api_keys) is ON DELETE CASCADE and needs no help.
 *
 * Returns true when the user is gone, false otherwise — callers should surface
 * a false rather than swallow it, or the leak simply comes back quietly.
 */
export async function deleteTestUser(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // Order matters: these block the auth.users delete.
  await admin.from("decks").delete().eq("user_id", userId);
  await admin.from("deck_folders").delete().eq("user_id", userId);
  await admin.from("profiles").delete().eq("id", userId);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`e2e cleanup: user ${userId} survived deletion: ${error.message}`);
    return false;
  }
  return true;
}

/** Same, addressed by email — for callers that never captured the id. */
export async function deleteTestUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<boolean> {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) {
    console.error(`e2e cleanup: could not list users: ${error.message}`);
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users = (data as any).users as Array<{ id: string; email?: string }>;
  const user = users.find((u) => u.email === email);
  if (!user) return true; // already gone
  return deleteTestUser(admin, user.id);
}
