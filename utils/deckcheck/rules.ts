import { ResolvedCard, DeckCheckIssue, CardGroup } from "./types";

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
  // Check name for reference text (card names often contain the reference)
  if (nameLower.includes("ii chronicles 28:13")) return true;
  // Also check the reference field directly
  if (card.reference === "II Chronicles 28:13") return true;
  if (card.reference === "Matthew 18:12") return true;
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
  return t === "site" || t === "city";
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

// ---------------------------------------------------------------------------
// Banned card definitions
// ---------------------------------------------------------------------------

interface BannedCardDef {
  name: string;
  set?: string;
  reference?: string;
  note: string;
}

const BANNED_CARDS: BannedCardDef[] = [
  { name: "Daniel", set: "Cloud of Witnesses", note: "Daniel (Cloud of Witnesses)" },
  {
    name: "Endless Treasures",
    set: "Prophecies of Christ",
    note: "Endless Treasures (Prophecies of Christ)",
  },
  {
    name: "Ephesian Widow",
    set: "Persecuted Church",
    note: "Ephesian Widow (Persecuted Church)",
  },
  {
    reference: "Proverbs 22:14",
    name: "Lost Soul",
    note: 'Lost Soul "Proverbs 22:14" (all versions)',
  },
  {
    name: "Mourn and Weep",
    set: "Prophecies of Christ",
    note: "Mourn and Weep (Prophecies of Christ)",
  },
  {
    name: "Samuel",
    set: "Rock of Ages 2011",
    note: "Samuel (Rock of Ages 2011)",
  },
  {
    name: "The Foretelling Angel",
    set: "Persecuted Church",
    note: "The Foretelling Angel (Persecuted Church)",
  },
];

