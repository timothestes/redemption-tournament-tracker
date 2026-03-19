/**
 * Discord ruling channel sync.
 * Fetches messages from a readonly Discord channel and stages them
 * in discord_ruling_messages for admin review.
 */

import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const BATCH_SIZE = 100; // Discord max per request
const SYNC_DAYS = 3; // Only fetch messages from the last N days

/** Convert a Date to a Discord snowflake ID (for use as `after` cursor) */
function dateToSnowflake(date: Date): string {
  // Discord epoch: 2015-01-01T00:00:00.000Z = 1420070400000
  const discordEpoch = 1420070400000;
  const timestamp = date.getTime() - discordEpoch;
  // Snowflake = (timestamp << 22) — use multiply since BigInt literals need ES2020+
  return String(timestamp * 4194304);
}

interface DiscordMessage {
  id: string;
  author: {
    id: string;
    username: string;
  };
  content: string;
  timestamp: string;
  type: number; // 0 = default, 19 = reply
  referenced_message?: DiscordMessage | null;
}

export interface SyncResult {
  fetched: number;
  newMessages: number;
  skipped: number;
  errors: string[];
}

/**
 * Fetch one page of messages from Discord.
 */
async function fetchDiscordPage(
  channelId: string,
  token: string,
  direction: 'after' | 'before',
  cursor?: string
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: String(BATCH_SIZE) });
  if (cursor) params.set(direction, cursor);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(
      `${DISCORD_API_BASE}/channels/${channelId}/messages?${params}`,
      { headers: { Authorization: `Bot ${token}` } }
    );

    if (res.status === 429) {
      const body = await res.json();
      const retryAfter = (body.retry_after || 1) * 1000;
      await new Promise((r) => setTimeout(r, retryAfter + 100));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord API error ${res.status}: ${text}`);
    }

    return await res.json();
  }
}


/**
 * Filter and convert Discord messages to DB rows.
 */
function messagesToRows(messages: DiscordMessage[]) {
  return messages
    .filter((m) => (m.type === 0 || m.type === 19) && m.content.trim().length > 0)
    .map((m) => ({
      discord_message_id: m.id,
      author_name: m.author.username,
      content: m.content,
      message_date: m.timestamp,
      status: 'pending' as const,
      suggested_card_name: null,
    }));
}

/**
 * Upsert a batch of rows into the staging table.
 */
async function upsertBatch(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: ReturnType<typeof messagesToRows>,
  result: SyncResult
) {
  if (rows.length === 0) return;

  const { data: inserted, error } = await supabase
    .from('discord_ruling_messages')
    .upsert(rows, { onConflict: 'discord_message_id', ignoreDuplicates: true })
    .select('id');

  if (error) {
    result.errors.push(error.message);
  } else {
    result.newMessages += inserted?.length || 0;
    result.skipped += rows.length - (inserted?.length || 0);
  }
}

/**
 * Main sync function: fetches new messages from Discord and inserts
 * them into the staging table for admin review.
 *
 * Forward sync (newer messages) collects all then inserts.
 * Backfill (older messages) inserts each page incrementally to avoid memory pressure.
 */
export async function syncDiscordRulings(): Promise<SyncResult> {
  const token = process.env.DISCORD_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID || process.env.CHANNEL_ID;

  if (!token || !channelId) {
    throw new Error('Missing DISCORD_TOKEN or DISCORD_CHANNEL_ID env vars');
  }

  const supabase = getSupabaseAdmin();
  const result: SyncResult = { fetched: 0, newMessages: 0, skipped: 0, errors: [] };

  // Use a cutoff: only fetch messages from the last SYNC_DAYS days.
  // On the first run this backfills 30 days; on subsequent runs it picks up
  // anything new since the last sync. Much faster than paging the full history.
  const cutoffDate = new Date(Date.now() - SYNC_DAYS * 24 * 60 * 60 * 1000);
  const cutoffSnowflake = dateToSnowflake(cutoffDate);

  // Find the newest discord_message_id we've already stored
  const { data: latest } = await supabase
    .from('discord_ruling_messages')
    .select('discord_message_id')
    .order('message_date', { ascending: false })
    .limit(1)
    .single();

  // Start from whichever is more recent: the last synced message or the cutoff
  const afterId = latest?.discord_message_id
    ? (BigInt(latest.discord_message_id) > BigInt(cutoffSnowflake)
        ? latest.discord_message_id
        : cutoffSnowflake)
    : cutoffSnowflake;

  let cursor: string | undefined = afterId;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await fetchDiscordPage(channelId, token, 'after', cursor);
    if (page.length === 0) break;

    result.fetched += page.length;
    await upsertBatch(supabase, messagesToRows(page), result);

    if (page.length < BATCH_SIZE) break;
    cursor = page.reduce((max, m) =>
      BigInt(m.id) > BigInt(max) ? m.id : max, page[0].id
    );
  }

  return result;
}
