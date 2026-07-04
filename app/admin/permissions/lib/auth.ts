// Server-only: do not import from "use client" files.
import { createClient } from "@/utils/supabase/server";

type SuperuserContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
};

/**
 * Gate for the superuser portal. Returns null unless the caller is THE app
 * superuser (hardcoded uid checked in SQL by public.is_superuser()).
 * Callers respond 404 (not 401/403) so the page stays invisible.
 */
export async function requireSuperuser(): Promise<SuperuserContext | null> {
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