function matchesBannedCard(card: ResolvedCard, ban: BannedCardDef): boolean {
  // Reference-based match (Lost Soul Proverbs 22:14)
  if (ban.reference) {
    return card.reference === ban.reference;
  }
  // Name + set match (using canonicalName for version tolerance)
  const nameMatch =
    card.name.toLowerCase() === ban.name.toLowerCase() ||
    (card.canonicalName ?? "").toLowerCase() === ban.name.toLowerCase();
  if (!nameMatch) return false;
  if (ban.set) {
    return card.set.toLowerCase() === ban.set.toLowerCase();
  }
  return true;
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
    matchSets: ["RJ", "Revelation of John"],
    maxPerFiftyBase: 4,
    note: "Faithful Witness (Revelation of John): max 4 per deck",
  },
  {
    matchName: "Locust from the Pit",
    matchSets: ["Revelation of John"],
    maxPerFiftyBase: 5,
    note: "Locust from the Pit: max 5 per 50 cards",
  },
  {
    matchName: "Legion",
    matchSets: ["Apostles", "Disciples"],
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
  const nameMatch =
    card.name.toLowerCase() === spec.matchName.toLowerCase() ||
    (card.canonicalName ?? "").toLowerCase() === spec.matchName.toLowerCase();
  if (!nameMatch) return false;
  if (spec.matchSets) {
    return spec.matchSets.some(
      (s) => card.set.toLowerCase() === s.toLowerCase()
    );
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
// Individual rule functions
// ---------------------------------------------------------------------------

/**
 * Rule: t1-deck-size — Main deck must be 50-154 cards.
 */
export function checkDeckSize(mainDeckCards: ResolvedCard[]): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const size = mainDeckCards.reduce((sum, c) => sum + c.quantity, 0);

  if (size < 50) {
    issues.push({
      type: "error",
      rule: "t1-deck-size",
      message: `Main deck has ${size} cards — minimum is 50.`,
    });
  }
  if (size > 154) {
    issues.push({
      type: "error",
      rule: "t1-deck-size",
      message: `Main deck has ${size} cards — maximum is 154.`,
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
 * Rule: t1-reserve-size — Reserve may have 0-10 cards.
 */
export function checkReserveSize(
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const size = reserveCards.reduce((sum, c) => sum + c.quantity, 0);

  if (size > 10) {
    issues.push({
      type: "error",
      rule: "t1-reserve-size",
      message: `Reserve has ${size} cards — maximum is 10.`,
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
      (c) => isMultiBrigade(c) && !isDominant(c) && !isLostSoul(c)
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
 * Rule: t1-quantity-ls-ability — Lost Souls with a special ability are limited to 1 copy each.
 *
 * Per Deck Building Rules v1.3: "Lost Souls with the same reference have the same name"
 * So we group LS by reference, not just by CardGroup identity.
 * Exception: Jeremiah 22:3 has two different LS (Foreigner and Orphans).
 */
export function checkLostSoulAbilityLimit(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  _cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const allCards = [...mainDeckCards, ...reserveCards];

  // Collect all special-ability Lost Souls
  const specialLS = allCards.filter((c) => isLostSoul(c) && hasSpecialAbility(c));

  // Group by reference — same reference = same card
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

  for (const [, group] of byReference) {
    if (group.totalQty > 1) {
      const names = [...new Set(group.cards.map((c) => c.name))];
      const displayName = names.length === 1 ? names[0] : names.join(" / ");
      issues.push({
        type: "error",
        rule: "t1-quantity-ls-ability",
        message: `"${displayName}" is a Lost Soul with a special ability — max 1 copy allowed, found ${group.totalQty}.`,
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
      issues.push({
        type: "error",
        rule: "t1-quantity-special-ability",
        message: `"${group.canonicalName}" has a special ability — max ${maxCopies} per deck (1 per 50 cards), found ${totalQty}.`,
        cards: [group.canonicalName],
      });
    }
  }

  return issues;
}

/**
 * Rule: t1-quantity-vanilla — Vanilla single-brigade Heroes, Evil Characters,
 * and Enhancements are limited to 3 copies each.
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
    if (totalQty > 3) {
      issues.push({
        type: "error",
        rule: "t1-quantity-vanilla",
        message: `"${group.canonicalName}" (vanilla, single-brigade) — max 3 copies allowed, found ${totalQty}.`,
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

/**
 * Rule: t1-banned-card — Certain cards are banned in Type 1.
 */
export function checkBannedCards(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];
  const allCards = [...mainDeckCards, ...reserveCards];

  for (const card of allCards) {
    if (card.quantity === 0) continue;
    for (const ban of BANNED_CARDS) {
      if (matchesBannedCard(card, ban)) {
        issues.push({
          type: "error",
          rule: "t1-banned-card",
          message: `"${card.name}" (${card.set}) is banned in Type 1: ${ban.note}.`,
          cards: [card.name],
        });
      }
    }
  }

  return issues;
}

/**
 * Helper: check if a card matches one of the special exception cards.
 */
function isSpecialExceptionCard(card: ResolvedCard): boolean {
  for (const spec of SPECIAL_CARDS) {
    if (matchesSpecialCard(card, spec)) return true;
  }
  // Angry Mob from Early Church
  if (
    card.name.toLowerCase() === "angry mob" &&
    card.set.toLowerCase() === "early church"
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
  for (const variant of ANGRY_MOB_VARIANTS) {
    const matchingCards = allCards.filter(
      (c) =>
        c.name.toLowerCase() === "angry mob" &&
        c.set.toLowerCase() === "early church" &&
        c.brigade.toLowerCase() === variant.brigade.toLowerCase()
    );
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
 * @param mainDeckCards  - Resolved cards in the main deck
 * @param reserveCards   - Resolved cards in the reserve
 * @param cardGroups     - Cards grouped by canonical name (across all versions)
 * @returns All issues found
 */
export function validateT1Rules(
  mainDeckCards: ResolvedCard[],
  reserveCards: ResolvedCard[],
  cardGroups: CardGroup[]
): DeckCheckIssue[] {
  const issues: DeckCheckIssue[] = [];

  // Structural rules
  issues.push(...checkDeckSize(mainDeckCards));
  issues.push(...checkLostSoulCount(mainDeckCards));
  issues.push(...checkReserveSize(reserveCards));
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

  // Banned cards
  issues.push(...checkBannedCards(mainDeckCards, reserveCards));

  // Special card exceptions
  issues.push(...checkSpecialCards(mainDeckCards, reserveCards, cardGroups));

  return issues;
}
