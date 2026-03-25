import {
  DeckCheckCard,
  DeckCheckResult,
  ResolvedCard,
  CardGroup,
  DeckCheckIssue,
} from "./types";
import { findCard } from "./cardDatabase";
import { resolveCardIdentity } from "./sameCard";
import {
  validateT1Rules,
  validateT2Rules,
  isLostSoul,
  isDominant,
  isSiteOrCity,
  isHopperLostSoul,
  getRequiredLostSouls,
  getT2RequiredLostSouls,
} from "./rules";

// Re-export types for convenience
export type {
  DeckCheckCard,
  DeckCheckResult,
  ResolvedCard,
  CardGroup,
  DeckCheckIssue,
} from "./types";
export type { DeckCheckRequest } from "./types";

/**
 * Resolve a single DeckCheckCard into a ResolvedCard by looking up
 * its data in the card database and its same-card identity.
 */
async function resolveCard(
  card: DeckCheckCard,
  isReserve: boolean
): Promise<{ resolved: ResolvedCard; warning?: DeckCheckIssue }> {
  let warning: DeckCheckIssue | undefined;

  // Step 1: Look up card data from the TSV database
  const cardData = await findCard(card.name, card.set);

  let resolved: ResolvedCard;

  if (cardData) {
    resolved = {
      name: cardData.name,
      set: cardData.set,
      quantity: card.quantity,
      isReserve,
      type: cardData.type,
      brigade: cardData.brigade,
      strength: cardData.strength,
      toughness: cardData.toughness,
      class: cardData.class,
      identifier: cardData.identifier,
      specialAbility: cardData.specialAbility,
      alignment: cardData.alignment,
      reference: cardData.reference,
      imgFile: card.imgFile ?? cardData.imgFile,
    };
  } else {
    // Card not found — create a stub with empty fields and emit a warning
    resolved = {
      name: card.name,
      set: card.set,
      quantity: card.quantity,
      isReserve,
      type: "",
      brigade: "",
      strength: "",
      toughness: "",
      class: "",
      identifier: "",
      specialAbility: "",
      alignment: "",
      reference: "",
      imgFile: card.imgFile ?? "",
    };

    warning = {
      type: "warning",
      rule: "card-not-found",
      message: `"${card.name}" (${card.set}) was not found in the card database — some rules may not apply correctly.`,
      cards: [card.name],
    };
  }

  // Step 2: Resolve same-card identity
  const identity = await resolveCardIdentity(resolved.name);
  if (identity) {
    resolved.duplicateGroupId = identity.groupId;
    resolved.canonicalName = identity.canonicalName;
  }

  return { resolved, warning };
}

/**
 * Get a high-level type category for a card. Cards with different type
 * categories are fundamentally different cards even if they share a name.
 * E.g., "Brass Serpent" the Enhancement and "Brass Serpent" the Artifact.
 *
 * For dual-type cards (e.g., "Hero/Enhancement"), the primary type wins:
 * character types take precedence over enhancement.
 */
function getTypeCategory(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("lost soul")) return "lost_soul";
  if (t.includes("dominant")) return "dominant";
  // Character types take precedence for dual-type cards like "Hero/Enhancement"
  if (t.includes("evil character")) return "evil_character";
  if (t.includes("hero")) return "hero";
  if (t.includes("artifact")) return "artifact";
  if (t.includes("fortress")) return "fortress";
  if (t.includes("covenant")) return "covenant";
  if (t.includes("curse")) return "curse";
  if (t.includes("site")) return "site";
  if (t.includes("city")) return "city";
  if (t.includes("enhancement") || t === "ge" || t === "ee") return "enhancement";
  return t || "unknown";
}

/**
 * Normalize a brigade string for comparison.
 * Lowercases, trims, sorts slash-separated parts, and deduplicates.
 */
