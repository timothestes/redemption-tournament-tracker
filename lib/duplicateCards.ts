import { createClient } from "@/utils/supabase/client";

export interface DuplicateSibling {
  cardName: string;
  ordirSets: string;
  matched: boolean;
}

export interface DuplicateGroup {
  canonicalName: string;
  members: DuplicateSibling[];
}

/**
 * Holds both the raw groups and multiple lookup indices
 * for fast, fuzzy card name → group resolution.
 */
export interface DuplicateGroupIndex {
  /** All groups */
  groups: DuplicateGroup[];
  /** Exact card_name → group(s). Multiple when ambiguous (e.g., "Simeon" in 2 groups) */
  byExact: Map<string, DuplicateGroup[]>;
  /** Normalized card_name → group(s) */
  byNormalized: Map<string, DuplicateGroup[]>;
}

/** Normalize a name for fuzzy matching */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'") // curly quotes → ascii
    .replace(/['']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/,\s+/g, " ") // "David, the Psalmist" → "David the Psalmist"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip set/print suffixes from a carddata.txt name.
 * "Aaron (G)" → "Aaron"
 * "David, Giant Slayer [K]" → "David, Giant Slayer"
 * "David, Heart After God / David, the Contrite (LoC)" → "David, Heart After God"
 */
function stripSetSuffix(name: string): string {
  // Strip bracket suffix: "[K]", "[2025 - Seasonal]", "[Fundraiser]"
  let stripped = name.replace(/\s*\[[^\]]+\]\s*$/, "");
  // Strip paren suffix: "(G)", "(LoC)", "(1st Print - K)", "(CoW AB)"
  const match = stripped.match(
    /\s+\(([A-Za-z0-9][A-Za-z0-9 .''\-]*)\)\s*$/
  );
  if (match && match[1].length <= 30) {
    stripped = stripped.slice(0, match.index).trim();
  }
  return stripped;
}

/**
 * Extract the set abbreviation from a card name's suffix.
 * "Simeon (Pr)" → "Pr"
 * "Salome (B)" → "B"
 * "David, Giant Slayer [K]" → "K"
 * "David (Roots)" → "Roots"
 */
function extractSetFromName(name: string): string | null {
  // Check bracket suffix first
  const bracketMatch = name.match(/\[([^\]]+)\]\s*$/);
  if (bracketMatch) return bracketMatch[1].trim();

  // Check paren suffix
  const parenMatch = name.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) return parenMatch[1].trim();

  return null;
}

/**
 * Generate all lookup keys for a single name.
 * Returns multiple variants so we can match loosely.
 */
function generateKeys(name: string): string[] {
  const keys: string[] = [name, normalize(name)];

  // Strip set suffix
  const base = stripSetSuffix(name);
  if (base !== name) {
    keys.push(base, normalize(base));
  }

  // Handle slash names: "A / B (Set)" → ["A", "B"]
  const slashBase = stripSetSuffix(name);
  if (slashBase.includes(" / ")) {
    const parts = slashBase.split(" / ").map((p) => p.trim());
    for (const part of parts) {
      keys.push(part, normalize(part));
    }
  }

  return keys;
}

