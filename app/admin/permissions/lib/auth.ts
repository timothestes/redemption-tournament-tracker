// Server-only: do not import from "use client" files.
import { createClient } from "@/utils/supabase/server";

type GateContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
};

/**
 * Gate for the superuser portal. Returns null unless the caller is THE app
 * superuser (hardcoded uid checked in SQL by public.is_superuser()).
 * Callers respond 404 (not 401/403) so the page stays invisible.
 */
export async function requireSuperuser(): Promise<GateContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: isSuper } = await supabase.rpc("is_superuser");
  if (isSuper !== true) return null;

  return { supabase, user };
}

/**
 * Gate for the catalog editor (/admin/catalog). Passes for the superuser or
 * any admin holding the manage_catalog permission (granted from the portal).
 * Same contract as requireSuperuser: callers respond 404, never 401/403.
 */
export async function requireCatalogEditor(): Promise<GateContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: isSuper } = await supabase.rpc("is_superuser");
  if (isSuper === true) return { supabase, user };

  const { data: perms } = await supabase.rpc("get_my_admin_permissions");
  if (Array.isArray(perms) && perms.includes("manage_catalog")) return { supabase, user };
  return null;
}