function normalizeBrigade(brigade: string): string {
  if (!brigade || brigade.trim() === "") return "";
  const lower = brigade.toLowerCase().trim();
  if (lower === "colorless") return "";
  return lower
    .split(/[/,]/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .sort()
    .join("/");
}

/**
 * Split a card group into sub-groups when cards have fundamentally different
 * type categories or different brigades (art variants).
 *
 * This handles cases like:
 * - "Brass Serpent" Enhancement vs Artifact → different type categories → split
 * - "Panic Demon (Black)" vs "Panic Demon (Brown)" → different brigades → split
 * - Same card reprinted in same brigade → stays grouped (correct)
 *
 * Lost Souls are NOT split by brigade (they have their own grouping logic).
 */
function refineCardGroup(group: CardGroup): CardGroup[] {
  if (group.cards.length <= 1) return [group];

  const subMap = new Map<string, CardGroup>();

  for (const card of group.cards) {
    const typeCategory = getTypeCategory(card.type);
    // Split by brigade for all non-LS types (different brigades = different cards)
    // Lost Souls are handled separately by checkLostSoulAbilityLimit
    const brigade = typeCategory === "lost_soul" ? "" : normalizeBrigade(card.brigade);
    const key = `${typeCategory}::${brigade}`;

    const existing = subMap.get(key);
    if (existing) {
      existing.cards.push(card);
      existing.totalQuantity += card.quantity;
    } else {
      subMap.set(key, {
        canonicalName: card.canonicalName ?? group.canonicalName,
        groupId: group.groupId,
        cards: [card],
        totalQuantity: card.quantity,
      });
    }
  }

  // If no splitting occurred, return original group unchanged
  if (subMap.size === 1) return [group];

  return Array.from(subMap.values());
}

/**
 * Build card groups from resolved cards. Cards sharing the same
 * duplicateGroupId are grouped together. Cards without a group ID
 * get their own group keyed by their name.
 *
 * After initial grouping, groups are refined to split cards that have
 * fundamentally different type categories (e.g., Enhancement vs Artifact)
 * or different brigades (art variants of generic characters).
 */
function buildCardGroups(allCards: ResolvedCard[]): CardGroup[] {
  const groupById = new Map<number, CardGroup>();
  const groupByName = new Map<string, CardGroup>();

  for (const card of allCards) {
    if (card.duplicateGroupId != null) {
      const existing = groupById.get(card.duplicateGroupId);
      if (existing) {
        existing.cards.push(card);
        existing.totalQuantity += card.quantity;
      } else {
        groupById.set(card.duplicateGroupId, {
          canonicalName: card.canonicalName ?? card.name,
          groupId: card.duplicateGroupId,
          cards: [card],
          totalQuantity: card.quantity,
        });
      }
    } else {
      const key = card.name.toLowerCase();
      const existing = groupByName.get(key);
      if (existing) {
        existing.cards.push(card);
        existing.totalQuantity += card.quantity;
      } else {
        groupByName.set(key, {
          canonicalName: card.name,
          cards: [card],
          totalQuantity: card.quantity,
        });
      }
    }
  }

  // Refine: split groups by type category and brigade
  const rawGroups = [
    ...Array.from(groupById.values()),
    ...Array.from(groupByName.values()),
  ];

  const refined: CardGroup[] = [];
  for (const group of rawGroups) {
    refined.push(...refineCardGroup(group));
  }

  return refined;
}

/**
 * Main deck check orchestrator.
 *
 * Resolves cards against the card database, groups them by same-card
 * identity, runs Type 1 validation rules, and returns a complete result
 * with issues and stats.
 */
export async function checkDeck(
  cards: DeckCheckCard[],
  reserve: DeckCheckCard[],
  format?: string
): Promise<DeckCheckResult> {
  const resolvedFormat = format ?? "Type 1";
  const issues: DeckCheckIssue[] = [];

  // Step 1 & 2: Resolve all cards (database lookup + same-card identity)
  const mainDeckCards: ResolvedCard[] = [];
  const reserveCards: ResolvedCard[] = [];

  const resolvePromises = [
    ...cards.map(async (c) => {
      const { resolved, warning } = await resolveCard(c, false);
      mainDeckCards.push(resolved);
      if (warning) issues.push(warning);
    }),
    ...reserve.map(async (c) => {
      const { resolved, warning } = await resolveCard(c, true);
      reserveCards.push(resolved);
      if (warning) issues.push(warning);
    }),
  ];

  await Promise.all(resolvePromises);

  // Step 3: Build card groups across main deck + reserve
  const allResolvedCards = [...mainDeckCards, ...reserveCards];
  const cardGroups = buildCardGroups(allResolvedCards);

  // Step 4: Run rules based on format
  const isT2 = resolvedFormat.toLowerCase().includes("type 2") || resolvedFormat.toLowerCase().includes("multi");
  const ruleIssues = isT2
    ? validateT2Rules(mainDeckCards, reserveCards, cardGroups)
    : validateT1Rules(mainDeckCards, reserveCards, cardGroups);
  issues.push(...ruleIssues);

  // Step 5: Build stats
  const mainDeckSize = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);
  const reserveSize = reserveCards.reduce((sum, c) => sum + c.quantity, 0);

  const lostSoulCount = mainDeckCards
    .filter((c) => isLostSoul(c))
    .reduce((sum, c) => sum + c.quantity, 0);

  const requiredLostSouls = isT2
    ? getT2RequiredLostSouls(mainDeckSize)
    : getRequiredLostSouls(mainDeckSize);

  const dominantCount = allResolvedCards
    .filter((c) => isDominant(c))
    .reduce((sum, c) => sum + c.quantity, 0);

  const siteCityCount = allResolvedCards
    .filter((c) => isSiteOrCity(c))
    .reduce((sum, c) => sum + c.quantity, 0);

  const hasErrors = issues.some((i) => i.type === "error");

  return {
    valid: !hasErrors,
    format: resolvedFormat,
    issues,
    stats: {
      mainDeckSize,
      reserveSize,
      totalCards: mainDeckSize + reserveSize,
      lostSoulCount,
      requiredLostSouls,
      dominantCount,
      siteCityCount,
    },
  };
}