/** Add to a Map<string, T[]> */
function addToMultiMap<T>(
  map: Map<string, T[]>,
  key: string,
  value: T
): void {
  const existing = map.get(key);
  if (existing) {
    // Don't add duplicates (same group)
    if (!existing.includes(value)) existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Fetch all duplicate card groups from Supabase and build lookup indices.
 */
export async function fetchDuplicateGroups(): Promise<DuplicateGroupIndex> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("duplicate_card_group_members")
    .select(
      `
      card_name,
      ordir_sets,
      matched,
      group:duplicate_card_groups!inner(id, canonical_name)
    `
    )
    .order("id", { ascending: true });

  const empty: DuplicateGroupIndex = {
    groups: [],
    byExact: new Map(),
    byNormalized: new Map(),
  };

  if (error || !data) {
    console.error("Failed to fetch duplicate groups:", error);
    return empty;
  }

  // Group by group id
  const groupsById = new Map<
    number,
    { canonicalName: string; members: DuplicateSibling[] }
  >();

  for (const row of data as any[]) {
    const groupId = row.group.id as number;
    const canonicalName = row.group.canonical_name as string;

    if (!groupsById.has(groupId)) {
      groupsById.set(groupId, { canonicalName, members: [] });
    }
    groupsById.get(groupId)!.members.push({
      cardName: row.card_name,
      ordirSets: row.ordir_sets || "",
      matched: row.matched,
    });
  }

  // Build lookup indices (multi-map to handle ambiguous names)
  const byExact = new Map<string, DuplicateGroup[]>();
  const byNormalized = new Map<string, DuplicateGroup[]>();
  const groups: DuplicateGroup[] = [];

  for (const group of groupsById.values()) {
    groups.push(group);

    // Index by canonical name
    addToMultiMap(byExact, group.canonicalName, group);
    addToMultiMap(byNormalized, normalize(group.canonicalName), group);

    // Index by each member's name + normalized variant
    for (const member of group.members) {
      addToMultiMap(byExact, member.cardName, group);
      addToMultiMap(byNormalized, normalize(member.cardName), group);
    }
  }

  return { groups, byExact, byNormalized };
}

/**
 * When multiple groups match a key, disambiguate using the set abbreviation
 * from the card name. E.g., "Simeon (Pr)" → set "Pr" → match the group
 * whose "Simeon" member has "Pr" in its ordir_sets.
 */
function disambiguate(
  cardName: string,
  candidates: DuplicateGroup[]
): DuplicateGroup {
  if (candidates.length === 1) return candidates[0];

  const inputSet = extractSetFromName(cardName);
  if (!inputSet) return candidates[0]; // No set info, return first

  const inputSetLower = inputSet.toLowerCase();
  const baseName = stripSetSuffix(cardName);
  const baseNorm = normalize(baseName);

  for (const group of candidates) {
    // Find the member in this group whose name matches the base name
    const member = group.members.find(
      (m) => normalize(m.cardName) === baseNorm || m.cardName === baseName
    );
    if (!member) continue;

    // Check if the input set appears in this member's ORDIR sets
    const ordirSets = member.ordirSets
      .split(",")
      .map((s) => s.trim().toLowerCase());

    // Try matching the full set string or common abbreviation mappings
    if (ordirSets.some((s) => s === inputSetLower)) {
      return group;
    }

    // Also try matching partial — "Roots" in ORDIR might be "RR",
    // and carddata might have different abbreviations. Check if the
    // canonical name hints at which group (e.g., group "Simeon" vs "Simeon (2)")
    // The first canonical (without "(2)") is the "primary" version
  }

  // Fallback: prefer the group whose canonical name doesn't have "(2)" etc.
  const primary = candidates.find((g) => !/\(\d+\)$/.test(g.canonicalName));
  return primary || candidates[0];
}

/**
 * Look up a card's duplicate group using multiple matching strategies.
 */
function findGroup(
  cardName: string,
  index: DuplicateGroupIndex
): DuplicateGroup | null {
  // Generate all possible lookup keys from the input card name
  const keys = generateKeys(cardName);

  // Try exact index first
  for (const key of keys) {
    const candidates = index.byExact.get(key);
    if (candidates) return disambiguate(cardName, candidates);
  }

  // Try normalized index
  for (const key of keys) {
    const candidates = index.byNormalized.get(normalize(key));
    if (candidates) return disambiguate(cardName, candidates);
  }

  return null;
}

/**
 * Get the siblings of a card (excluding itself).
 */
export function getSiblings(
  cardName: string,
  index: DuplicateGroupIndex
): DuplicateSibling[] | null {
  const group = findGroup(cardName, index);
  if (!group) return null;

  // Build set of names that refer to the current card (to exclude from siblings)
  const selfKeys = new Set(generateKeys(cardName).map(normalize));

  // Return siblings whose normalized names don't overlap with self
  const siblings = group.members.filter((m) => {
    const memberNorm = normalize(m.cardName);
    return !selfKeys.has(memberNorm);
  });

  return siblings.length > 0 ? siblings : null;
}
