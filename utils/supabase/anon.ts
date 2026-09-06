import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-free anon client for public reads that must stay cacheable (ISR
 * pages, unstable_cache, route handlers without a session). The standard
 * `utils/supabase/server` createClient reads cookies(), which opts a route
 * into per-request rendering and is forbidden inside unstable_cache. RLS still
 * applies: anon only sees what the policies expose.
 */
export function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase anon env vars missing");
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
