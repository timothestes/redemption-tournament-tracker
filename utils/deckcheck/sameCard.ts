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
 * Strip "(Set)" or "[Variant]" suffixes from a card name.
 * "Michael, Dragon Slayer (Roots)" -> "Michael, Dragon Slayer"
 * "Lost Soul "Hopper" [II Chronicles 28:13 - RR]" -> "Lost Soul "Hopper""
 */
function stripSetSuffix(name: string): string {
  let stripped = name.replace(/\s*\[[^\]]+\]\s*$/, "");
  const match = stripped.match(/\s+\(([A-Za-z0-9][A-Za-z0-9 .''\-]*)\)\s*$/);
  if (match && match[1].length <= 30) {
    stripped = stripped.slice(0, match.index).trim();
  }
  return stripped;
}

/**
 * Resolves a card name to its duplicate group identity (case-insensitive).
 * Tries exact match, then comma-normalized, then set-suffix-stripped variants.
 * Returns null if the card is not part of any duplicate group.
 */
export async function resolveCardIdentity(
  cardName: string,
): Promise<SameCardEntry | null> {
  const groups = await getSameCardGroups();
  const normalizeCommas = (s: string) =>
    s.replace(/,\s*/g, " ").replace(/\s+/g, " ");

  const lower = cardName.toLowerCase();
  const found = groups.get(lower);
  if (found) return found;

  const normalized = normalizeCommas(lower);
  const foundNorm = groups.get(normalized);
  if (foundNorm) return foundNorm;

  // Fallback: strip "(Set)" / "[Variant]" suffix and retry.
  // The card database stores names like "Michael, Dragon Slayer (Roots)" but
  // duplicate_card_group_members stores the bare "Michael, Dragon Slayer".
  const stripped = stripSetSuffix(cardName).toLowerCase();
  if (stripped !== lower) {
    const foundStripped = groups.get(stripped);
    if (foundStripped) return foundStripped;

    const strippedNorm = normalizeCommas(stripped);
    if (strippedNorm !== stripped) {
      const foundStrippedNorm = groups.get(strippedNorm);
      if (foundStrippedNorm) return foundStrippedNorm;
    }
  }

  return null;
}
