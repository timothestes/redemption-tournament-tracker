import { ResolvedCard, DeckCheckIssue, CardGroup } from "./types";
import { FormatDef, PARAGON_EXCLUDED_SETS, matchesBanListEntry } from "@/lib/formats";

// ---------------------------------------------------------------------------
// Helper predicates
// ---------------------------------------------------------------------------

export function isLostSoul(card: ResolvedCard): boolean {
  return card.type.toLowerCase().includes("lost soul");
}

export function isDominant(card: ResolvedCard): boolean {
  return card.type.toLowerCase().includes("dominant");
}

export function isHopperLostSoul(card: ResolvedCard): boolean {
  if (!isLostSoul(card)) return false;
  const nameLower = card.name.toLowerCase();
  if (nameLower.includes("hopper")) return true;
  // Also check the reference field directly
  if (card.reference === "II Chronicles 28:13") return true;
  if (card.reference === "Matthew 18:12") return true;
  // Check name for reference text (card names often contain the reference)
  if (nameLower.includes("ii chronicles 28:13")) return true;
  return false;
}

export function hasSpecialAbility(card: ResolvedCard): boolean {
  return card.specialAbility.trim().length > 0;
}

export function isMultiBrigade(card: ResolvedCard): boolean {
  if (!card.brigade || card.brigade.trim() === "") return false;
  const lower = card.brigade.toLowerCase();
  // The TSV card database uses "Multi" as a brigade value for multi-brigade cards
  // It can appear as: "Multi", "Multi/Brown", "Gray/Multi", "Blue/Green (Multi)", etc.
  if (lower === "multi" || lower === "multi (multi)") return true;
  if (lower.includes("multi/") || lower.includes("/multi")) return true;
  // Also catch explicit slash-separated brigades like "Blue/Red"
  return card.brigade.includes("/") || card.brigade.includes(",");
}

export function isSingleBrigade(card: ResolvedCard): boolean {
  if (!card.brigade || card.brigade.trim() === "") return false;
  const lower = card.brigade.toLowerCase();
  if (lower === "colorless") return false;
  if (isMultiBrigade(card)) return false;
  return true;
}

export function isSiteOrCity(card: ResolvedCard): boolean {
  const t = card.type.toLowerCase();
  return t.includes("site") || t.includes("city");
}

// ---------------------------------------------------------------------------
// Quantity helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the required number of Lost Souls for a given main deck size.
 * Based on the official chart: 50-56 = 7, +1 per 7 cards.
 */
export function getRequiredLostSouls(mainDeckSize: number): number {
  if (mainDeckSize < 50) return 0; // deck is too small — caught by deck-size rule
  return Math.floor((mainDeckSize - 50) / 7) + 7;
}

/**
 * Calculate the maximum allowed copies of a card based on a "per 50 cards"
 * scaling rule. E.g. baseMax=1 means 1 per 50 cards: 50→1, 100→2, 150→3.
 */
export function getMaxPerFifty(
  mainDeckSize: number,
  baseMax: number
): number {
  const multiplier = Math.max(1, Math.floor(mainDeckSize / 50));
  return baseMax * multiplier;
}

/**
 * Pluralize a card's canonical name for use in error messages.
 * Adds "es" when the name ends in s/x/z/sh/ch (e.g., "Faithful Witness"
 * -> "Faithful Witnesses"), otherwise adds "s".
 */
