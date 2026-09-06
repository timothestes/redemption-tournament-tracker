// Server-only: do not import from "use client" files.
import { createClient } from "@/utils/supabase/server";

export type PosterContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
  isSuperuser: boolean;
};

/**
 * Null unless the caller holds `publish_posts` or is THE superuser
 * (public.is_superuser()). Pages answer 404 on null so the surface stays
 * invisible, matching app/admin/permissions/lib/auth.ts.
 */
export async function getPosterContext(): Promise<PosterContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const [{ data: isSuper }, { data: perms }] = await Promise.all([
    supabase.rpc("is_superuser"),
    supabase.rpc("get_my_admin_permissions"),
  ]);
  const isSuperuser = isSuper === true;
  const hasKey = Array.isArray(perms) && perms.includes("publish_posts");
  if (!isSuperuser && !hasKey) return null;
  return { supabase, user, isSuperuser };
}

export async function requirePoster(): Promise<PosterContext> {
  const ctx = await getPosterContext();
  if (!ctx) throw new Error("Unauthorized: publish_posts permission required");
  return ctx;
}
