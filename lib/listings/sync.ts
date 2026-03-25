import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { fetchTournamentPageText } from './fetch';
import { parseListingsWithLLM } from './parse';
import { ParsedListing, validateListing } from './schema';

export interface SyncResult {
  fetched: boolean;
  parsed: number;
  valid: number;
  invalid: number;
  inserted: number;
  updated: number;
  marked_removed: number;
  flagged_for_review: number;
  errors: string[];
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Full sync pipeline:
 * 1. Fetch page text from Cactus
 * 2. Parse with LLM
 * 3. Validate each listing
 * 4. Diff against DB (upsert new/changed, mark removed)
 */
export async function syncTournamentListings(): Promise<SyncResult> {
  const result: SyncResult = {
    fetched: false,
    parsed: 0,
    valid: 0,
    invalid: 0,
    inserted: 0,
    updated: 0,
    marked_removed: 0,
    flagged_for_review: 0,
    errors: [],
  };

  // 1. Fetch
  const pageText = await fetchTournamentPageText();
  result.fetched = true;
  console.log(`[sync-listings] Fetched page text (${pageText.length} chars)`);

  // 2. Parse with LLM
  const rawListings = await parseListingsWithLLM(pageText);
  result.parsed = rawListings.length;
  console.log(`[sync-listings] LLM returned ${rawListings.length} listings`);

  // 3. Validate
  const validListings: ParsedListing[] = [];
  for (const listing of rawListings) {
    const errors = validateListing(listing);
    if (errors.length > 0) {
      result.invalid++;
      result.errors.push(`Invalid listing "${listing.title}": ${errors.join(', ')}`);
      console.warn(`[sync-listings] Skipping invalid listing:`, errors);
    } else {
      validListings.push(listing);
      result.valid++;
    }
  }

  if (validListings.length === 0) {
    result.errors.push('No valid listings parsed — aborting DB write');
    console.error('[sync-listings] No valid listings, aborting');
    return result;
  }

  // 4. Diff and upsert
  const supabase = getSupabaseAdmin();

  // Get ALL existing listings (any status) to avoid unique constraint violations
  // when a previously removed/past listing reappears on the source page
  const { data: existing } = await supabase
    .from('tournament_listings')
    .select('id, city, state, start_date, tournament_type, source_hash, status');

  const existingMap = new Map<string, { id: string; source_hash: string; status: string }>();
  for (const row of existing || []) {
    const key = `${row.city.toLowerCase()}|${row.state.toLowerCase()}|${row.start_date}|${(row.tournament_type || '').toLowerCase()}`;
    existingMap.set(key, { id: row.id, source_hash: row.source_hash, status: row.status });
  }

  // Track which existing listings we saw in this sync (for removal detection)
  const seenKeys = new Set<string>();

  for (const listing of validListings) {
    const key = `${listing.city.toLowerCase()}|${listing.state.toLowerCase()}|${listing.start_date}|${(listing.tournament_type || '').toLowerCase()}`;
    seenKeys.add(key);

    const rawText = JSON.stringify(listing);
    const sourceHash = hashText(rawText);
    const needsReview = listing.confidence < 0.8;

    if (needsReview) result.flagged_for_review++;

    const row = {
      title: listing.title,
      tournament_type: listing.tournament_type,
      start_date: listing.start_date,
      end_date: listing.end_date,
      start_time: listing.start_time,
      city: listing.city,
      state: listing.state,
      venue_name: listing.venue_name,
      venue_address: listing.venue_address,
      host_name: listing.host_name,
      host_email: listing.host_email,
      formats: listing.formats,
      door_fee: listing.door_fee,
      description: listing.description,
      raw_text: rawText,
      source_hash: sourceHash,
      parsed_at: new Date().toISOString(),
      confidence: listing.confidence,
      needs_review: needsReview,
      status: 'upcoming',
      updated_at: new Date().toISOString(),
    };

    const existingEntry = existingMap.get(key);

    if (!existingEntry) {
      // New listing
      const { error } = await supabase.from('tournament_listings').insert(row);
      if (error) {
        result.errors.push(`Insert failed for "${listing.title}": ${error.message}`);
        console.error('[sync-listings] Insert error:', error.message);
      } else {
        result.inserted++;
      }
    } else if (existingEntry.source_hash !== sourceHash || existingEntry.status !== 'upcoming') {
      // Existing listing changed, or was removed/past and reappeared — update & resurrect
      const { error } = await supabase
        .from('tournament_listings')
        .update(row)
        .eq('id', existingEntry.id);
      if (error) {
        result.errors.push(`Update failed for "${listing.title}": ${error.message}`);
        console.error('[sync-listings] Update error:', error.message);
      } else {
        result.updated++;
      }
    }
    // else: unchanged and still upcoming, skip
  }

  // 5. Mark listings no longer on the page as 'removed'
  // Only for upcoming listings — don't touch past/cancelled/already-removed ones
  for (const [key, entry] of existingMap) {
    if (!seenKeys.has(key) && entry.status === 'upcoming') {
      const { error } = await supabase
        .from('tournament_listings')
        .update({ status: 'removed', updated_at: new Date().toISOString() })
        .eq('id', entry.id);
      if (error) {
        result.errors.push(`Failed to mark removed: ${entry.id}`);
      } else {
        result.marked_removed++;
      }
    }
  }

  console.log('[sync-listings] Sync complete:', result);
  return result;
}
