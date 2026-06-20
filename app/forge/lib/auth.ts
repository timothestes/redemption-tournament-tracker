import { createClient } from "@/utils/supabase/server";

export type ForgeRole = "superadmin" | "elder" | "playtester";

type ForgeContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
  role: ForgeRole;
};

/**
 * Gate for everything under /forge. Returns the Supabase client, user, and the
 * caller's Forge role, or null when the caller is not a Forge member.
 * Callers respond 404 (not 401/403) so the area stays secret.
 */
export async function requireForge(): Promise<ForgeContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: role } = await supabase.rpc("my_forge_role");
  if (role !== "superadmin" && role !== "elder" && role !== "playtester") return null;

  return { supabase, user, role: role as ForgeRole };
}

export async function requireElder(): Promise<ForgeContext | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  return ctx.role === "elder" || ctx.role === "superadmin" ? ctx : null;
}

export async function requireForgeSuperadmin(): Promise<ForgeContext | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  return ctx.role === "superadmin" ? ctx : null;
}

export function notFoundResponse() {
  return new Response("Not Found", { status: 404 });
}