function pluralize(name: string): string {
  if (/(?:s|x|z|sh|ch)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

// ---------------------------------------------------------------------------
// Special card exception definitions
// ---------------------------------------------------------------------------

interface SpecialCardDef {
  matchName: string;
  matchSets?: string[]; // if provided, card must come from one of these sets
  maxPerFiftyBase: number; // e.g. 4 means "4 per 50 cards"
  note: string;
}

const SPECIAL_CARDS: SpecialCardDef[] = [
  {
    matchName: "Faithful Witness",
    matchSets: ["RoJ", "Revelation of John"],
    maxPerFiftyBase: 4,
    note: "Faithful Witness (Revelation of John): max 4 per deck",
  },
  {
    matchName: "Locust from the Pit",
    matchSets: ["RoJ", "Revelation of John"],
    maxPerFiftyBase: 5,
    note: "Locust from the Pit (Revelation of John): max 5 per 50 cards",
  },
  {
    // Legion from Apostles (Ap) and Disciples (Di) — not "Legion of Angels"
    matchName: "Legion",
    matchSets: ["Ap", "Di", "Apostles", "Disciples", "RR", "Roots"],
    maxPerFiftyBase: 4,
    note: "Legion: max 4 per 50 cards",
  },
];

// Angry Mob variants by brigade
const ANGRY_MOB_VARIANTS: { brigade: string; note: string }[] = [
  { brigade: "Black", note: "Angry Mob [Black] (Early Church): max 4 per 50 cards" },
  { brigade: "Brown", note: "Angry Mob [Brown] (Early Church): max 4 per 50 cards" },
  { brigade: "Gray", note: "Angry Mob [Gray] (Early Church): max 4 per 50 cards" },
];

function matchesSpecialCard(
  card: ResolvedCard,
  spec: SpecialCardDef
): boolean {
  const cardNameLower = card.name.toLowerCase();
  const specNameLower = spec.matchName.toLowerCase();
  const canonicalLower = (card.canonicalName ?? "").toLowerCase();
  // Match by exact name, startsWith (for "Faithful Witness (RoJ)"), or canonical name
  const nameMatch =
    cardNameLower === specNameLower ||
    cardNameLower.startsWith(specNameLower + " ") ||
    cardNameLower.startsWith(specNameLower + "(") ||
    canonicalLower === specNameLower;
  if (!nameMatch) return false;
  if (spec.matchSets) {
    // Match set by exact or by checking if card set starts with any of the match sets
    return spec.matchSets.some((s) => {
      const sl = s.toLowerCase();
      const cl = card.set.toLowerCase();
      return cl === sl || cl.startsWith(sl);
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mutual exclusion pairs
// ---------------------------------------------------------------------------

interface MutualExclusion {
  cardA: string;
  cardAType?: string; // if set, only match cards of this type
  cardB: string;
  cardBType?: string;
  label: string;
}

const MUTUAL_EXCLUSIONS: MutualExclusion[] = [
  {
    cardA: "New Jerusalem",
    cardAType: "dominant", // Only the Dominant version, not the Site
    cardB: "The Second Coming",
    label: "New Jerusalem [Dominant] / The Second Coming",
  },
  {
    cardA: "Son of God",
    cardB: "Chariot of Fire",
    cardBType: "dominant", // Only the Dominant version (PoC), not the Artifact (Roots/Wa/Promo)
    label: "Son of God / Chariot of Fire [Dominant]",
  },
];

function cardMatchesExclusion(
  card: ResolvedCard,
  targetName: string,
  targetType?: string
): boolean {
  // Check type first if required
  if (targetType && !card.type.toLowerCase().includes(targetType)) return false;
  const lower = targetName.toLowerCase();
  if (card.name.toLowerCase() === lower) return true;
  if (card.name.toLowerCase().startsWith(lower + " ")) return true;
  if ((card.canonicalName ?? "").toLowerCase() === lower) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Character aliases — dual-alignment and renamed characters
// ---------------------------------------------------------------------------
// Characters that represent the same biblical figure but have different card
// names. These should be treated as the same card for quantity limits when
// they share at least one alignment component (both partly evil, both partly
// good, or both dual-alignment).
//
// The duplicate_card_groups database catches many of these, but some are
// missed when names differ significantly (e.g., "King Manasseh" vs
// "Manasseh, the Humbled / Manasseh, the Wicked").

interface CharacterAlias {
  /** All known card name prefixes for this character. Case-insensitive, matched via startsWith. */
  names: string[];
  /** Name prefixes that should NOT match (different biblical figures sharing a name). */
  excludeNames?: string[];
  /** Human-readable label */
  label: string;
}

// Cards with the same character identity but different names. This list covers
// cases where the duplicate_card_groups database misses the relationship due
// to significantly different names (e.g., "King X" vs "X, the Y / X, the Z").
//
// Characters that only have Good versions and Evil versions but NO dual-type
// (Hero/Evil Character) version are not included — the alignment check handles them.
const CHARACTER_ALIASES: CharacterAlias[] = [
  // Lineage of Christ dual-type characters with single-type counterparts
  { names: ["King Manasseh", "Manasseh"], label: "Manasseh" },
  { names: ["King Solomon", "Solomon"], label: "Solomon" },
  { names: ["King Abijah", "King Abijam", "Abijah, the Conqueror", "Abijam"], label: "Abijah/Abijam" },
  { names: ["Amaziah, the Just", "Amaziah, the Arrogant"], label: "Amaziah" },
  { names: ["Azariah, the Strong", "Uzziah"], label: "Azariah/Uzziah" },
  { names: ["Joash, Child King", "Joash, the Murderer", "Joash"], label: "Joash" },
  // Cloud of Witnesses / other dual-type characters
  { names: ["King Saul", "Saul"], excludeNames: ["Saul of Tarsus", "Saul/Paul"], label: "King Saul" },
  { names: ["King Jehu"], label: "King Jehu" },
  { names: ["Joab"], label: "Joab" },
  { names: ["Judas Iscariot", "Judas, the Betrayer"], label: "Judas Iscariot" },
  // Gospel of Christ dual-type characters
  { names: ["Zaccheus"], label: "Zaccheus" },
  { names: ["Nicodemus"], label: "Nicodemus" },
  { names: ["Pharaoh's Daughter"], label: "Pharaoh's Daughter" },
];

function cardMatchesAlias(card: ResolvedCard, namePrefix: string): boolean {
  const lower = card.name.toLowerCase();
  const prefix = namePrefix.toLowerCase();
  return lower === prefix || lower.startsWith(prefix + " ") ||
    lower.startsWith(prefix + ",") || lower.startsWith(prefix + "(") ||
    lower.startsWith(prefix + "/");
}

function isCharacterType(card: ResolvedCard): boolean {
  const t = card.type.toLowerCase();
  return t.includes("hero") || t.includes("evil character");
}

/**
 * Get alignment components from a card, considering BOTH the alignment field
 * AND the type field. This is important for dual-type cards (Hero/Evil Character)
 * which have "Neutral" alignment in the database but are both Good and Evil.
 */
function getAlignmentComponents(card: ResolvedCard): { good: boolean; evil: boolean } {
  const alignment = (card.alignment || "").toLowerCase();
  const type = (card.type || "").toLowerCase();

  let good = alignment.includes("good");
  let evil = alignment.includes("evil");

  // For Hero/Evil Character dual-type cards, the alignment field says "Neutral"
  // but the card is both Good and Evil. Derive from the type field.
  if (type.includes("hero")) good = true;
  if (type.includes("evil character")) evil = true;

  return { good, evil };
}

/**
 * Check if two cards share at least one alignment component.
 * E.g., "Evil" and "Hero/Evil Character (Neutral)" share "Evil".
 * Uses both the alignment field and the type field to determine components.
 */
function sharesAlignment(a: ResolvedCard, b: ResolvedCard): boolean {
  const aComp = getAlignmentComponents(a);
  const bComp = getAlignmentComponents(b);
  if (aComp.good && bComp.good) return true;
  if (aComp.evil && bComp.evil) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Individual rule functions
// ---------------------------------------------------------------------------

/**
 * Rule: t1-deck-size — Main deck size must fall within [min, max].
 * Defaults to the T1 (Limited/Unlimited) range of 50-70.
 */
export function checkDeckSize(
  mainDeckCards: ResolvedCard[],
  min = 50,
  max = 70
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const size = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);

  if (size < min) {
    issues.push({
      type: "error",
      rule: "t1-deck-size",
      message: `Main deck has ${size} cards — minimum is ${min}.`,
    });
  }
  if (size > max) {
    issues.push({
      type: "error",
      rule: "t1-deck-size",
      message: `Main deck has ${size} cards — maximum is ${max}.`,
    });
  }

  return issues;
}

/**
 * Rule: t1-lost-soul-count — Lost Soul count must match the chart exactly.
 * Hopper Lost Souls do not count toward the requirement.
 */
export function checkLostSoulCount(
  mainDeckCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const mainDeckSize = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);

  if (mainDeckSize < 50) return issues; // caught by deck-size rule

  const lostSouls = mainDeckCards.filter((c) => isLostSoul(c));
  const nonHopperCount = lostSouls
    .filter((c) => !isHopperLostSoul(c))
    .reduce((sum, c) => sum + c.quantity, 0);
  const required = getRequiredLostSouls(mainDeckSize);

  if (nonHopperCount !== required) {
    const hopperCount = lostSouls
      .filter((c) => isHopperLostSoul(c))
      .reduce((sum, c) => sum + c.quantity, 0);
    const totalLS = nonHopperCount + hopperCount;
    const hopperNote =
      hopperCount > 0 ? ` (${hopperCount} Hopper LS not counted)` : "";
    issues.push({
      type: "error",
      rule: "t1-lost-soul-count",
      message: `Deck requires exactly ${required} Lost Souls but has ${nonHopperCount} counting toward the requirement (${totalLS} total)${hopperNote}.`,
    });
  }

  return issues;
}

/**
 * Rule: t1-reserve-size — Reserve may have 0-max cards (default max 10).
 */
export function checkReserveSize(
  reserveCards: ResolvedCard[],
  max = 10
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const size = reserveCards.reduce((sum, c) => sum + c.quantity, 0);

  if (size > max) {
    issues.push({
      type: "error",
      rule: "t1-reserve-size",
      message: `Reserve has ${size} cards — maximum is ${max}.`,
    });
  }

  return issues;
}

/**
 * Rule: t1-reserve-contents — No Dominants or Lost Souls in reserve.
 */
export function checkReserveContents(
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  const reserveDominants = reserveCards.filter((c) => isDominant(c));
  for (const card of reserveDominants) {
    issues.push({
      type: "error",
      rule: "t1-reserve-contents",
      message: `"${card.name}" is a Dominant and cannot be in the reserve.`,
      cards: [card.name],
    });
  }

  const reserveLS = reserveCards.filter((c) => isLostSoul(c));
  for (const card of reserveLS) {
    issues.push({
      type: "error",
      rule: "t1-reserve-contents",
      message: `"${card.name}" is a Lost Soul and cannot be in the reserve.`,
      cards: [card.name],
    });
  }

  return issues;
}

/**
 * Rule: t1-dominant-limit — Total Dominants cannot exceed Lost Soul count.
 */
export function checkDominantLimit(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const allCards = [...mainDeckCards, ...reserveCards];

  const dominantCount = allCards
    .filter((c) => isDominant(c))
    .reduce((sum, c) => sum + c.quantity, 0);

  // Per the PDF: "The number of Dominants may not exceed the number of Lost Souls in a deck.
  // (The 'Hopper' Lost Soul does not count towards Lost Soul deck building requirements.)"
  // So Hopper LS don't count for this cap either.
  const countingLostSouls = mainDeckCards
    .filter((c) => isLostSoul(c) && !isHopperLostSoul(c))
    .reduce((sum, c) => sum + c.quantity, 0);

  if (dominantCount > countingLostSouls) {
    issues.push({
      type: "error",
      rule: "t1-dominant-limit",
      message: `Deck has ${dominantCount} Dominants but only ${countingLostSouls} counting Lost Souls — Dominants may not exceed Lost Soul count.`,
    });
  }

  return issues;
}

/**
 * Rule: t1-dominant-unique — Max 1 copy of each unique Dominant.
 */
export function checkDominantUnique(
  _mainDeckCards: ResolvedCard[],
  _reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  for (const group of cardGroups) {
    // Check if any card in the group is a Dominant
    const dominantCards = group.cards.filter((c) => isDominant(c));
    if (dominantCards.length === 0) continue;

    const totalQty = dominantCards.reduce((sum, c) => sum + c.quantity, 0);
    if (totalQty > 1) {
      issues.push({
        type: "error",
        rule: "t1-dominant-unique",
        message: `"${group.canonicalName}" is a Dominant — max 1 copy allowed, found ${totalQty}.`,
        cards: [group.canonicalName],
      });
    }
  }

  return issues;
}

/**
 * Rule: t1-mutual-exclusion — Certain card pairs are mutually exclusive.
 */
export function checkMutualExclusion(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const allCards = [...mainDeckCards, ...reserveCards];

  for (const pair of MUTUAL_EXCLUSIONS) {
    const hasA = allCards.some(
      (c) => c.quantity > 0 && cardMatchesExclusion(c, pair.cardA, pair.cardAType)
    );
    const hasB = allCards.some(
      (c) => c.quantity > 0 && cardMatchesExclusion(c, pair.cardB, pair.cardBType)
    );

    if (hasA && hasB) {
      issues.push({
        type: "error",
        rule: "t1-mutual-exclusion",
        message: `Cannot have both "${pair.cardA}" and "${pair.cardB}" in the same deck — they are mutually exclusive.`,
        cards: [pair.cardA, pair.cardB],
      });
    }
  }

  return issues;
}

/**
 * Rule: t1-quantity-multi-brigade — Multi-brigade cards are limited to 1 copy each.
 */
export function checkMultiBrigadeLimit(
  _mainDeckCards: ResolvedCard[],
  _reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  for (const group of cardGroups) {
    const multiBrigadeCards = group.cards.filter(
      (c) => isMultiBrigade(c) && !isDominant(c) && !isLostSoul(c) && !isSpecialExceptionCard(c)
    );
    if (multiBrigadeCards.length === 0) continue;

    const totalQty = multiBrigadeCards.reduce((sum, c) => sum + c.quantity, 0);
    if (totalQty > 1) {
      issues.push({
        type: "error",
        rule: "t1-quantity-multi-brigade",
        message: `"${group.canonicalName}" is multi-brigade — max 1 copy allowed, found ${totalQty}.`,
        cards: [group.canonicalName],
      });
    }
  }

  return issues;
}

/**
 * Extract the Lost Soul ability name from a card's identifier or name.
 * Examples:
 *   identifier '["Hopper"]' → "hopper"
 *   name 'Lost Soul "Revealer" [John 3:20]' → "revealer"
 *   name 'Lost Soul Romans 3:23 (Revealer)' → "revealer"
 * Returns null if no ability name can be extracted.
 */
export function extractLsAbilityName(card: ResolvedCard): string | null {
  // Try identifier field first: e.g., '["Hopper"]', '["Revealer"]'
  const idMatch = card.identifier?.match(/\["?([^"\]]+)"?\]/);
  if (idMatch) return idMatch[1].trim().toLowerCase();

  // Try card name: Lost Soul "Name" pattern
  const quoteMatch = card.name.match(/Lost Soul\s+"([^"]+)"/i);
  if (quoteMatch) return quoteMatch[1].trim().toLowerCase();

  // Try card name: trailing (Name) pattern — e.g., "Lost Soul Romans 3:23 (Revealer)"
  const parenMatch = card.name.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    // Skip set codes / year tags like "(PoC)", "(2025 - Seasonal)"
    if (!/^\d{4}|^[A-Z]{2,4}$/.test(inner)) {
      return inner.toLowerCase();
    }
  }

  return null;
}

/**
 * Rule: t1-quantity-ls-ability — Lost Souls with a special ability are limited to
 * `maxCopies` copies each (default 1). T2 calls this with maxCopies=1 and its own
 * rule id "t2-ls-ability" (spec §4).
 *
 * Per Deck Building Rules v1.3: "Lost Souls with the same reference have the same name"
 * So we group LS by reference, not just by CardGroup identity.
 * Exception: Jeremiah 22:3 has two different LS (Foreigner and Orphans).
 *
 * Additionally, Lost Souls with the same ability name but different references are the
 * same card (e.g., Hopper: II Chronicles 28:13 and Matthew 18:12; Revealer: John 3:20
 * and Romans 3:23). We merge groups that share an ability name.
 */
export function checkLostSoulAbilityLimit(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  _cardGroups: CardGroup[],
  maxCopies = 1,
  rule = "t1-quantity-ls-ability"
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const allCards = [...mainDeckCards, ...reserveCards];

  // Collect all special-ability Lost Souls
  const specialLS = allCards.filter((c) => isLostSoul(c) && hasSpecialAbility(c));

  // Step 1: Group by reference — same reference = same card
  const byReference = new Map<string, { cards: ResolvedCard[]; totalQty: number }>();

  for (const card of specialLS) {
    const ref = card.reference?.trim();
    if (!ref) continue;

    // Exception: Jeremiah 22:3 has two different LS — use identifier to distinguish
    let key = ref;
    if (ref === "Jeremiah 22:3") {
      const id = card.identifier?.toLowerCase() || "";
      const subKey = id.includes("foreigner") ? "Foreigner" : id.includes("orphan") ? "Orphans" : card.name;
      key = `${ref}::${subKey}`;
    }

    if (!byReference.has(key)) {
      byReference.set(key, { cards: [], totalQty: 0 });
    }
    const group = byReference.get(key)!;
    group.cards.push(card);
    group.totalQty += card.quantity;
  }

  // Step 2: Merge groups that share the same LS ability name across different references
  // (e.g., Hopper: II Chronicles 28:13 + Matthew 18:12, Revealer: John 3:20 + Romans 3:23)
  const byAbilityName = new Map<string, string[]>(); // ability name → list of reference keys
  for (const [refKey, group] of byReference) {
    for (const card of group.cards) {
      const abilityName = extractLsAbilityName(card);
      if (abilityName) {
        if (!byAbilityName.has(abilityName)) {
          byAbilityName.set(abilityName, []);
        }
        const refs = byAbilityName.get(abilityName)!;
        if (!refs.includes(refKey)) {
          refs.push(refKey);
        }
      }
    }
  }

  // Merge reference groups that share an ability name
  const merged = new Set<string>(); // reference keys that have been merged into another
  for (const [, refKeys] of byAbilityName) {
    if (refKeys.length < 2) continue;
    // Merge all into the first reference key's group
    const primary = refKeys[0];
    const primaryGroup = byReference.get(primary)!;
    for (let i = 1; i < refKeys.length; i++) {
      const other = refKeys[i];
      if (merged.has(other)) continue;
      const otherGroup = byReference.get(other);
      if (!otherGroup) continue;
      primaryGroup.cards.push(...otherGroup.cards);
      primaryGroup.totalQty += otherGroup.totalQty;
      merged.add(other);
    }
  }

  // Step 3: Check each group
  for (const [refKey, group] of byReference) {
    if (merged.has(refKey)) continue; // skip merged groups
    if (group.totalQty > maxCopies) {
      const names = [...new Set(group.cards.map((c) => c.name))];
      const displayName = names.length === 1 ? names[0] : names.join(" / ");
      issues.push({
        type: "error",
        rule,
        message: `"${displayName}" is a Lost Soul with a special ability — max ${maxCopies} cop${maxCopies === 1 ? "y" : "ies"} allowed, found ${group.totalQty}.`,
        cards: names,
      });
    }
  }

  return issues;
}

/**
 * Rule: t1-quantity-special-ability — Cards with a special ability are limited
 * to 1 per 50 cards in the main deck.
 */
export function checkSpecialAbilityLimit(
  mainDeckCards: ResolvedCard[],
  _reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const mainDeckSize = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);
  const maxCopies = getMaxPerFifty(mainDeckSize, 1);

  for (const group of cardGroups) {
    // Skip Dominants and Lost Souls — they have their own rules
    const applicableCards = group.cards.filter(
      (c) =>
        hasSpecialAbility(c) &&
        !isDominant(c) &&
        !isLostSoul(c) &&
        !isSpecialExceptionCard(c)
    );
    if (applicableCards.length === 0) continue;

    const totalQty = applicableCards.reduce((sum, c) => sum + c.quantity, 0);
    if (totalQty > maxCopies) {
      const distinctNames = Array.from(
        new Set(applicableCards.map((c) => c.name))
      );
      const printingNote =
        distinctNames.length > 1
          ? ` (${distinctNames.map((n) => `"${n}"`).join(" + ")} count as the same card)`
          : "";
      issues.push({
        type: "error",
        rule: "t1-quantity-special-ability",
        message: `Too many "${pluralize(group.canonicalName)}" — max ${maxCopies} per 50 cards, found ${totalQty}${printingNote}.`,
        cards: distinctNames,
      });
    }
  }

  return issues;
}

/**
 * Rule: t1-character-alias — Characters that represent the same biblical figure
 * (but have different card names) should be treated as the same card when they
 * share at least one alignment component.
 *
 * This catches cases missed by the duplicate_card_groups database, such as
 * "King Manasseh" (Evil) and "Manasseh, the Humbled / Manasseh, the Wicked" (Good/Evil).
 * Both are "at least partly evil," so they conflict.
 *
 * A purely Good version and a purely Evil version of the same character do NOT
 * conflict (they are considered different cards for deck building).
 */
export function checkCharacterAliasLimit(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const allCards = [...mainDeckCards, ...reserveCards];
  const mainDeckSize = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);
  const maxCopies = getMaxPerFifty(mainDeckSize, 1);

  // Collect all character cards (with SA) that aren't already in the same card group
  const characters = allCards.filter(
    (c) => isCharacterType(c) && hasSpecialAbility(c) && c.quantity > 0
  );

  for (const alias of CHARACTER_ALIASES) {
    // Find all characters matching any name prefix in this alias,
    // excluding cards that match exclusion prefixes (different people)
    const matchingCards = characters.filter((c) => {
      if (alias.excludeNames?.some((ex) => cardMatchesAlias(c, ex))) return false;
      return alias.names.some((n) => cardMatchesAlias(c, n));
    });

    if (matchingCards.length < 2) continue;

    // Skip cards already in the same CardGroup (already caught by checkSpecialAbilityLimit)
    const groupIds = new Set(
      matchingCards
        .filter((c) => c.duplicateGroupId != null)
        .map((c) => c.duplicateGroupId!)
    );
    // If all matching cards share the same group ID, skip (already handled)
    if (groupIds.size === 1 && matchingCards.every((c) => c.duplicateGroupId != null)) {
      continue;
    }

    // Check for alignment conflicts: group cards by alignment components
    // Cards sharing at least one alignment = same card for quantity limits
    // Purely Good vs purely Evil = different cards (no conflict)
    const conflictingCards: ResolvedCard[] = [];
    for (let i = 0; i < matchingCards.length; i++) {
      for (let j = i + 1; j < matchingCards.length; j++) {
        if (sharesAlignment(matchingCards[i], matchingCards[j])) {
          if (!conflictingCards.includes(matchingCards[i])) conflictingCards.push(matchingCards[i]);
          if (!conflictingCards.includes(matchingCards[j])) conflictingCards.push(matchingCards[j]);
        }
      }
    }

    if (conflictingCards.length < 2) continue;

    const totalQty = conflictingCards.reduce((sum, c) => sum + c.quantity, 0);
    if (totalQty > maxCopies) {
      const names = [...new Set(conflictingCards.map((c) => c.name))];
      issues.push({
        type: "error",
        rule: "t1-character-alias",
        message: `${alias.label}: "${names.join('" and "')}" represent the same character and share an alignment — max ${maxCopies} per deck, found ${totalQty}.`,
        cards: names,
      });
    }
  }

  return issues;
}

/**
 * Rule: t1-quantity-vanilla — Vanilla single-brigade Heroes, Evil Characters,
 * and Enhancements are limited to 1 copy each.
 *
 * Deck Construction & Format Specific Rules 2.0 (8/13/2026) made Type 1
 * singleton: "All other cards have a maximum of 1 of each in a deck", with only
 * meek Lost Souls exempt. That retired the 3-copy allowance these cards had
 * under Deck Building Rules 1.3. Paragon shares this check and agrees — Paragon
 * Format Rules 1.2 p.3: "You may not include more than 1 copy of any card in
 * your deck."
 */
export function checkVanillaLimit(
  _mainDeckCards: ResolvedCard[],
  _reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const vanillaTypes = new Set(["hero", "evil character", "enhancement"]);

  for (const group of cardGroups) {
    const vanillaCards = group.cards.filter((c) => {
      const typeLower = c.type.toLowerCase();
      return (
        vanillaTypes.has(typeLower) &&
        !hasSpecialAbility(c) &&
        isSingleBrigade(c)
      );
    });
    if (vanillaCards.length === 0) continue;

    const totalQty = vanillaCards.reduce((sum, c) => sum + c.quantity, 0);
    if (totalQty > 1) {
      issues.push({
        type: "error",
        rule: "t1-quantity-vanilla",
        message: `"${group.canonicalName}" — max 1 copy allowed, found ${totalQty}.`,
        cards: [group.canonicalName],
      });
    }
  }

  return issues;
}

/**
 * Rule: t1-sites-cities — Total Sites + Cities may not exceed Lost Soul count.
 */
export function checkSitesCitiesLimit(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const allCards = [...mainDeckCards, ...reserveCards];

  const siteCityCount = allCards
    .filter((c) => isSiteOrCity(c))
    .reduce((sum, c) => sum + c.quantity, 0);

  const lostSoulCount = mainDeckCards
    .filter((c) => isLostSoul(c))
    .reduce((sum, c) => sum + c.quantity, 0);

  if (siteCityCount > lostSoulCount) {
    issues.push({
      type: "error",
      rule: "t1-sites-cities",
      message: `Deck has ${siteCityCount} Sites/Cities but only ${lostSoulCount} Lost Souls — Sites + Cities may not exceed Lost Soul count.`,
    });
  }

  return issues;
}

// The matcher moved to lib/formats.ts so the card browser can ask "is this
// card banned in the format I'm building?" without importing the deck-check
// rules engine. Re-exported here: this has been its public home since the
// format restructure, and callers (and tests) still import it from here.
export { matchesBanListEntry };

/**
 * Rule: banned-card — every card is checked against the format's explicit
 * ban list (lib/formats.ts FormatDef.banList). Def-driven: an empty banList
 * (currently Unlimited, T2, Paragon) makes this a no-op.
 */
export function checkFormatBanList(
  def: FormatDef,
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  if (def.banList.length === 0) return issues;
  for (const card of [...mainDeckCards, ...reserveCards]) {
    if (card.quantity === 0) continue;
    if (card.type === "") continue; // card-not-found stub — card-not-found warning already fired
    if (def.banList.some((entry) => matchesBanListEntry(card, entry))) {
      issues.push({
        type: "error",
        rule: "banned-card",
        message: `"${card.name}" (${card.set}) is banned in ${def.label}.`,
        cards: [card.name],
      });
    }
  }
  return issues;
}

/**
 * Rule: pool-legality — every card must belong to the format's card pool.
 * First-ever pool enforcement (previously search-filter only, spec §4).
 */
export function checkPoolLegality(
  def: FormatDef,
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  if (def.pool === "all") return issues;
  for (const card of [...mainDeckCards, ...reserveCards]) {
    if (card.quantity === 0) continue;
    if (card.type === "") continue; // card-not-found stub — card-not-found warning already fired
    if (def.banList.some((entry) => matchesBanListEntry(card, entry))) continue; // banned-card rule already reports this card
    if (def.pool === "rotation" && card.legality !== "Rotation") {
      issues.push({
        type: "error",
        rule: "pool-legality",
        message: `"${card.name}" (${card.set}) is not in the ${def.label} card pool.`,
        cards: [card.name],
      });
    } else if (def.pool === "paragon" && PARAGON_EXCLUDED_SETS.has(card.officialSet)) {
      issues.push({
        type: "error",
        rule: "pool-legality",
        message: `"${card.name}" (${card.set}) is from a set that is not Paragon legal.`,
        cards: [card.name],
      });
    }
  }
  return issues;
}

/**
 * Helper: check if a card matches one of the special exception cards.
 */
export function isSpecialExceptionCard(card: ResolvedCard): boolean {
  for (const spec of SPECIAL_CARDS) {
    if (matchesSpecialCard(card, spec)) return true;
  }
  // Angry Mob from Early Church — card names are "Angry Mob (EC, Gray)" etc.
  const nameLower = card.name.toLowerCase();
  if (
    (nameLower === "angry mob" || nameLower.startsWith("angry mob (ec")) &&
    (card.set.toLowerCase() === "early church" || card.set.toLowerCase() === "tec")
  ) {
    return true;
  }
  return false;
}

/**
 * Rule: t1-special-card — Specific cards have custom quantity overrides.
 */
export function checkSpecialCards(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const mainDeckSize = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);
  const allCards = [...mainDeckCards, ...reserveCards];

  // Check named special cards
  for (const spec of SPECIAL_CARDS) {
    const matchingCards = allCards.filter((c) => matchesSpecialCard(c, spec));
    if (matchingCards.length === 0) continue;

    const totalQty = matchingCards.reduce((sum, c) => sum + c.quantity, 0);

    // Faithful Witness: flat max 4 (not per 50)
    let maxAllowed: number;
    if (spec.matchName === "Faithful Witness") {
      maxAllowed = 4;
    } else {
      maxAllowed = getMaxPerFifty(mainDeckSize, spec.maxPerFiftyBase);
    }

    if (totalQty > maxAllowed) {
      issues.push({
        type: "error",
        rule: "t1-special-card",
        message: `"${spec.matchName}" — max ${maxAllowed} allowed, found ${totalQty}. ${spec.note}`,
        cards: [spec.matchName],
      });
    }
  }

  // Check Angry Mob variants by brigade
  // Card names are "Angry Mob (EC, Gray)" etc., set is "TEC" or "Early Church"
  for (const variant of ANGRY_MOB_VARIANTS) {
    const matchingCards = allCards.filter((c) => {
      const nameLower = c.name.toLowerCase();
      const isAngryMob = nameLower === "angry mob" || nameLower.startsWith("angry mob (ec");
      const isEarlyChurch = c.set.toLowerCase() === "early church" || c.set.toLowerCase() === "tec";
      if (!isAngryMob || !isEarlyChurch) return false;
      // Match by brigade in the card data OR by brigade name in the card name
      return c.brigade.toLowerCase() === variant.brigade.toLowerCase() ||
        nameLower.includes(variant.brigade.toLowerCase());
    });
    if (matchingCards.length === 0) continue;

    const totalQty = matchingCards.reduce((sum, c) => sum + c.quantity, 0);
    const maxAllowed = getMaxPerFifty(mainDeckSize, 4);

    if (totalQty > maxAllowed) {
      issues.push({
        type: "error",
        rule: "t1-special-card",
        message: `"Angry Mob [${variant.brigade}]" — max ${maxAllowed} allowed, found ${totalQty}. ${variant.note}`,
        cards: ["Angry Mob"],
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main validation entry point
// ---------------------------------------------------------------------------

/**
 * Validate a deck against all Type 1 rules.
 *
 * @param def            - The format definition (Limited or Unlimited)
 * @param mainDeckCards  - Resolved cards in the main deck
 * @param reserveCards   - Resolved cards in the reserve
 * @param cardGroups     - Cards grouped by canonical name (across all versions)
 * @returns All issues found
 */
export function validateT1Rules(
  def: FormatDef,
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  // Structural rules
  issues.push(...checkDeckSize(mainDeckCards, def.main.min, def.main.max));
  issues.push(...checkLostSoulCount(mainDeckCards));
  issues.push(...checkReserveSize(reserveCards, def.reserveMax));
  issues.push(...checkReserveContents(reserveCards));

  // Dominant rules
  issues.push(...checkDominantLimit(mainDeckCards, reserveCards));
  issues.push(...checkDominantUnique(mainDeckCards, reserveCards, cardGroups));

  // Mutual exclusion
  issues.push(...checkMutualExclusion(mainDeckCards, reserveCards));

  // Quantity rules
  issues.push(
    ...checkMultiBrigadeLimit(mainDeckCards, reserveCards, cardGroups)
  );
  issues.push(
    ...checkLostSoulAbilityLimit(mainDeckCards, reserveCards, cardGroups)
  );
  issues.push(
    ...checkSpecialAbilityLimit(mainDeckCards, reserveCards, cardGroups)
  );
  issues.push(...checkVanillaLimit(mainDeckCards, reserveCards, cardGroups));

  // Sites + Cities
  issues.push(...checkSitesCitiesLimit(mainDeckCards, reserveCards));

  // Pool legality
  issues.push(...checkPoolLegality(def, mainDeckCards, reserveCards));

  // Explicit ban list — def-driven, no-op when banList is empty (Unlimited)
  issues.push(...checkFormatBanList(def, mainDeckCards, reserveCards));

  // Special card exceptions
  issues.push(...checkSpecialCards(mainDeckCards, reserveCards, cardGroups));

  // Character alias checks (dual-alignment characters with different names)
  issues.push(
    ...checkCharacterAliasLimit(mainDeckCards, reserveCards, cardGroups)
  );

  return issues;
}

// ---------------------------------------------------------------------------
// Paragon validation entry point
// ---------------------------------------------------------------------------

/**
 * Rule: paragon-deck-size — Main deck must be exactly 40 cards.
 */
export function checkParagonDeckSize(mainDeckCards: ResolvedCard[]): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const size = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);

  if (size < 40) {
    issues.push({
      type: "error",
      rule: "paragon-deck-size",
      message: `Main deck has ${size} cards — Paragon requires exactly 40.`,
    });
  }
  if (size > 40) {
    issues.push({
      type: "error",
      rule: "paragon-deck-size",
      message: `Main deck has ${size} cards — Paragon requires exactly 40.`,
    });
  }

  return issues;
}

/**
 * Validate a deck against Paragon rules.
 *
 * Paragon skips: Lost Soul count check, Dominant-vs-Lost-Soul limit.
 * Paragon keeps: deck size (40 exact), reserve size/contents, dominant uniqueness,
 *                mutual exclusion, quantity rules, pool legality, etc.
 */
export function validateParagonRules(
  def: FormatDef,
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  // Paragon-specific deck size (exactly 40)
  issues.push(...checkParagonDeckSize(mainDeckCards));

  // Reserve rules (same as T1: max 10, no Dominants/LS in reserve)
  issues.push(...checkReserveSize(reserveCards, def.reserveMax));
  issues.push(...checkReserveContents(reserveCards));

  // Dominant uniqueness (max 1 copy of each — still applies)
  issues.push(...checkDominantUnique(mainDeckCards, reserveCards, cardGroups));

  // Mutual exclusion
  issues.push(...checkMutualExclusion(mainDeckCards, reserveCards));

  // Quantity rules
  issues.push(
    ...checkMultiBrigadeLimit(mainDeckCards, reserveCards, cardGroups)
  );
  issues.push(
    ...checkSpecialAbilityLimit(mainDeckCards, reserveCards, cardGroups)
  );
  issues.push(...checkVanillaLimit(mainDeckCards, reserveCards, cardGroups));

  // Sites + Cities
  issues.push(...checkSitesCitiesLimit(mainDeckCards, reserveCards));

  // Pool legality
  issues.push(...checkPoolLegality(def, mainDeckCards, reserveCards));

  // Explicit ban list — def-driven, no-op when banList is empty (Paragon)
  issues.push(...checkFormatBanList(def, mainDeckCards, reserveCards));

  // Special card exceptions
  issues.push(...checkSpecialCards(mainDeckCards, reserveCards, cardGroups));

  // Character alias checks
  issues.push(
    ...checkCharacterAliasLimit(mainDeckCards, reserveCards, cardGroups)
  );

  // NOTE: No checkLostSoulCount, no checkDominantLimit (Paragon has no LS)

  return issues;
}

// ---------------------------------------------------------------------------
// Type 2 helper functions
// ---------------------------------------------------------------------------

/**
 * Count the number of brigades on a card.
 * "Blue" = 1, "Blue/Red" = 2, "Blue/Red/Green" = 3
 * "Multi" = 7 (treated as 3+ for T2 rules)
 * "" or "Colorless" = 0
 */
export function getBrigadeCount(card: ResolvedCard): number {
  if (!card.brigade || card.brigade.trim() === "") return 0;
  const lower = card.brigade.toLowerCase().trim();
  if (lower === "colorless") return 0;
  // "Multi" alone or "Multi (Multi)" means all 7 brigades
  if (lower === "multi" || lower === "multi (multi)") return 7;
  // If any part is "Multi", the card has all brigades of that alignment
  // e.g., "Multi/Brown" = multi-brigade, "Gray/Multi" = multi-brigade
  const parts = card.brigade
    .split(/[/,]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (parts.some((p) => p === "multi")) return 7;
  // Deduplicate — e.g., "Crimson/Orange/Orange" = 2 unique brigades
  return new Set(parts).size;
}

/**
 * Check if card is a character (Hero or Evil Character).
 */
export function isCharacter(card: ResolvedCard): boolean {
  const t = card.type.toLowerCase();
  return t.includes("hero") || t.includes("evil character");
}

/**
 * Check if card is an Enhancement (GE, EE, or dual-type with enhancement).
 * TSV types: "GE", "EE", "GE/EE", "GE/Hero", "EE/Evil Character", etc.
 */
export function isEnhancement(card: ResolvedCard): boolean {
  const t = card.type.toLowerCase();
  // TSV types: "GE", "EE", "GE/EE", "GE/Hero", "EE/Evil Character", etc.
  const parts = t.split(/[/]/).map((p) => p.trim());
  return parts.some((p) => p === "ge" || p === "ee" || p === "enhancement" || p === "good enhancement" || p === "evil enhancement");
}

/**
 * Check if card is an Artifact, Fortress, Covenant, or Curse.
 */
export function isArtifactFortressCovCurse(card: ResolvedCard): boolean {
  const t = card.type.toLowerCase();
  return t.includes("artifact") || t.includes("fortress") || t.includes("covenant") || t.includes("curse");
}

/**
 * Get the effective alignment for T2 good/evil balance.
 * All cards count by their alignment.
 * Dual alignment rules: Neutral+Good = Good, Neutral+Evil = Evil, Good+Evil = Neutral
 */
export function getEffectiveAlignment(
  card: ResolvedCard
): "good" | "evil" | "neutral" {
  const alignment = (card.alignment || "").toLowerCase();
  // Dual alignment: Good + Evil = Neutral for deck building
  if (alignment.includes("good") && alignment.includes("evil")) return "neutral";
  // Dual alignment: Good + Neutral = Good
  if (alignment.includes("good") && alignment.includes("neutral")) return "good";
  // Dual alignment: Evil + Neutral = Evil
  if (alignment.includes("evil") && alignment.includes("neutral")) return "evil";
  // Single alignment
  if (alignment.includes("good")) return "good";
  if (alignment.includes("evil")) return "evil";
  return "neutral";
}

/**
 * T2 Lost Soul requirement: 14 for 100 cards, +1 per 7 beyond 105.
 * Formula: Math.floor((size - 99) / 7) + 14
 */
export function getT2RequiredLostSouls(mainDeckSize: number): number {
  if (mainDeckSize < 100) return 0; // deck is too small — caught by deck-size rule
  return Math.floor((mainDeckSize - 99) / 7) + 14;
}

// ---------------------------------------------------------------------------
// Type 2 rule functions
// ---------------------------------------------------------------------------

/**
 * Rule: t2-deck-size — Main deck must be 100-140 cards.
 */
export function checkT2DeckSize(mainDeckCards: ResolvedCard[]): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const size = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);

  if (size < 100) {
    issues.push({
      type: "error",
      rule: "t2-deck-size",
      message: `Main deck has ${size} cards — minimum is 100.`,
    });
  }
  if (size > 140) {
    issues.push({
      type: "error",
      rule: "t2-deck-size",
      message: `Main deck has ${size} cards — maximum is 140.`,
    });
  }

  return issues;
}

/**
 * Rule: t2-lost-soul-count — Lost Soul count must match the T2 chart exactly.
 * Hopper Lost Souls do not count toward the requirement.
 */
export function checkT2LostSoulCount(
  mainDeckCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const mainDeckSize = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);

  const lostSouls = mainDeckCards.filter((c) => isLostSoul(c));
  const nonHopperCount = lostSouls
    .filter((c) => !isHopperLostSoul(c))
    .reduce((sum, c) => sum + c.quantity, 0);
  const required = getT2RequiredLostSouls(mainDeckSize);

  if (nonHopperCount !== required) {
    const hopperCount = lostSouls
      .filter((c) => isHopperLostSoul(c))
      .reduce((sum, c) => sum + c.quantity, 0);
    const totalLS = nonHopperCount + hopperCount;
    const hopperNote =
      hopperCount > 0 ? ` (${hopperCount} Hopper LS not counted)` : "";
    issues.push({
      type: "error",
      rule: "t2-lost-soul-count",
      message: `Deck requires exactly ${required} Lost Souls but has ${nonHopperCount} counting toward the requirement (${totalLS} total)${hopperNote}.`,
    });
  }

  return issues;
}

/**
 * Rule: t2-reserve-size — Reserve may have 0-20 cards.
 */
export function checkT2ReserveSize(
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const size = reserveCards.reduce((sum, c) => sum + c.quantity, 0);

  if (size > 20) {
    issues.push({
      type: "error",
      rule: "t2-reserve-size",
      message: `Reserve has ${size} cards — maximum is 20.`,
    });
  }

  return issues;
}

/**
 * Rule: t2-copy-limit — flat max 2 copies per card (same-card groups).
 * Skips Dominants (checkDominantUnique), ALL Lost Souls (t2-ls-ability /
 * exempt generics), and special exception cards (checkSpecialCards) — each
 * governed by its own rule. NOTE (spec §4): the exception carve-out is a
 * deliberate fix — the old tiers only excluded exceptions from the
 * 3+-brigade tier, capping Locust at 4 and Faithful Witness at 2 in
 * contradiction of checkSpecialCards. Do not copy the old tier exclusions.
 */
export function checkT2CopyLimit(cardGroups: CardGroup[]): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  for (const group of cardGroups) {
    const capped = group.cards.filter(
      (c) => !isDominant(c) && !isLostSoul(c) && !isSpecialExceptionCard(c)
    );
    if (capped.length === 0) continue;
    const totalQty = capped.reduce((sum, c) => sum + c.quantity, 0);
    if (totalQty > 2) {
      issues.push({
        type: "error",
        rule: "t2-copy-limit",
        message: `"${group.canonicalName}" — max 2 copies per card in T2, found ${totalQty}.`,
        cards: [...new Set(capped.map((c) => c.name))],
      });
    }
  }
  return issues;
}

