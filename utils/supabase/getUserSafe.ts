import type { SupabaseClient, User } from "@supabase/supabase-js";

// Client-side getUser with zombie-session detection. If a local session exists
// (cookie parses) but the server rejects it — refresh token rotation race,
// reuse detection, network-interrupted refresh — force a local sign-out so
// the UI reflects real auth state instead of showing "logged in" with every
// server write silently failing.
export async function getUserSafe(
  supabase: SupabaseClient,
): Promise<User | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (session && error) {
    await supabase.auth.signOut({ scope: "local" });
    return null;
  }

  return user;
}
