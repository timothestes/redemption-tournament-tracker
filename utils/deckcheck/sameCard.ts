import { createClient } from "@/utils/supabase/server";

type SameCardEntry = { groupId: number; canonicalName: string };

let cachedGroups: Map<string, SameCardEntry> | null = null;

/**
 * Fetches all duplicate card group members joined with their groups and returns
 * a Map keyed by lowercase card name to { groupId, canonicalName }.
 *
 * The result is cached at module level so repeated calls don't re-query.
 */
export async function getSameCardGroups(): Promise<
  Map<string, SameCardEntry>
> {
  if (cachedGroups) {
    return cachedGroups;
  }

  const supabase = await createClient();

  // Paginate to fetch ALL members (Supabase default limit is 1000)
  const PAGE = 1000;
  const allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("duplicate_card_group_members")
      .select("group_id, card_name, duplicate_card_groups(id, canonical_name)")
      .range(offset, offset + PAGE - 1);

    if (error) {
      throw new Error(`Failed to fetch duplicate card groups: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
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