/**
 * Rule: t2-good-evil-balance — Good and Evil counts must be equal in main deck
 * and in reserve separately.
 * Uses getEffectiveAlignment for dual-alignment resolution.
 * Cards that return "skip" or "neutral" don't count toward either side.
 */
export function checkGoodEvilBalance(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  // Count good/evil in main deck
  let mainGood = 0;
  let mainEvil = 0;
  for (const card of mainDeckCards) {
    const eff = getEffectiveAlignment(card);
    if (eff === "good") mainGood += card.quantity;
    else if (eff === "evil") mainEvil += card.quantity;
  }

  if (mainGood !== mainEvil) {
    issues.push({
      type: "error",
      rule: "t2-good-evil-balance",
      message: `Main deck has ${mainGood} Good cards and ${mainEvil} Evil cards — they must be equal in Type 2.`,
    });
  }

  // Count good/evil in reserve
  let resGood = 0;
  let resEvil = 0;
  for (const card of reserveCards) {
    const eff = getEffectiveAlignment(card);
    if (eff === "good") resGood += card.quantity;
    else if (eff === "evil") resEvil += card.quantity;
  }

  if (resGood !== resEvil) {
    issues.push({
      type: "error",
      rule: "t2-good-evil-balance",
      message: `Reserve has ${resGood} Good cards and ${resEvil} Evil cards — they must be equal in Type 2.`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Type 2 main validation entry point
// ---------------------------------------------------------------------------

/**
 * Validate a deck against all Type 2 rules.
 *
 * @param def            - The T2 format definition (main size, reserve size, pool)
 * @param mainDeckCards  - Resolved cards in the main deck
 * @param reserveCards   - Resolved cards in the reserve
 * @param cardGroups     - Cards grouped by canonical name (across all versions)
 * @returns All issues found
 */
export function validateT2Rules(
  def: FormatDef,
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  // T2-specific structural rules
  issues.push(...checkT2DeckSize(mainDeckCards));
  issues.push(...checkT2LostSoulCount(mainDeckCards));
  issues.push(...checkT2ReserveSize(reserveCards));

  // T2-specific quantity rules — flat 2-copy cap, ability souls max 1
  issues.push(...checkT2CopyLimit(cardGroups));
  issues.push(
    ...checkLostSoulAbilityLimit(mainDeckCards, reserveCards, cardGroups, 1, "t2-ls-ability")
  );

  // T2-specific good/evil balance
  issues.push(...checkGoodEvilBalance(mainDeckCards, reserveCards));

  // Reused from T1 (format-agnostic rules)
  issues.push(...checkReserveContents(reserveCards));
  issues.push(...checkDominantLimit(mainDeckCards, reserveCards));
  issues.push(...checkDominantUnique(mainDeckCards, reserveCards, cardGroups));
  issues.push(...checkMutualExclusion(mainDeckCards, reserveCards));
  issues.push(...checkSitesCitiesLimit(mainDeckCards, reserveCards));
  issues.push(...checkSpecialCards(mainDeckCards, reserveCards, cardGroups));

  // Pool legality
  issues.push(...checkPoolLegality(def, mainDeckCards, reserveCards));

  // Explicit ban list — def-driven, no-op when banList is empty (T2)
  issues.push(...checkFormatBanList(def, mainDeckCards, reserveCards));

  // Character alias checks (dual-alignment characters with different names)
  issues.push(
    ...checkCharacterAliasLimit(mainDeckCards, reserveCards, cardGroups)
  );

  return issues;
}
