"use server";

import { createClient } from "../../../utils/supabase/server";
import { requirePermission } from "../../../utils/adminUtils";

// ─── Types ──────────────────────────────────────────────────────

export interface DuplicateGroupRow {
  id: number;
  canonical_name: string;
  notes: string | null;
  source: string;
  card_type: string | null;
  created_at: string;
  updated_at: string;
  members: DuplicateGroupMemberRow[];
}

export interface DuplicateGroupMemberRow {
  id: number;
  group_id: number;
  card_name: string;
  ordir_sets: string | null;
  matched: boolean;
  created_at: string;
}

// ─── Stats ──────────────────────────────────────────────────────

export interface DuplicateGroupStats {
  totalGroups: number;
  totalCards: number;
  ordirGroups: number;
  manualGroups: number;
}

export async function getDuplicateGroupStats(): Promise<DuplicateGroupStats> {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  const [groupCounts, memberCount] = await Promise.all([
    supabase.from("duplicate_card_groups").select("source"),
    supabase.from("duplicate_card_group_members").select("id", { count: "exact", head: true }),
  ]);

  const groups = groupCounts.data || [];
  return {
    totalGroups: groups.length,
    totalCards: memberCount.count || 0,
    ordirGroups: groups.filter((g) => g.source === "ordir").length,
    manualGroups: groups.filter((g) => g.source === "manual").length,
  };
}

// ─── Read ───────────────────────────────────────────────────────

export async function getDuplicateGroups(search?: string, sourceFilter?: string) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  let query = supabase
    .from("duplicate_card_groups")
    .select(
      `
      id,
      canonical_name,
      notes,
      source,
      card_type,
      created_at,
      updated_at,
      members:duplicate_card_group_members(
        id,
        group_id,
        card_name,
        ordir_sets,
        matched,
        created_at
      )
    `
    )
    .order("canonical_name", { ascending: true })
    .limit(5000);

  if (search && search.trim()) {
    // Search by canonical name or member card names
    // We search canonical_name here; member search is done client-side
    query = query.ilike("canonical_name", `%${search}%`);
  }

  if (sourceFilter && sourceFilter !== "all") {
    query = query.eq("source", sourceFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching duplicate groups:", error);
    return { groups: [], error: error.message };
  }

  return { groups: (data || []) as DuplicateGroupRow[], error: null };
}

export async function getDuplicateGroup(id: number) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("duplicate_card_groups")
    .select(
      `
      id,
      canonical_name,
      notes,
      source,
      card_type,
      created_at,
      updated_at,
      members:duplicate_card_group_members(
        id,
        group_id,
        card_name,
        ordir_sets,
        matched,
        created_at
      )
    `
    )
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching duplicate group:", error);
    return { group: null, error: error.message };
  }

  return { group: data as DuplicateGroupRow, error: null };
}

// ─── Create ─────────────────────────────────────────────────────

export async function createDuplicateGroup(params: {
  canonical_name: string;
  notes?: string;
  card_type?: string;
  member_names: string[];
}) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  // Create the group
  const { data: group, error: groupError } = await supabase
    .from("duplicate_card_groups")
    .insert({
      canonical_name: params.canonical_name.trim(),
      notes: params.notes?.trim() || null,
      source: "manual",
      card_type: params.card_type?.trim() || null,
    })
    .select()
    .single();

  if (groupError) {
    console.error("Error creating duplicate group:", groupError);
    return { group: null, error: groupError.message };
  }

  // Add members
  if (params.member_names.length > 0) {
    const members = params.member_names.map((name) => ({
      group_id: group.id,
      card_name: name.trim(),
      ordir_sets: null,
      matched: true, // Manual entries are considered matched
    }));

    const { error: memberError } = await supabase
      .from("duplicate_card_group_members")
      .insert(members);

    if (memberError) {
      console.error("Error adding members:", memberError);
      return { group, error: `Group created but failed to add members: ${memberError.message}` };
    }
  }

  return { group, error: null };
}

