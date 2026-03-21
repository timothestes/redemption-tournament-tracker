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

  const [totalCount, ordirCount, manualCount, memberCount] = await Promise.all([
    supabase.from("duplicate_card_groups").select("id", { count: "exact", head: true }),
    supabase.from("duplicate_card_groups").select("id", { count: "exact", head: true }).eq("source", "ordir"),
    supabase.from("duplicate_card_groups").select("id", { count: "exact", head: true }).eq("source", "manual"),
    supabase.from("duplicate_card_group_members").select("id", { count: "exact", head: true }),
  ]);

  return {
    totalGroups: totalCount.count || 0,
    totalCards: memberCount.count || 0,
    ordirGroups: ordirCount.count || 0,
    manualGroups: manualCount.count || 0,
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

  // Create the group (or find existing by canonical_name)
  let group: { id: number; canonical_name: string } | null = null;

  const { data: inserted, error: insertError } = await supabase
    .from("duplicate_card_groups")
    .insert({
      canonical_name: params.canonical_name.trim(),
      notes: params.notes?.trim() || null,
      source: "manual",
      card_type: params.card_type?.trim() || null,
    })
    .select()
    .single();

  if (insertError) {
    // If it already exists, look it up and add members to the existing group
    if (insertError.code === "23505") {
      const { data: existing } = await supabase
        .from("duplicate_card_groups")
        .select("id, canonical_name")
        .eq("canonical_name", params.canonical_name.trim())
        .single();

      if (!existing) {
        return { group: null, error: "Group exists but could not be found" };
      }
      group = existing;
    } else {
      console.error("Error creating duplicate group:", insertError);
      return { group: null, error: insertError.message };
    }
  } else {
    group = inserted;
  }

  // Add members (upsert to skip any that already exist)
  if (params.member_names.length > 0) {
    const members = params.member_names.map((name) => ({
      group_id: group!.id,
      card_name: name.trim(),
      ordir_sets: null,
      matched: true,
    }));

    const { error: memberError } = await supabase
      .from("duplicate_card_group_members")
      .upsert(members, { onConflict: "group_id,card_name", ignoreDuplicates: true });

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
    .upsert({
      group_id: groupId,
      card_name: cardName.trim(),
      ordir_sets: null,
      matched: true,
    }, { onConflict: "group_id,card_name", ignoreDuplicates: true })
    .select()
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = "no rows returned" which happens when ignoreDuplicates skips the row
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
    // Deduplicate suggestions by canonical name
    const deduped = new Map<string, SuggestedGroup>();
    for (const s of newGroups) {
      const key = s.baseName.toLowerCase();
      if (deduped.has(key)) {
        const existing = deduped.get(key)!;
        for (const name of s.cardNames) {
          if (!existing.cardNames.includes(name)) {
            existing.cardNames.push(name);
          }
        }
      } else {
        deduped.set(key, { ...s, cardNames: [...s.cardNames] });
      }
    }
    const uniqueGroups = Array.from(deduped.values());

    // Process in chunks of 50 to avoid payload/timeout issues
    const CHUNK_SIZE = 50;
    const groupIdMap = new Map<string, number>();

    for (let i = 0; i < uniqueGroups.length; i += CHUNK_SIZE) {
      const chunk = uniqueGroups.slice(i, i + CHUNK_SIZE);

      // Insert groups, skipping any that already exist
      const { error: groupError } = await supabase
        .from("duplicate_card_groups")
        .upsert(
          chunk.map((s) => ({
            canonical_name: s.baseName,
            source: "manual",
            card_type: s.cardType.toLowerCase() || null,
          })),
          { onConflict: "canonical_name", ignoreDuplicates: true }
        );

      if (groupError) {
        console.error("Error bulk creating groups (chunk):", groupError);
        return { error: groupError.message, created: 0, added: 0 };
      }

      // Look up IDs for all groups in this chunk
      const { data: rows } = await supabase
        .from("duplicate_card_groups")
        .select("id, canonical_name")
        .in("canonical_name", chunk.map((s) => s.baseName));

      for (const row of rows || []) {
        groupIdMap.set(row.canonical_name, row.id);
      }
    }

    // Insert all members for new groups in one batch
    const allMembers: { group_id: number; card_name: string; ordir_sets: null; matched: boolean }[] = [];
    for (const s of uniqueGroups) {
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

    // Insert members in chunks
    for (let i = 0; i < allMembers.length; i += CHUNK_SIZE) {
      const chunk = allMembers.slice(i, i + CHUNK_SIZE);
      const { error: memberError } = await supabase
        .from("duplicate_card_group_members")
        .upsert(chunk, { onConflict: "group_id,card_name", ignoreDuplicates: true });

      if (memberError) {
        console.error("Error bulk inserting members (chunk):", memberError);
      }
    }

    created = uniqueGroups.length;
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

    // Insert additions in chunks, using upsert to skip duplicates
    const ADD_CHUNK = 50;
    for (let i = 0; i < allAdditions.length; i += ADD_CHUNK) {
      const chunk = allAdditions.slice(i, i + ADD_CHUNK);
      const { error: addError } = await supabase
        .from("duplicate_card_group_members")
        .upsert(chunk, { onConflict: "group_id,card_name", ignoreDuplicates: true });

      if (addError) {
        console.error("Error bulk adding members (chunk):", addError);
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

  // Fetch all existing groups — paginate to avoid the 1000-row default
  const allGroups: { id: number; canonical_name: string; card_type: string | null }[] = [];
  let groupOffset = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabase
      .from("duplicate_card_groups")
      .select("id, canonical_name, card_type")
      .range(groupOffset, groupOffset + PAGE - 1);
    if (!data || data.length === 0) break;
    allGroups.push(...data);
    if (data.length < PAGE) break;
    groupOffset += PAGE;
  }
  const groups = allGroups;

  // Fetch all members separately — paginate
  const allMembers: { group_id: number; card_name: string }[] = [];
  let memberOffset = 0;
  while (true) {
    const { data } = await supabase
      .from("duplicate_card_group_members")
      .select("group_id, card_name")
      .range(memberOffset, memberOffset + PAGE - 1);
    if (!data || data.length === 0) break;
    allMembers.push(...data);
    if (data.length < PAGE) break;
    memberOffset += PAGE;
  }
  const members = allMembers;

  // Rebuild the grouped structure
  const membersByGroup = new Map<number, { card_name: string }[]>();
  for (const m of members || []) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push({ card_name: m.card_name });
  }

  const groupsWithMembers = (groups || []).map((g) => ({
    ...g,
    members: membersByGroup.get(g.id) || [],
  }));

  // Build a set of all known member card names
  const existingMemberSet = new Set<string>();
  const existingCanonicalSet = new Set<string>();
  for (const g of groupsWithMembers) {
    existingCanonicalSet.add(g.canonical_name.toLowerCase());
    for (const m of g.members) {
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
  const allCards: { name: string; type: string; reference: string; specialAbility: string; identifier: string }[] = [];
  for (const line of lines) {
    const cols = line.split("\t");
    const name = cols[0]?.trim();
    const type = cols[4]?.trim() || "";
    const specialAbility = cols[10]?.trim() || "";
    const reference = cols[12]?.trim() || "";
    const identifier = cols[9]?.trim() || "";
    if (!name) continue;
    allCards.push({ name, type, reference, specialAbility, identifier });
  }

  // ─── Pass 1: New group suggestions ────────────────────────────
  // Cards sharing baseName + type that aren't in any existing group

  const baseNameMap = new Map<string, { name: string; type: string; specialAbility: string }[]>();

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

  const cardByName = new Map<string, { type: string; specialAbility: string }>();
  for (const c of allCards) {
    if (!cardByName.has(c.name)) cardByName.set(c.name, { type: c.type, specialAbility: c.specialAbility });
  }

  const suggestions: Suggestion[] = [];

  for (const [, variants] of baseNameMap.entries()) {
    const baseName = stripToBaseName(variants[0].name);
    const groupType = variants[0].type;

    const baseCardData = cardByName.get(baseName);
    const baseMatchesType = baseCardData?.type.toLowerCase() === groupType.toLowerCase();
    const allVariants = baseMatchesType
      ? [{ name: baseName, type: groupType, specialAbility: baseCardData!.specialAbility }, ...variants]
      : variants;

    if (allVariants.length < 2) continue;
    if (existingSet.has(baseName.toLowerCase())) continue;

    const untracked = allVariants.filter(
      (v) => !existingSet.has(v.name.toLowerCase())
    );
    if (untracked.length < 2) continue;

    // Skip if all variants have different special abilities — they're
    // genuinely different cards sharing a base name (e.g., art variants
    // like "Servants of the King [Sky]" vs "[River]" with distinct abilities)
    const abilities = new Set(untracked.map((v) => v.specialAbility.trim().toLowerCase()));
    if (abilities.size === untracked.length && abilities.size > 1) continue;

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

    // Skip if card type doesn't match the group's card type
    if (group.card_type && card.type.toLowerCase() !== group.card_type.toLowerCase()) continue;

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

  // ─── Pass 3: Lost Soul grouping by reference ─────────────────
  // Per Deck Building Rules v1.3: "Lost Souls with the same reference
  // have the same name" — so they are the same card for deck building.
  // Exception: Jeremiah 22:3 has two different LS (Foreigner and Orphans).
  // Also handles same-name-different-reference cases from the rules:
  //   Hopper: II Chronicles 28:13 and Matthew 18:12
  //   Lost Souls: Proverbs 2:16-17 and Proverbs 22:14
  //   Revealer: John 3:20 and Romans 3:23

  const lostSouls = allCards.filter((c) => {
    if (!c.type.toLowerCase().includes("lost soul")) return false;
    // Include LS with a special ability text
    if (c.specialAbility.trim() !== "") return true;
    // Also include older LS cards where the ability is in the identifier field
    // (e.g., old Hopper: "Lost Soul II Chronicles 28:13 (Hopper)" has empty specialAbility
    // but the identifier contains the ability text)
    if (c.identifier && c.identifier.toLowerCase().includes("does not count")) return true;
    return false;
  });

  // Group LS by reference — same reference = same card
  const lsByReference = new Map<string, typeof lostSouls>();
  for (const ls of lostSouls) {
    if (!ls.reference) continue;
    const ref = ls.reference.trim();
    if (!lsByReference.has(ref)) {
      lsByReference.set(ref, []);
    }
    lsByReference.get(ref)!.push(ls);
  }

  // Exception: Jeremiah 22:3 has two different LS — split by identifier
  const jer223 = lsByReference.get("Jeremiah 22:3");
  if (jer223 && jer223.length > 1) {
    lsByReference.delete("Jeremiah 22:3");
    // Split into subgroups by identifier (Foreigner vs Orphans)
    const subgroups = new Map<string, typeof lostSouls>();
    for (const ls of jer223) {
      const id = ls.identifier.toLowerCase();
      const key = id.includes("foreigner") ? "Foreigner" : id.includes("orphan") ? "Orphans" : ls.name;
      if (!subgroups.has(key)) subgroups.set(key, []);
      subgroups.get(key)!.push(ls);
    }
    for (const [, group] of subgroups) {
      if (group.length >= 2) {
        lsByReference.set(`Jeremiah 22:3 (${group[0].identifier})`, group);
      }
    }
  }

  // Also group LS that share the same Lost Soul "name" but different references
  // (Hopper, Lost Souls, Revealer per the rules)
  const lsByLsName = new Map<string, typeof lostSouls>();
  for (const ls of lostSouls) {
    // Extract the LS name from the identifier field (e.g., ["Distressed"], ["Hopper"])
    const idMatch = ls.identifier.match(/\["?([^"\]]+)"?\]/);
    let lsName = idMatch ? idMatch[1].trim() : null;
    // Fallback: extract from card name — e.g., "Lost Soul II Chronicles 28:13 (Hopper)"
    if (!lsName) {
      const nameMatch = ls.name.match(/\(([^)]+)\)\s*$/);
      lsName = nameMatch ? nameMatch[1].trim() : null;
    }
    // Also try: Lost Soul "Name" pattern in card name
    if (!lsName) {
      const quoteMatch = ls.name.match(/Lost Soul\s+"([^"]+)"/);
      lsName = quoteMatch ? quoteMatch[1].trim() : null;
    }
    if (!lsName) continue;

    const key = lsName.toLowerCase();
    if (!lsByLsName.has(key)) {
      lsByLsName.set(key, []);
    }
    lsByLsName.get(key)!.push(ls);
  }

  // Merge: for each LS name group that spans multiple references, create a single group
  // with all cards from all references
  const lsMergedGroups = new Map<string, { canonicalName: string; cards: typeof lostSouls }>();

  // First, add all reference-based groups
  for (const [ref, cards] of lsByReference) {
    if (cards.length < 2) continue;
    // Derive canonical name — try identifier, then card name, then reference
    let lsName: string | null = null;
    for (const c of cards) {
      const idMatch = c.identifier.match(/\["?([^"\]]+)"?\]/);
      if (idMatch) { lsName = idMatch[1].trim(); break; }
      const nameMatch = c.name.match(/\(([^)]+)\)\s*$/);
      if (nameMatch) { lsName = nameMatch[1].trim(); break; }
      const quoteMatch = c.name.match(/Lost Soul\s+"([^"]+)"/);
      if (quoteMatch) { lsName = quoteMatch[1].trim(); break; }
    }
    if (!lsName) lsName = ref;
    const key = lsName.toLowerCase();

    if (lsMergedGroups.has(key)) {
      // Merge into existing
      const existing = lsMergedGroups.get(key)!;
      for (const c of cards) {
        if (!existing.cards.some((ec) => ec.name === c.name)) {
          existing.cards.push(c);
        }
      }
    } else {
      lsMergedGroups.set(key, { canonicalName: `Lost Soul "${lsName}"`, cards: [...cards] });
    }
  }

  // Then, add LS name groups that span different references (Hopper, Revealer, etc.)
  for (const [lsName, cards] of lsByLsName) {
    if (cards.length < 2) continue;
    // Check if all cards share the same reference — if so, already handled above
    const uniqueRefs = new Set(cards.map((c) => c.reference));
    if (uniqueRefs.size <= 1) continue;

    if (lsMergedGroups.has(lsName)) {
      const existing = lsMergedGroups.get(lsName)!;
      for (const c of cards) {
        if (!existing.cards.some((ec) => ec.name === c.name)) {
          existing.cards.push(c);
        }
      }
    } else {
      const displayName = lsName.charAt(0).toUpperCase() + lsName.slice(1);
      lsMergedGroups.set(lsName, { canonicalName: `Lost Soul "${displayName}"`, cards: [...cards] });
    }
  }

  // Emit suggestions for LS groups not already tracked
  for (const [, { canonicalName, cards }] of lsMergedGroups) {
    // Filter to only cards not already in a group
    const untracked = cards.filter((c) => !existingSet.has(c.name.toLowerCase()));
    if (untracked.length < 2) continue;

    suggestions.push({
      kind: "new_group",
      baseName: canonicalName,
      cardNames: untracked.map((c) => c.name),
      cardType: "lost soul",
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
