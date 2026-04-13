import { createClient } from "@/utils/supabase/server";

type SameCardEntry = { groupId: number; canonicalName: string };

let cachedGroups: Map<string, SameCardEntry> | null = null;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

async function fetchGroupsFromSupabase(): Promise<any[]> {
  const supabase = await createClient();

  const PAGE = 1000;
  const allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("duplicate_card_group_members")
      .select("group_id, card_name, duplicate_card_groups(id, canonical_name)")
      .range(offset, offset + PAGE - 1)
      .abortSignal(AbortSignal.timeout(10_000));

    if (error) {
      throw new Error(`Failed to fetch duplicate card groups: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return allData;
}

/**
 * Fetches all duplicate card group members joined with their groups and returns
 * a Map keyed by lowercase card name to { groupId, canonicalName }.
 *
 * The result is cached at module level so repeated calls don't re-query.
 * Retries on transient network failures. Returns an empty map if all retries
 * fail so the deckcheck can still run (just without same-card validation).
 */
export async function getSameCardGroups(): Promise<
  Map<string, SameCardEntry>
> {
  if (cachedGroups) {
    return cachedGroups;
  }

  let allData: any[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      allData = await fetchGroupsFromSupabase();
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error("Failed to fetch duplicate card groups after retries:", err);
        return new Map();
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  const map = new Map<string, SameCardEntry>();

  for (const row of allData) {
    const group = row.duplicate_card_groups as unknown as {
      id: number;
      canonical_name: string;
    } | null;

    if (!group) continue;

    const entry = {
      groupId: group.id,
      canonicalName: group.canonical_name,
    };

    const name = row.card_name.toLowerCase();
    map.set(name, entry);

    // Also index a normalized variant (strip commas, extra spaces)
    // so "David the Psalmist" matches "David, the Psalmist"
    const normalized = name.replace(/,\s*/g, " ").replace(/\s+/g, " ");
    if (normalized !== name && !map.has(normalized)) {
      map.set(normalized, entry);
    }
  }

  cachedGroups = map;
  return map;
}

/**
 * Resolves a card name to its duplicate group identity (case-insensitive).
 * Falls back to normalized name (commas stripped) if exact match fails.
 * Returns null if the card is not part of any duplicate group.
 */
export async function resolveCardIdentity(
  cardName: string,
): Promise<SameCardEntry | null> {
  const groups = await getSameCardGroups();
  const lower = cardName.toLowerCase();
  const found = groups.get(lower);
  if (found) return found;

  // Fallback: normalize and try again
  const normalized = lower.replace(/,\s*/g, " ").replace(/\s+/g, " ");
  return groups.get(normalized) ?? null;
}