// ─── Update ─────────────────────────────────────────────────────

export async function updateDuplicateGroup(
  id: number,
  updates: {
    canonical_name?: string;
    notes?: string | null;
    card_type?: string | null;
  }
) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.canonical_name !== undefined) updateData.canonical_name = updates.canonical_name.trim();
  if (updates.notes !== undefined) updateData.notes = updates.notes?.trim() || null;
  if (updates.card_type !== undefined) updateData.card_type = updates.card_type?.trim() || null;

  const { error } = await supabase
    .from("duplicate_card_groups")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("Error updating duplicate group:", error);
    return { error: error.message };
  }

  return { error: null };
}

// ─── Delete ─────────────────────────────────────────────────────

export async function deleteDuplicateGroup(id: number) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  // Delete members first (FK constraint)
  const { error: memberError } = await supabase
    .from("duplicate_card_group_members")
    .delete()
    .eq("group_id", id);

  if (memberError) {
    console.error("Error deleting members:", memberError);
    return { error: memberError.message };
  }

  const { error } = await supabase
    .from("duplicate_card_groups")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting duplicate group:", error);
    return { error: error.message };
  }

  return { error: null };
}

// ─── Member Management ──────────────────────────────────────────

export async function addGroupMember(groupId: number, cardName: string) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("duplicate_card_group_members")
    .insert({
      group_id: groupId,
      card_name: cardName.trim(),
      ordir_sets: null,
      matched: true,
    })
    .select()
    .single();

  if (error) {
    console.error("Error adding member:", error);
    return { member: null, error: error.message };
  }

  // Update group timestamp
  await supabase
    .from("duplicate_card_groups")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", groupId);

  return { member: data as DuplicateGroupMemberRow, error: null };
}

export async function removeGroupMember(memberId: number) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  // Get the group_id before deleting
  const { data: member } = await supabase
    .from("duplicate_card_group_members")
    .select("group_id")
    .eq("id", memberId)
    .single();

  const { error } = await supabase
    .from("duplicate_card_group_members")
    .delete()
    .eq("id", memberId);

  if (error) {
    console.error("Error removing member:", error);
    return { error: error.message };
  }

  // Update group timestamp
  if (member) {
    await supabase
      .from("duplicate_card_groups")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", member.group_id);
  }

  return { error: null };
}

// ─── Bulk Operations ────────────────────────────────────────────

export async function bulkApproveSuggestions(suggestions: Suggestion[]) {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  const newGroups = suggestions.filter((s): s is SuggestedGroup => s.kind === "new_group");
  const additions = suggestions.filter((s): s is SuggestedAddition => s.kind === "missing_member");

  let created = 0;
  let added = 0;

  // Batch create new groups
  if (newGroups.length > 0) {
    // Insert all groups at once
    // Use upsert to skip groups that already exist
    const { data: groupRows, error: groupError } = await supabase
      .from("duplicate_card_groups")
      .upsert(
        newGroups.map((s) => ({
          canonical_name: s.baseName,
          source: "manual",
          card_type: s.cardType.toLowerCase() || null,
        })),
        { onConflict: "canonical_name", ignoreDuplicates: true }
      )
      .select("id, canonical_name");

    if (groupError) {
      console.error("Error bulk creating groups:", groupError);
      return { error: groupError.message, created: 0, added: 0 };
    }

    // Build a map of canonical_name → id for the newly created groups
    const groupIdMap = new Map<string, number>();
    for (const row of groupRows || []) {
      groupIdMap.set(row.canonical_name, row.id);
    }

    // Insert all members for new groups in one batch
    const allMembers: { group_id: number; card_name: string; ordir_sets: null; matched: boolean }[] = [];
    for (const s of newGroups) {
      const groupId = groupIdMap.get(s.baseName);
      if (!groupId) continue;
      for (const name of s.cardNames) {
        allMembers.push({
          group_id: groupId,
          card_name: name.trim(),
          ordir_sets: null,
          matched: true,
        });
      }
    }

    if (allMembers.length > 0) {
      const { error: memberError } = await supabase
        .from("duplicate_card_group_members")
        .insert(allMembers);

      if (memberError) {
        console.error("Error bulk inserting members:", memberError);
      }
    }

    created = newGroups.length;
  }

  // Batch add missing members to existing groups
  if (additions.length > 0) {
    const allAdditions: { group_id: number; card_name: string; ordir_sets: null; matched: boolean }[] = [];
    for (const s of additions) {
      for (const name of s.cardNames) {
        allAdditions.push({
          group_id: s.groupId,
          card_name: name.trim(),
          ordir_sets: null,
          matched: true,
        });
      }
    }

    if (allAdditions.length > 0) {
      const { error: addError } = await supabase
        .from("duplicate_card_group_members")
        .insert(allAdditions);

      if (addError) {
        console.error("Error bulk adding members:", addError);
      }
    }

    added = additions.length;
  }

  return { error: null, created, added };
}

