import { createClient } from "@/utils/supabase/server";

/**
 * Gate for everything under /threshingfloor. Returns the Supabase client and
 * user when the caller has the `threshing_floor` admin permission, else null.
 * Callers respond 404 (not 401/403) so the route stays secret.
 */
export async function requireThreshingFloor() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: isAdmin } = await supabase.rpc("check_admin_role");
  if (!isAdmin) return null;

  const { data: perms } = await supabase.rpc("get_my_admin_permissions");
  if (!Array.isArray(perms) || !perms.includes("threshing_floor")) return null;

  return { supabase, user };
}

export function notFoundResponse() {
  return new Response("Not Found", { status: 404 });
}
