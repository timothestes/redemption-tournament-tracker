// Client-side Forge Realtime helpers. Imported only by client components.
// Topic builders are the SINGLE SOURCE OF TRUTH for the topic format and must
// match supabase/migrations/054 byte-for-byte (no sub-suffixes: the realtime.messages
// RLS predicate parses split_part(topic, ':', 3)::uuid).
import type { SupabaseClient } from "@supabase/supabase-js";

export const forgeCardTopic = (cardId: string) => `forge:card:${cardId}`;
export const forgeSetTopic = (setId: string) => `forge:set:${setId}`;

// Private channels require the member JWT on the socket before join.
export async function ensureRealtimeAuth(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await supabase.realtime.setAuth(token);
}