// ─── Suggestions: detect potential duplicates from carddata ─────

export interface SuggestedGroup {
  kind: "new_group";
  baseName: string;
  cardNames: string[];
  cardType: string;
}

export interface SuggestedAddition {
  kind: "missing_member";
  groupId: number;
  groupName: string;
  cardNames: string[];
  cardType: string;
}

export type Suggestion = SuggestedGroup | SuggestedAddition;

export async function detectPotentialDuplicates(): Promise<{
  suggestions: Suggestion[];
  error: string | null;
}> {
  await requirePermission("manage_cards");
  const supabase = await createClient();

  // Fetch all existing groups with their members
  const { data: groupsWithMembers } = await supabase
    .from("duplicate_card_groups")
    .select(`
      id,
      canonical_name,
      card_type,
      members:duplicate_card_group_members(card_name)
    `);

  // Build a set of all known member card names
  const existingMemberSet = new Set<string>();
  const existingCanonicalSet = new Set<string>();
  for (const g of groupsWithMembers || []) {
    existingCanonicalSet.add(g.canonical_name.toLowerCase());
    for (const m of (g.members as { card_name: string }[])) {
      existingMemberSet.add(m.card_name.toLowerCase());
    }
  }

  // Combined set for quick "is this card tracked?" checks
  const existingSet = new Set([...existingMemberSet, ...existingCanonicalSet]);

  // Fetch carddata.txt
  const CARD_DATA_URL =
    "https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt";

  const res = await fetch(CARD_DATA_URL);
  if (!res.ok) {
    return { suggestions: [], error: "Failed to fetch carddata.txt" };
  }

  const text = await res.text();
  const lines = text.split("\n").slice(1).filter((l) => l.trim());

  // Parse all cards from carddata
  const allCards: { name: string; type: string }[] = [];
  for (const line of lines) {
    const cols = line.split("\t");
    const name = cols[0]?.trim();
    const type = cols[4]?.trim() || "";
    if (!name) continue;
    allCards.push({ name, type });
  }

  // ─── Pass 1: New group suggestions ────────────────────────────
  // Cards sharing baseName + type that aren't in any existing group

  const baseNameMap = new Map<string, { name: string; type: string }[]>();

  for (const card of allCards) {
    const baseName = stripToBaseName(card.name);
    if (baseName === card.name) continue;
    if (existingSet.has(card.name.toLowerCase())) continue;
    if (existingSet.has(baseName.toLowerCase())) continue;

    const key = `${baseName.toLowerCase()}::${card.type.toLowerCase()}`;
    if (!baseNameMap.has(key)) {
      baseNameMap.set(key, []);
    }
    baseNameMap.get(key)!.push(card);
  }

  const cardByName = new Map<string, string>();
  for (const c of allCards) {
    if (!cardByName.has(c.name)) cardByName.set(c.name, c.type);
  }

  const suggestions: Suggestion[] = [];

  for (const [, variants] of baseNameMap.entries()) {
    const baseName = stripToBaseName(variants[0].name);
    const groupType = variants[0].type;

    const baseCardType = cardByName.get(baseName);
    const baseMatchesType = baseCardType?.toLowerCase() === groupType.toLowerCase();
    const allVariants = baseMatchesType
      ? [{ name: baseName, type: groupType }, ...variants]
      : variants;

    if (allVariants.length < 2) continue;
    if (existingSet.has(baseName.toLowerCase())) continue;

    const untracked = allVariants.filter(
      (v) => !existingSet.has(v.name.toLowerCase())
    );
    if (untracked.length < 2) continue;

    suggestions.push({
      kind: "new_group",
      baseName,
      cardNames: untracked.map((v) => v.name),
      cardType: groupType,
    });
  }

  // ─── Pass 2: Missing member suggestions ───────────────────────
  // Cards in carddata whose baseName matches an existing group's
  // canonical name, but the card itself isn't a member yet

  // Build canonical name → group lookup
  const groupsByCanonical = new Map<string, {
    id: number;
    canonical_name: string;
    card_type: string | null;
    memberNames: Set<string>;
  }>();

  for (const g of groupsWithMembers || []) {
    const memberNames = new Set(
      (g.members as { card_name: string }[]).map((m) => m.card_name.toLowerCase())
    );
    groupsByCanonical.set(g.canonical_name.toLowerCase(), {
      id: g.id,
      canonical_name: g.canonical_name,
      card_type: g.card_type,
      memberNames,
    });
  }

  // Collect missing members per group
  const missingByGroup = new Map<number, { group: typeof groupsByCanonical extends Map<string, infer V> ? V : never; cards: string[] }>();

  for (const card of allCards) {
    // Already a member of some group
    if (existingMemberSet.has(card.name.toLowerCase())) continue;

    const baseName = stripToBaseName(card.name);
    if (baseName === card.name) continue; // Not a variant

    const group = groupsByCanonical.get(baseName.toLowerCase());
    if (!group) continue;

    // Check the card isn't already a member (by exact name)
    if (group.memberNames.has(card.name.toLowerCase())) continue;

    if (!missingByGroup.has(group.id)) {
      missingByGroup.set(group.id, { group, cards: [] });
    }
    missingByGroup.get(group.id)!.cards.push(card.name);
  }

  for (const [, { group, cards }] of missingByGroup.entries()) {
    suggestions.push({
      kind: "missing_member",
      groupId: group.id,
      groupName: group.canonical_name,
      cardNames: cards,
      cardType: group.card_type || "",
    });
  }

  // Sort: missing members first (more actionable), then new groups by size
  suggestions.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "missing_member" ? -1 : 1;
    return b.cardNames.length - a.cardNames.length;
  });

  return { suggestions, error: null };
}

/**
 * Strip bracket and parenthetical suffixes to get a base card name.
 * "Three Woes [Fundraiser]" → "Three Woes"
 * "Three Woes (RoJ)" → "Three Woes"
 * "Lost Soul \"Harvest\" [John 4:35] [2023 - 2nd Place]" → keep as-is (Lost Souls are complex)
 */
function stripToBaseName(name: string): string {
  // Don't strip Lost Soul names — they have meaningful bracket content
  if (name.startsWith("Lost Soul")) return name;

  let stripped = name;

  // Strip bracket suffixes: [Fundraiser], [2024 - Nationals], etc.
  stripped = stripped.replace(/\s*\[[^\]]+\]\s*$/, "");

  // Strip parenthetical set suffixes: (RoJ), (GoC), (PoC), (Promo), etc.
  // Only strip if it looks like a set abbreviation (short, alphanumeric)
  const parenMatch = stripped.match(/\s+\(([A-Za-z0-9][A-Za-z0-9 .'\-]*)\)\s*$/);
  if (parenMatch && parenMatch[1].length <= 20) {
    stripped = stripped.slice(0, parenMatch.index).trim();
  }

  return stripped;
}
