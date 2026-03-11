/** Server-side Supabase client using service role key for price system writes */

import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adminClient: any = null;

/**
 * Returns a Supabase client with service role key for server-side writes.
 * Typed as `any` since we don't have generated types for the price tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseAdmin(): any {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  adminClient = createClient(url, serviceKey);
  return adminClient;
}
