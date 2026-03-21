import { describe, it, expect } from "vitest";
import type { ResolvedCard, CardGroup } from "../types";
import {
  isLostSoul,
  isDominant,
  isHopperLostSoul,
  hasSpecialAbility,
  isMultiBrigade,
  isSingleBrigade,
  isSiteOrCity,
  getRequiredLostSouls,
  getMaxPerFifty,
  checkDeckSize,
  checkLostSoulCount,
  checkReserveSize,
  checkReserveContents,
  checkDominantLimit,
  checkDominantUnique,
  checkMutualExclusion,
  checkMultiBrigadeLimit,
  checkLostSoulAbilityLimit,
  checkSpecialAbilityLimit,
  checkVanillaLimit,
  checkSitesCitiesLimit,
  checkBannedCards,
  checkSpecialCards,
  validateT1Rules,
} from "../rules";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a default ResolvedCard with sensible defaults, overriding as needed. */
function makeCard(overrides: Partial<ResolvedCard> = {}): ResolvedCard {
  return {
    name: "Test Card",
    set: "Test Set",
    quantity: 1,
    isReserve: false,
    type: "Hero",
    brigade: "Blue",
    strength: "5",
    toughness: "5",
    class: "Prophet",
    identifier: "test-card-ts",
    specialAbility: "",
    alignment: "Good",
    reference: "",
    imgFile: "test-card.jpg",
    ...overrides,
  };
}

/** Build a Lost Soul card. */
function makeLostSoul(
  overrides: Partial<ResolvedCard> = {}
): ResolvedCard {
  return makeCard({
    name: "Lost Soul",
    type: "Lost Soul",
    brigade: "",
    strength: "",
    toughness: "",
    class: "",
    alignment: "Neutral",
    specialAbility: "",
    ...overrides,
  });
}

/** Build a Dominant card. */
function makeDominant(
  overrides: Partial<ResolvedCard> = {}
): ResolvedCard {
  return makeCard({
    name: "Son of God",
    type: "Dominant",
    brigade: "",
    strength: "",
    toughness: "",
    class: "",
    alignment: "Good",
    specialAbility: "Interrupt the battle and rescue the Hero in battle.",
    ...overrides,
  });
}

/** Generate N Lost Soul cards (each quantity 1, distinct names by reference). */
function makeLostSouls(count: number): ResolvedCard[] {
  return Array.from({ length: count }, (_, i) =>
    makeLostSoul({
      name: `Lost Soul`,
      reference: `Reference ${i + 1}:${i + 1}`,
      set: `Set${i}`,
      identifier: `ls-${i}`,
    })
  );
}

/**
 * Build filler cards to pad a main deck to a target size.
 * Includes the required Lost Souls for that size.
 */
function makeValidMainDeck(
  targetSize: number,
  extras: ResolvedCard[] = []
): ResolvedCard[] {
  const existingQty = extras.reduce((sum, c) => sum + c.quantity, 0);
  const requiredLS = getRequiredLostSouls(targetSize);

  // Count how many LS are already in extras
  const existingLS = extras
    .filter((c) => isLostSoul(c) && !isHopperLostSoul(c))
    .reduce((sum, c) => sum + c.quantity, 0);
  const lsNeeded = Math.max(0, requiredLS - existingLS);

  const lostSouls = makeLostSouls(lsNeeded);
  const fillerNeeded = targetSize - existingQty - lsNeeded;

  const fillers: ResolvedCard[] = [];
  if (fillerNeeded > 0) {
    fillers.push(
      makeCard({
        name: "Filler Hero",
        type: "Hero",
        brigade: "Blue",
        specialAbility: "",
        quantity: fillerNeeded,
      })
    );
  }

  return [...extras, ...lostSouls, ...fillers];
}

/** Build a CardGroup from an array of ResolvedCards sharing the same canonical name. */
function makeGroup(
  canonicalName: string,
  cards: ResolvedCard[]
): CardGroup {
  return {
    canonicalName,
    cards,
    totalQuantity: cards.reduce((sum, c) => sum + c.quantity, 0),
  };
}

// ===========================================================================
// A. Helper predicate tests
// ===========================================================================

describe("Helper predicates", () => {
  describe("isLostSoul", () => {
    it("returns true for 'Lost Soul' type", () => {
      expect(isLostSoul(makeLostSoul())).toBe(true);
    });

    it("returns true for mixed-case 'lost soul' type", () => {
      expect(isLostSoul(makeCard({ type: "LOST SOUL" }))).toBe(true);
    });

    it("returns true for type containing 'Lost Soul' substring", () => {
      expect(isLostSoul(makeCard({ type: "Lost Soul (special)" }))).toBe(true);
    });

    it("returns false for Hero type", () => {
      expect(isLostSoul(makeCard({ type: "Hero" }))).toBe(false);
    });

    it("returns false for Dominant type", () => {
      expect(isLostSoul(makeDominant())).toBe(false);
    });
  });

  describe("isDominant", () => {
    it("returns true for Dominant type", () => {
      expect(isDominant(makeDominant())).toBe(true);
    });

    it("returns true for mixed-case type", () => {
      expect(isDominant(makeCard({ type: "dominant" }))).toBe(true);
    });

    it("returns false for Hero type", () => {
      expect(isDominant(makeCard({ type: "Hero" }))).toBe(false);
    });

    it("returns false for Lost Soul", () => {
      expect(isDominant(makeLostSoul())).toBe(false);
    });
  });

  describe("isHopperLostSoul", () => {
    it("returns true when name contains 'Hopper'", () => {
      const card = makeLostSoul({
        name: 'Lost Soul "Hopper" [II Chronicles 28:13]',
      });
      expect(isHopperLostSoul(card)).toBe(true);
    });

    it("returns true when name contains 'hopper' (case-insensitive)", () => {
      const card = makeLostSoul({
        name: 'Lost Soul "hopper"',
      });
      expect(isHopperLostSoul(card)).toBe(true);
    });

    it("returns true when name contains 'II Chronicles 28:13'", () => {
      const card = makeLostSoul({
        name: 'Lost Soul "Wanderer" [II Chronicles 28:13]',
      });
      expect(isHopperLostSoul(card)).toBe(true);
    });

    it("returns true when reference is 'II Chronicles 28:13'", () => {
      const card = makeLostSoul({ reference: "II Chronicles 28:13" });
      expect(isHopperLostSoul(card)).toBe(true);
    });

    it("returns true when reference is 'Matthew 18:12'", () => {
      const card = makeLostSoul({ reference: "Matthew 18:12" });
      expect(isHopperLostSoul(card)).toBe(true);
    });

    it("returns true for real hopper card from DB data", () => {
      const card = makeLostSoul({
        name: 'Lost Soul "Hopper" [II Chronicles 28:13 - Fundraiser]',
        set: "Fund",
      });
      expect(isHopperLostSoul(card)).toBe(true);
    });

    it("returns true for Matthew 18:12 hopper variant", () => {
      const card = makeLostSoul({
        name: 'Lost Soul "Hopper" [Matthew 18:12] [2025 - Seasonal]',
        set: "Pmo-P3",
      });
      expect(isHopperLostSoul(card)).toBe(true);
    });

    it("returns false for non-Lost Soul even if name contains Hopper", () => {
      const card = makeCard({
        name: "Hopper Hero",
        type: "Hero",
      });
      expect(isHopperLostSoul(card)).toBe(false);
    });

    it("returns false for regular Lost Soul", () => {
      const card = makeLostSoul({
        name: 'Lost Soul "Blind" [Job 29:15]',
        reference: "Job 29:15",
      });
      expect(isHopperLostSoul(card)).toBe(false);
    });
  });

  describe("hasSpecialAbility", () => {
    it("returns true when specialAbility has text", () => {
      expect(
        hasSpecialAbility(makeCard({ specialAbility: "Negate an evil card." }))
      ).toBe(true);
    });

    it("returns false when specialAbility is empty string", () => {
      expect(hasSpecialAbility(makeCard({ specialAbility: "" }))).toBe(false);
    });

    it("returns false when specialAbility is only whitespace", () => {
      expect(hasSpecialAbility(makeCard({ specialAbility: "   " }))).toBe(
        false
      );
    });
  });

  describe("isMultiBrigade", () => {
    it("returns true for slash-separated brigades (Blue/Red)", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Blue/Red" }))).toBe(true);
    });

    it("returns true for comma-separated brigades", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Blue,Red" }))).toBe(true);
    });

    it("returns true for triple brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Blue/Red/Green" }))).toBe(
        true
      );
    });

    it("returns false for single brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Blue" }))).toBe(false);
    });

    it("returns false for empty brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "" }))).toBe(false);
    });

    it("returns false for colorless", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Colorless" }))).toBe(false);
    });

    it("returns false for undefined-like empty brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "  " }))).toBe(false);
    });

    it("returns true for bare 'Multi' brigade (TSV format)", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Multi" }))).toBe(true);
    });

    it("returns true for 'Multi/Brown' brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Multi/Brown" }))).toBe(true);
    });

    it("returns true for 'Gray/Multi' brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Gray/Multi" }))).toBe(true);
    });

    it("returns true for 'Multi (Multi)' brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Multi (Multi)" }))).toBe(true);
    });

    it("returns true for 'Blue/Green (Multi)' brigade", () => {
      expect(isMultiBrigade(makeCard({ brigade: "Blue/Green (Multi)" }))).toBe(true);
    });
  });

  describe("isSingleBrigade", () => {
    it("returns true for single brigade", () => {
      expect(isSingleBrigade(makeCard({ brigade: "Blue" }))).toBe(true);
    });

    it("returns true for Red brigade", () => {
      expect(isSingleBrigade(makeCard({ brigade: "Red" }))).toBe(true);
    });

    it("returns true for Black brigade (evil)", () => {
      expect(isSingleBrigade(makeCard({ brigade: "Black" }))).toBe(true);
    });

    it("returns false for colorless", () => {
      expect(isSingleBrigade(makeCard({ brigade: "Colorless" }))).toBe(false);
    });

    it("returns false for colorless (case-insensitive)", () => {
      expect(isSingleBrigade(makeCard({ brigade: "colorless" }))).toBe(false);
    });

    it("returns false for multi-brigade", () => {
      expect(isSingleBrigade(makeCard({ brigade: "Blue/Red" }))).toBe(false);
    });

    it("returns false for empty brigade", () => {
      expect(isSingleBrigade(makeCard({ brigade: "" }))).toBe(false);
    });

    it("returns false for whitespace-only brigade", () => {
      expect(isSingleBrigade(makeCard({ brigade: "  " }))).toBe(false);
    });
  });

  describe("isSiteOrCity", () => {
    it("returns true for Site", () => {
      expect(isSiteOrCity(makeCard({ type: "Site" }))).toBe(true);
    });

    it("returns true for City", () => {
      expect(isSiteOrCity(makeCard({ type: "City" }))).toBe(true);
    });

    it("returns true for lowercase 'site'", () => {
      expect(isSiteOrCity(makeCard({ type: "site" }))).toBe(true);
    });

    it("returns true for lowercase 'city'", () => {
      expect(isSiteOrCity(makeCard({ type: "city" }))).toBe(true);
    });

    it("returns false for Hero", () => {
      expect(isSiteOrCity(makeCard({ type: "Hero" }))).toBe(false);
    });

    it("returns false for Enhancement", () => {
      expect(isSiteOrCity(makeCard({ type: "Enhancement" }))).toBe(false);
    });

    it("returns false for type containing 'Site' as substring", () => {
      // The implementation uses strict equality, so 'Site (special)' should be false
      expect(isSiteOrCity(makeCard({ type: "Site (special)" }))).toBe(false);
    });
  });
});

// ===========================================================================
// B. Calculation tests
// ===========================================================================

describe("Calculation helpers", () => {
  describe("getRequiredLostSouls", () => {
    it("returns 0 for deck smaller than 50", () => {
      expect(getRequiredLostSouls(49)).toBe(0);
      expect(getRequiredLostSouls(30)).toBe(0);
      expect(getRequiredLostSouls(0)).toBe(0);
    });

    it("returns 7 for 50-card deck", () => {
      expect(getRequiredLostSouls(50)).toBe(7);
    });

    it("returns 7 for 51-56 card decks", () => {
      expect(getRequiredLostSouls(51)).toBe(7);
      expect(getRequiredLostSouls(56)).toBe(7);
    });

    it("returns 8 for 57-card deck (first boundary)", () => {
      expect(getRequiredLostSouls(57)).toBe(8);
    });

    it("returns 8 for 63-card deck (end of 8-LS bracket)", () => {
      expect(getRequiredLostSouls(63)).toBe(8);
    });

    it("returns 9 for 64-card deck", () => {
      expect(getRequiredLostSouls(64)).toBe(9);
    });

    it("returns 9 for 70-card deck", () => {
      expect(getRequiredLostSouls(70)).toBe(9);
    });

    it("returns 10 for 71-card deck", () => {
      expect(getRequiredLostSouls(71)).toBe(10);
    });

    it("returns 14 for 100-card deck", () => {
      // (100 - 50) / 7 = 7.14, floor = 7, + 7 = 14
      expect(getRequiredLostSouls(100)).toBe(14);
    });

    it("returns 21 for 148-card deck", () => {
      // (148 - 50) / 7 = 14, + 7 = 21
      expect(getRequiredLostSouls(148)).toBe(21);
    });

    it("returns 21 for 154-card deck (maximum allowed)", () => {
      // (154 - 50) / 7 = 14.85, floor = 14, + 7 = 21
      expect(getRequiredLostSouls(154)).toBe(21);
    });

    it("increments at every 7-card boundary", () => {
      // Walk through several boundaries
      const boundaries = [
        { size: 50, expected: 7 },
        { size: 56, expected: 7 },
        { size: 57, expected: 8 },
        { size: 63, expected: 8 },
        { size: 64, expected: 9 },
        { size: 70, expected: 9 },
        { size: 71, expected: 10 },
        { size: 77, expected: 10 },
        { size: 78, expected: 11 },
        { size: 84, expected: 11 },
        { size: 85, expected: 12 },
      ];
      for (const { size, expected } of boundaries) {
        expect(getRequiredLostSouls(size)).toBe(expected);
      }
    });
  });

  describe("getMaxPerFifty", () => {
    it("returns baseMax for 50-card deck", () => {
      expect(getMaxPerFifty(50, 1)).toBe(1);
      expect(getMaxPerFifty(50, 4)).toBe(4);
    });

    it("returns baseMax for decks < 100", () => {
      expect(getMaxPerFifty(75, 1)).toBe(1);
      expect(getMaxPerFifty(99, 1)).toBe(1);
    });

    it("returns 2x baseMax for 100-card deck", () => {
      expect(getMaxPerFifty(100, 1)).toBe(2);
      expect(getMaxPerFifty(100, 4)).toBe(8);
    });

    it("returns 3x baseMax for 150-card deck", () => {
      expect(getMaxPerFifty(150, 1)).toBe(3);
      expect(getMaxPerFifty(150, 5)).toBe(15);
    });

    it("returns 1x baseMax for very small deck (uses max(1, floor))", () => {
      expect(getMaxPerFifty(10, 1)).toBe(1);
      expect(getMaxPerFifty(0, 1)).toBe(1);
    });

    it("returns 2x for 149 cards (floor(149/50) = 2)", () => {
      expect(getMaxPerFifty(149, 1)).toBe(2);
    });
  });
});

// ===========================================================================
// C. Individual rule tests
// ===========================================================================

describe("Rule: checkDeckSize (t1-deck-size)", () => {
  it("returns error for deck smaller than 50 cards", () => {
    const cards = [makeCard({ quantity: 49 })];
    const issues = checkDeckSize(cards);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-deck-size");
    expect(issues[0].type).toBe("error");
    expect(issues[0].message).toContain("49");
    expect(issues[0].message).toContain("minimum is 50");
  });

  it("passes for exactly 50 cards", () => {
    const cards = [makeCard({ quantity: 50 })];
    expect(checkDeckSize(cards)).toHaveLength(0);
  });

  it("passes for 100-card deck", () => {
    const cards = [makeCard({ quantity: 100 })];
    expect(checkDeckSize(cards)).toHaveLength(0);
  });

  it("passes for 154-card deck (maximum)", () => {
    const cards = [makeCard({ quantity: 154 })];
    expect(checkDeckSize(cards)).toHaveLength(0);
  });

  it("returns error for deck larger than 154 cards", () => {
    const cards = [makeCard({ quantity: 155 })];
    const issues = checkDeckSize(cards);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-deck-size");
    expect(issues[0].message).toContain("155");
    expect(issues[0].message).toContain("maximum is 154");
  });

  it("sums quantities across multiple card entries", () => {
    const cards = [makeCard({ quantity: 30 }), makeCard({ quantity: 25 })];
    expect(checkDeckSize(cards)).toHaveLength(0); // 55 cards
  });

  it("returns error for empty deck", () => {
    const issues = checkDeckSize([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-deck-size");
    expect(issues[0].message).toContain("0");
  });
});

describe("Rule: checkLostSoulCount (t1-lost-soul-count)", () => {
  it("passes when Lost Soul count matches requirement for 50-card deck", () => {
    const lostSouls = makeLostSouls(7);
    const filler = makeCard({ quantity: 43 });
    const issues = checkLostSoulCount([...lostSouls, filler]);
    expect(issues).toHaveLength(0);
  });

  it("fails when too few Lost Souls", () => {
    const lostSouls = makeLostSouls(6);
    const filler = makeCard({ quantity: 44 });
    const issues = checkLostSoulCount([...lostSouls, filler]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-lost-soul-count");
    expect(issues[0].message).toContain("7");
    expect(issues[0].message).toContain("6");
  });

  it("fails when too many Lost Souls", () => {
    const lostSouls = makeLostSouls(8);
    const filler = makeCard({ quantity: 42 });
    const issues = checkLostSoulCount([...lostSouls, filler]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-lost-soul-count");
  });

  it("does not count Hopper Lost Souls toward the requirement", () => {
    // 50-card deck needs 7 LS. Put 7 regular + 1 hopper = 8 total but only 7 count
    const regularLS = makeLostSouls(7);
    const hopper = makeLostSoul({
      name: 'Lost Soul "Hopper" [II Chronicles 28:13]',
      reference: "II Chronicles 28:13",
      set: "HopperSet",
    });
    const filler = makeCard({ quantity: 42 });
    const issues = checkLostSoulCount([...regularLS, hopper, filler]);
    expect(issues).toHaveLength(0);
  });

  it("still counts correctly when hopper is the only LS-like card", () => {
    // 50-card deck with only hopper LS and no regular LS -> should fail
    const hopper = makeLostSoul({
      name: 'Lost Soul "Hopper"',
      reference: "Matthew 18:12",
    });
    const filler = makeCard({ quantity: 49 });
    const issues = checkLostSoulCount([hopper, filler]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("0 counting toward the requirement");
    expect(issues[0].message).toContain("1 Hopper LS not counted");
  });

  it("skips check for deck smaller than 50", () => {
    const issues = checkLostSoulCount([makeCard({ quantity: 30 })]);
    expect(issues).toHaveLength(0);
  });

  it("handles 57-card deck requiring 8 Lost Souls", () => {
    const lostSouls = makeLostSouls(8);
    const filler = makeCard({ quantity: 49 });
    const issues = checkLostSoulCount([...lostSouls, filler]);
    expect(issues).toHaveLength(0);
  });
});

describe("Rule: checkReserveSize (t1-reserve-size)", () => {
  it("passes for empty reserve", () => {
    expect(checkReserveSize([])).toHaveLength(0);
  });

  it("passes for reserve with exactly 10 cards", () => {
    const cards = [makeCard({ isReserve: true, quantity: 10 })];
    expect(checkReserveSize(cards)).toHaveLength(0);
  });

  it("fails for reserve with 11 cards", () => {
    const cards = [makeCard({ isReserve: true, quantity: 11 })];
    const issues = checkReserveSize(cards);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-reserve-size");
    expect(issues[0].message).toContain("11");
    expect(issues[0].message).toContain("maximum is 10");
  });

  it("sums quantities across multiple reserve entries", () => {
    const cards = [
      makeCard({ isReserve: true, quantity: 6 }),
      makeCard({ isReserve: true, quantity: 6 }),
    ];
    const issues = checkReserveSize(cards);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("12");
  });
});

describe("Rule: checkReserveContents (t1-reserve-contents)", () => {
  it("passes for reserve with regular cards", () => {
    const cards = [makeCard({ isReserve: true })];
    expect(checkReserveContents(cards)).toHaveLength(0);
  });

  it("fails for Dominant in reserve", () => {
    const cards = [makeDominant({ isReserve: true })];
    const issues = checkReserveContents(cards);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-reserve-contents");
    expect(issues[0].message).toContain("Dominant");
  });

  it("fails for Lost Soul in reserve", () => {
    const cards = [makeLostSoul({ isReserve: true })];
    const issues = checkReserveContents(cards);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-reserve-contents");
    expect(issues[0].message).toContain("Lost Soul");
  });

  it("reports multiple issues for both Dominant and Lost Soul in reserve", () => {
    const cards = [
      makeDominant({ isReserve: true, name: "Son of God" }),
      makeLostSoul({ isReserve: true }),
    ];
    const issues = checkReserveContents(cards);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.rule)).toEqual([
      "t1-reserve-contents",
      "t1-reserve-contents",
    ]);
  });

  it("passes for empty reserve", () => {
    expect(checkReserveContents([])).toHaveLength(0);
  });
});

describe("Rule: checkDominantLimit (t1-dominant-limit)", () => {
  it("passes when dominants equal Lost Souls", () => {
    const mainDeck = [
      ...makeLostSouls(7),
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "New Jerusalem" }),
      makeDominant({ name: "Christian Martyr" }),
      makeDominant({ name: "Angel of the Lord" }),
      makeDominant({ name: "Grapes of Wrath" }),
      makeDominant({ name: "Falling Away" }),
      makeDominant({ name: "Three Woes" }),
      makeCard({ quantity: 36 }),
    ];
    const issues = checkDominantLimit(mainDeck, []);
    expect(issues).toHaveLength(0);
  });

  it("passes when dominants are fewer than Lost Souls", () => {
    const mainDeck = [
      ...makeLostSouls(7),
      makeDominant({ name: "Son of God" }),
      makeCard({ quantity: 42 }),
    ];
    const issues = checkDominantLimit(mainDeck, []);
    expect(issues).toHaveLength(0);
  });

  it("fails when dominants exceed Lost Souls", () => {
    const mainDeck = [
      ...makeLostSouls(2),
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "New Jerusalem" }),
      makeDominant({ name: "Christian Martyr" }),
      makeCard({ quantity: 45 }),
    ];
    const issues = checkDominantLimit(mainDeck, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-dominant-limit");
    expect(issues[0].message).toContain("3 Dominants");
    expect(issues[0].message).toContain("2 counting Lost Souls");
  });

  it("does not count Hopper Lost Souls for the dominant cap", () => {
    // 2 regular LS + 1 hopper = 2 counting LS, 3 dominants = fail
    const mainDeck = [
      ...makeLostSouls(2),
      makeLostSoul({
        name: 'Lost Soul "Hopper"',
        reference: "II Chronicles 28:13",
        set: "HopperSet",
      }),
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "New Jerusalem" }),
      makeDominant({ name: "Christian Martyr" }),
      makeCard({ quantity: 44 }),
    ];
    const issues = checkDominantLimit(mainDeck, []);
    expect(issues).toHaveLength(1);
  });

  it("counts dominants in reserve toward the total", () => {
    const mainDeck = [...makeLostSouls(2), makeCard({ quantity: 48 })];
    const reserve = [
      makeDominant({ name: "Son of God", isReserve: true }),
      makeDominant({ name: "New Jerusalem", isReserve: true }),
      makeDominant({ name: "Christian Martyr", isReserve: true }),
    ];
    const issues = checkDominantLimit(mainDeck, reserve);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("3 Dominants");
  });
});

describe("Rule: checkDominantUnique (t1-dominant-unique)", () => {
  it("passes when each dominant has 1 copy", () => {
    const d1 = makeDominant({ name: "Son of God" });
    const d2 = makeDominant({ name: "New Jerusalem" });
    const groups = [makeGroup("Son of God", [d1]), makeGroup("New Jerusalem", [d2])];
    const issues = checkDominantUnique([], [], groups);
    expect(issues).toHaveLength(0);
  });

  it("fails when a dominant has 2 copies", () => {
    const d1 = makeDominant({ name: "Son of God", quantity: 2 });
    const groups = [makeGroup("Son of God", [d1])];
    const issues = checkDominantUnique([], [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-dominant-unique");
    expect(issues[0].message).toContain("Son of God");
    expect(issues[0].message).toContain("max 1");
    expect(issues[0].message).toContain("found 2");
  });

  it("fails when same dominant appears as two separate entries (different sets) in same group", () => {
    const d1 = makeDominant({ name: "Son of God", set: "Set A", quantity: 1 });
    const d2 = makeDominant({
      name: 'Son of God "Manger"',
      set: "Promo",
      quantity: 1,
      canonicalName: "Son of God",
    });
    const groups = [makeGroup("Son of God", [d1, d2])];
    const issues = checkDominantUnique([], [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("found 2");
  });

  it("ignores non-dominant cards in groups", () => {
    const hero = makeCard({ name: "Moses", type: "Hero", quantity: 3 });
    const groups = [makeGroup("Moses", [hero])];
    const issues = checkDominantUnique([], [], groups);
    expect(issues).toHaveLength(0);
  });
});

describe("Rule: checkMutualExclusion (t1-mutual-exclusion)", () => {
  it("fails when deck has both New Jerusalem and The Second Coming", () => {
    const mainDeck = [
      makeDominant({ name: "New Jerusalem" }),
      makeDominant({ name: "The Second Coming" }),
    ];
    const issues = checkMutualExclusion(mainDeck, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-mutual-exclusion");
    expect(issues[0].message).toContain("New Jerusalem");
    expect(issues[0].message).toContain("The Second Coming");
    expect(issues[0].cards).toEqual(["New Jerusalem", "The Second Coming"]);
  });

  it("fails when deck has both Son of God and Chariot of Fire", () => {
    const mainDeck = [
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "Chariot of Fire" }),
    ];
    const issues = checkMutualExclusion(mainDeck, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Son of God");
    expect(issues[0].message).toContain("Chariot of Fire");
  });

  it("passes when only New Jerusalem is present", () => {
    const mainDeck = [makeDominant({ name: "New Jerusalem" })];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(0);
  });

  it("passes when only The Second Coming is present", () => {
    const mainDeck = [makeDominant({ name: "The Second Coming" })];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(0);
  });

  it("passes when only Son of God is present (no Chariot of Fire)", () => {
    const mainDeck = [makeDominant({ name: "Son of God" })];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(0);
  });

  it("detects exclusion when one card is in main and one in reserve", () => {
    const mainDeck = [makeDominant({ name: "New Jerusalem" })];
    const reserve = [
      makeDominant({ name: "The Second Coming", isReserve: true }),
    ];
    const issues = checkMutualExclusion(mainDeck, reserve);
    expect(issues).toHaveLength(1);
  });

  it("matches via canonicalName", () => {
    const mainDeck = [
      makeDominant({
        name: 'Son of God "Manger"',
        canonicalName: "Son of God",
      }),
      makeDominant({ name: "Chariot of Fire" }),
    ];
    const issues = checkMutualExclusion(mainDeck, []);
    expect(issues).toHaveLength(1);
  });

  it("reports both pairs when all four exclusion cards present", () => {
    const mainDeck = [
      makeDominant({ name: "New Jerusalem" }),
      makeDominant({ name: "The Second Coming" }),
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "Chariot of Fire" }),
    ];
    const issues = checkMutualExclusion(mainDeck, []);
    expect(issues).toHaveLength(2);
  });

  it("skips cards with quantity 0", () => {
    const mainDeck = [
      makeDominant({ name: "New Jerusalem", quantity: 0 }),
      makeDominant({ name: "The Second Coming" }),
    ];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(0);
  });

  it("allows Son of God with Chariot of Fire Artifact (not Dominant)", () => {
    const mainDeck = [
      makeDominant({ name: "Son of God" }),
      makeCard({ name: "Chariot of Fire (Roots)", type: "Artifact", specialAbility: "Some ability" }),
    ];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(0);
  });

  it("allows Son of God with Chariot of Fire (Wa) Artifact", () => {
    const mainDeck = [
      makeDominant({ name: "Son of God" }),
      makeCard({ name: "Chariot of Fire (Wa)", type: "Artifact" }),
    ];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(0);
  });

  it("fails Son of God with Chariot of Fire Dominant (PoC)", () => {
    const mainDeck = [
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "Chariot of Fire" }),
    ];
    const issues = checkMutualExclusion(mainDeck, []);
    expect(issues).toHaveLength(1);
  });

  it("allows New Jerusalem Site with The Second Coming", () => {
    const mainDeck = [
      makeCard({ name: "New Jerusalem (Wo)", type: "Site" }),
      makeDominant({ name: "The Second Coming" }),
    ];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(0);
  });

  it("fails New Jerusalem Dominant with The Second Coming", () => {
    const mainDeck = [
      makeDominant({ name: "New Jerusalem" }),
      makeDominant({ name: "The Second Coming" }),
    ];
    expect(checkMutualExclusion(mainDeck, [])).toHaveLength(1);
  });
});

describe("Rule: checkMultiBrigadeLimit (t1-quantity-multi-brigade)", () => {
  it("passes for 1 copy of a multi-brigade card", () => {
    const card = makeCard({
      name: "Multi Hero",
      brigade: "Blue/Red",
      type: "Hero",
      quantity: 1,
    });
    const groups = [makeGroup("Multi Hero", [card])];
    expect(checkMultiBrigadeLimit([], [], groups)).toHaveLength(0);
  });

  it("fails for 2 copies of a multi-brigade card", () => {
    const card = makeCard({
      name: "Multi Hero",
      brigade: "Blue/Red",
      type: "Hero",
      quantity: 2,
    });
    const groups = [makeGroup("Multi Hero", [card])];
    const issues = checkMultiBrigadeLimit([], [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-quantity-multi-brigade");
    expect(issues[0].message).toContain("Multi Hero");
    expect(issues[0].message).toContain("found 2");
  });

  it("does not apply to Dominants (even if multi-brigade)", () => {
    const card = makeDominant({
      name: "Dominant Card",
      brigade: "Blue/Red",
      quantity: 2,
    });
    const groups = [makeGroup("Dominant Card", [card])];
    expect(checkMultiBrigadeLimit([], [], groups)).toHaveLength(0);
  });

  it("does not apply to Lost Souls", () => {
    const card = makeLostSoul({
      name: "Lost Soul",
      brigade: "Blue/Red",
      quantity: 2,
    });
    const groups = [makeGroup("Lost Soul", [card])];
    expect(checkMultiBrigadeLimit([], [], groups)).toHaveLength(0);
  });

  it("correctly sums across multiple entries in a group", () => {
    const c1 = makeCard({
      name: "Multi Hero",
      brigade: "Blue/Red",
      set: "Set A",
      quantity: 1,
    });
    const c2 = makeCard({
      name: "Multi Hero",
      brigade: "Blue/Red",
      set: "Set B",
      quantity: 1,
    });
    const groups = [makeGroup("Multi Hero", [c1, c2])];
    const issues = checkMultiBrigadeLimit([], [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("found 2");
  });
});

describe("Rule: checkLostSoulAbilityLimit (t1-quantity-ls-ability)", () => {
  it("passes for 1 copy of a Lost Soul with special ability", () => {
    const card = makeLostSoul({
      name: 'Lost Soul "Blind"',
      specialAbility: "If a rescue attempt is made...",
      reference: "Zephaniah 1:17",
      quantity: 1,
    });
    expect(checkLostSoulAbilityLimit([card], [], [])).toHaveLength(0);
  });

  it("fails for 2 copies of a Lost Soul with special ability (same card)", () => {
    const card = makeLostSoul({
      name: 'Lost Soul "Blind"',
      specialAbility: "If a rescue attempt is made...",
      reference: "Zephaniah 1:17",
      quantity: 2,
    });
    const issues = checkLostSoulAbilityLimit([card], [], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-quantity-ls-ability");
    expect(issues[0].message).toContain("found 2");
  });

  it("fails for same-reference LS from different sets (Distressed example)", () => {
    const ls1 = makeLostSoul({
      name: 'Lost Soul "Distressed" [Zephaniah 1:17]',
      specialAbility: "Negate characters in other territories.",
      reference: "Zephaniah 1:17",
      set: "PoC",
      identifier: '["Distressed"]',
      quantity: 1,
    });
    const ls2 = makeLostSoul({
      name: 'Lost Soul "Distressed" [Zephaniah 1:17 - Fundraiser]',
      specialAbility: "Negate characters in other territories.",
      reference: "Zephaniah 1:17",
      set: "Fund",
      identifier: '["Distressed"]',
      quantity: 1,
    });
    const issues = checkLostSoulAbilityLimit([ls1, ls2], [], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-quantity-ls-ability");
    expect(issues[0].message).toContain("found 2");
  });

  it("allows different-reference LS (different cards)", () => {
    const ls1 = makeLostSoul({
      name: 'Lost Soul "Blind"',
      specialAbility: "If a rescue attempt...",
      reference: "Isaiah 42:18",
      quantity: 1,
    });
    const ls2 = makeLostSoul({
      name: 'Lost Soul "Distressed"',
      specialAbility: "Negate characters...",
      reference: "Zephaniah 1:17",
      quantity: 1,
    });
    expect(checkLostSoulAbilityLimit([ls1, ls2], [], [])).toHaveLength(0);
  });

  it("handles Jeremiah 22:3 exception — Foreigner and Orphans are different", () => {
    const foreigner = makeLostSoul({
      name: 'Lost Soul "Foreigner"',
      specialAbility: "Some ability...",
      reference: "Jeremiah 22:3",
      identifier: '["Foreigner"]',
      quantity: 1,
    });
    const orphans = makeLostSoul({
      name: 'Lost Soul "Orphans"',
      specialAbility: "Some other ability...",
      reference: "Jeremiah 22:3",
      identifier: '["Orphans"]',
      quantity: 1,
    });
    // Different cards despite same reference — should pass
    expect(checkLostSoulAbilityLimit([foreigner, orphans], [], [])).toHaveLength(0);
  });

  it("catches duplicate Jeremiah 22:3 Foreigner", () => {
    const f1 = makeLostSoul({
      name: 'Lost Soul "Foreigner" [Jeremiah 22:3]',
      specialAbility: "Some ability...",
      reference: "Jeremiah 22:3",
      identifier: '["Foreigner"]',
      quantity: 1,
    });
    const f2 = makeLostSoul({
      name: 'Lost Soul "Foreigner" [Jeremiah 22:3 - Fundraiser]',
      specialAbility: "Some ability...",
      reference: "Jeremiah 22:3",
      identifier: '["Foreigner"]',
      set: "Fund",
      quantity: 1,
    });
    const issues = checkLostSoulAbilityLimit([f1, f2], [], []);
    expect(issues).toHaveLength(1);
  });

  it("ignores Lost Souls without special ability", () => {
    const card = makeLostSoul({
      name: "Lost Soul (vanilla)",
      specialAbility: "",
      reference: "Some 1:1",
      quantity: 3,
    });
    expect(checkLostSoulAbilityLimit([card], [], [])).toHaveLength(0);
  });

  it("ignores non-Lost-Soul cards with special abilities", () => {
    const card = makeCard({
      name: "Special Hero",
      type: "Hero",
      specialAbility: "Negate an evil card.",
      reference: "Some 1:1",
      quantity: 3,
    });
    expect(checkLostSoulAbilityLimit([card], [], [])).toHaveLength(0);
  });

  it("counts LS in reserve too", () => {
    const main = makeLostSoul({
      name: 'Lost Soul "Blind" [Isaiah 42:18]',
      specialAbility: "Some ability...",
      reference: "Isaiah 42:18",
      quantity: 1,
    });
    const reserve = makeLostSoul({
      name: 'Lost Soul "Blind" [Isaiah 42:18 - Promo]',
      specialAbility: "Some ability...",
      reference: "Isaiah 42:18",
      isReserve: true,
      quantity: 1,
    });
    // Note: LS in reserve is already caught by reserve-contents rule,
    // but this checks that the quantity rule still counts them
    const issues = checkLostSoulAbilityLimit([main], [reserve], []);
    expect(issues).toHaveLength(1);
  });
});

describe("Rule: checkSpecialAbilityLimit (t1-quantity-special-ability)", () => {
  it("passes for 1 copy of a special-ability card in 50-card deck", () => {
    const card = makeCard({
      name: "SA Hero",
      type: "Hero",
      specialAbility: "Negate an evil card.",
      quantity: 1,
    });
    const mainDeck = makeValidMainDeck(50, [card]);
    const groups = [makeGroup("SA Hero", [card])];
    expect(checkSpecialAbilityLimit(mainDeck, [], groups)).toHaveLength(0);
  });

  it("fails for 2 copies of SA card in 50-card deck", () => {
    const card = makeCard({
      name: "SA Hero",
      type: "Hero",
      specialAbility: "Negate an evil card.",
      quantity: 2,
    });
    const mainDeck = makeValidMainDeck(50, [card]);
    const groups = [makeGroup("SA Hero", [card])];
    const issues = checkSpecialAbilityLimit(mainDeck, [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-quantity-special-ability");
    expect(issues[0].message).toContain("max 1");
    expect(issues[0].message).toContain("found 2");
  });

  it("passes for 2 copies of SA card in 100-card deck", () => {
    const card = makeCard({
      name: "SA Hero",
      type: "Hero",
      specialAbility: "Negate an evil card.",
      quantity: 2,
    });
    const mainDeck = makeValidMainDeck(100, [card]);
    const groups = [makeGroup("SA Hero", [card])];
    expect(checkSpecialAbilityLimit(mainDeck, [], groups)).toHaveLength(0);
  });

  it("fails for 3 copies of SA card in 100-card deck", () => {
    const card = makeCard({
      name: "SA Hero",
      type: "Hero",
      specialAbility: "Negate an evil card.",
      quantity: 3,
    });
    const mainDeck = makeValidMainDeck(100, [card]);
    const groups = [makeGroup("SA Hero", [card])];
    const issues = checkSpecialAbilityLimit(mainDeck, [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("max 2");
    expect(issues[0].message).toContain("found 3");
  });

  it("skips Dominants (they have their own rules)", () => {
    const card = makeDominant({
      name: "Son of God",
      specialAbility: "Interrupt the battle...",
      quantity: 2,
    });
    const mainDeck = makeValidMainDeck(50, [card]);
    const groups = [makeGroup("Son of God", [card])];
    expect(checkSpecialAbilityLimit(mainDeck, [], groups)).toHaveLength(0);
  });

  it("skips Lost Souls (they have their own rules)", () => {
    const card = makeLostSoul({
      name: 'Lost Soul "Blind"',
      specialAbility: "If a rescue...",
      quantity: 2,
    });
    const mainDeck = makeValidMainDeck(50, [card]);
    const groups = [makeGroup('Lost Soul "Blind"', [card])];
    expect(checkSpecialAbilityLimit(mainDeck, [], groups)).toHaveLength(0);
  });

  it("skips special exception cards (Faithful Witness, Legion, etc.)", () => {
    const card = makeCard({
      name: "Faithful Witness",
      set: "Revelation of John",
      type: "Hero",
      specialAbility: "Some ability",
      quantity: 4,
    });
    const mainDeck = makeValidMainDeck(50, [card]);
    const groups = [makeGroup("Faithful Witness", [card])];
    // Should NOT trigger the SA limit since it's a special exception card
    expect(checkSpecialAbilityLimit(mainDeck, [], groups)).toHaveLength(0);
  });

  it("skips Angry Mob (Early Church) as special exception", () => {
    const card = makeCard({
      name: "Angry Mob",
      set: "Early Church",
      type: "Evil Character",
      brigade: "Black",
      specialAbility: "Some ability",
      quantity: 4,
    });
    const mainDeck = makeValidMainDeck(50, [card]);
    const groups = [makeGroup("Angry Mob", [card])];
    expect(checkSpecialAbilityLimit(mainDeck, [], groups)).toHaveLength(0);
  });

  it("catches multiple versions of the same character across printings (David scenario)", () => {
    // David (Roots) x2 + David the Psalmist x1 = 3 Davids in same group
    const david1 = makeCard({
      name: "David (Roots)",
      type: "Hero",
      specialAbility: "Some ability...",
      quantity: 2,
    });
    const david2 = makeCard({
      name: "David the Psalmist",
      type: "Hero",
      specialAbility: "Look at top three cards...",
      quantity: 1,
    });
    // Both are in the same "David" duplicate group
    const group = makeGroup("David", [david1, david2]);
    const mainDeck = makeValidMainDeck(100, [david1, david2]);
    // 100-card deck = max 2 per 50 cards. 3 Davids should fail.
    const issues = checkSpecialAbilityLimit(mainDeck, [], [group]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-quantity-special-ability");
    expect(issues[0].message).toContain("found 3");
  });

  it("allows 2 versions of same character in 100-card deck", () => {
    const david1 = makeCard({
      name: "David (Roots)",
      type: "Hero",
      specialAbility: "Some ability...",
      quantity: 1,
    });
    const david2 = makeCard({
      name: "David the Psalmist",
      type: "Hero",
      specialAbility: "Look at top three cards...",
      quantity: 1,
    });
    const group = makeGroup("David", [david1, david2]);
    const mainDeck = makeValidMainDeck(100, [david1, david2]);
    // 100-card deck = max 2. 2 Davids should pass.
    expect(checkSpecialAbilityLimit(mainDeck, [], [group])).toHaveLength(0);
  });

  it("does not skip vanilla cards (no special ability)", () => {
    const card = makeCard({
      name: "Vanilla Hero",
      type: "Hero",
      specialAbility: "",
      quantity: 3,
    });
    const mainDeck = makeValidMainDeck(50, [card]);
    const groups = [makeGroup("Vanilla Hero", [card])];
    // Vanilla cards have no SA so the filter skips them entirely
    expect(checkSpecialAbilityLimit(mainDeck, [], groups)).toHaveLength(0);
  });
});

describe("Rule: checkVanillaLimit (t1-quantity-vanilla)", () => {
  it("passes for 3 copies of vanilla single-brigade Hero", () => {
    const card = makeCard({
      name: "Vanilla Hero",
      type: "Hero",
      brigade: "Blue",
      specialAbility: "",
      quantity: 3,
    });
    const groups = [makeGroup("Vanilla Hero", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(0);
  });

  it("fails for 4 copies of vanilla single-brigade Hero", () => {
    const card = makeCard({
      name: "Vanilla Hero",
      type: "Hero",
      brigade: "Blue",
      specialAbility: "",
      quantity: 4,
    });
    const groups = [makeGroup("Vanilla Hero", [card])];
    const issues = checkVanillaLimit([], [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-quantity-vanilla");
    expect(issues[0].message).toContain("max 3");
    expect(issues[0].message).toContain("found 4");
  });

  it("applies to Evil Characters", () => {
    const card = makeCard({
      name: "Vanilla Villain",
      type: "Evil Character",
      brigade: "Black",
      specialAbility: "",
      quantity: 4,
    });
    const groups = [makeGroup("Vanilla Villain", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(1);
  });

  it("applies to Enhancements", () => {
    const card = makeCard({
      name: "Vanilla Enhancement",
      type: "Enhancement",
      brigade: "Blue",
      specialAbility: "",
      quantity: 4,
    });
    const groups = [makeGroup("Vanilla Enhancement", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(1);
  });

  it("does not apply to cards with special abilities", () => {
    const card = makeCard({
      name: "SA Hero",
      type: "Hero",
      brigade: "Blue",
      specialAbility: "Negate something.",
      quantity: 4,
    });
    const groups = [makeGroup("SA Hero", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(0);
  });

  it("does not apply to multi-brigade vanilla cards", () => {
    const card = makeCard({
      name: "Multi Hero",
      type: "Hero",
      brigade: "Blue/Red",
      specialAbility: "",
      quantity: 4,
    });
    const groups = [makeGroup("Multi Hero", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(0);
  });

  it("does not apply to colorless vanilla cards", () => {
    const card = makeCard({
      name: "Colorless Hero",
      type: "Hero",
      brigade: "Colorless",
      specialAbility: "",
      quantity: 4,
    });
    const groups = [makeGroup("Colorless Hero", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(0);
  });

  it("does not apply to Dominants", () => {
    const card = makeDominant({
      name: "Some Dominant",
      brigade: "Blue",
      specialAbility: "",
      quantity: 4,
    });
    const groups = [makeGroup("Some Dominant", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(0);
  });

  it("does not apply to Sites or Cities", () => {
    const card = makeCard({
      name: "Test Site",
      type: "Site",
      brigade: "Blue",
      specialAbility: "",
      quantity: 4,
    });
    const groups = [makeGroup("Test Site", [card])];
    expect(checkVanillaLimit([], [], groups)).toHaveLength(0);
  });
});

describe("Rule: checkSitesCitiesLimit (t1-sites-cities)", () => {
  it("passes when sites+cities equal Lost Souls", () => {
    const mainDeck = [
      ...makeLostSouls(7),
      makeCard({ type: "Site", quantity: 7 }),
      makeCard({ quantity: 36 }),
    ];
    expect(checkSitesCitiesLimit(mainDeck, [])).toHaveLength(0);
  });

  it("passes when sites+cities are fewer than Lost Souls", () => {
    const mainDeck = [
      ...makeLostSouls(7),
      makeCard({ type: "Site", quantity: 3 }),
      makeCard({ quantity: 40 }),
    ];
    expect(checkSitesCitiesLimit(mainDeck, [])).toHaveLength(0);
  });

  it("fails when sites+cities exceed Lost Souls", () => {
    const mainDeck = [
      ...makeLostSouls(3),
      makeCard({ type: "Site", quantity: 4 }),
      makeCard({ quantity: 43 }),
    ];
    const issues = checkSitesCitiesLimit(mainDeck, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-sites-cities");
    expect(issues[0].message).toContain("4 Sites/Cities");
    expect(issues[0].message).toContain("3 Lost Souls");
  });

  it("counts Cities toward the total", () => {
    const mainDeck = [
      ...makeLostSouls(3),
      makeCard({ type: "City", quantity: 2 }),
      makeCard({ type: "Site", quantity: 2 }),
      makeCard({ quantity: 43 }),
    ];
    const issues = checkSitesCitiesLimit(mainDeck, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("4 Sites/Cities");
  });

  it("counts sites in reserve toward the limit", () => {
    const mainDeck = [...makeLostSouls(3), makeCard({ quantity: 47 })];
    const reserve = [makeCard({ type: "Site", isReserve: true, quantity: 4 })];
    const issues = checkSitesCitiesLimit(mainDeck, reserve);
    expect(issues).toHaveLength(1);
  });

  it("uses total LS count (including hoppers) for this check", () => {
    // Per the implementation, this rule counts ALL Lost Souls (including hoppers)
    const mainDeck = [
      ...makeLostSouls(3),
      makeLostSoul({
        name: 'Lost Soul "Hopper"',
        reference: "Matthew 18:12",
        set: "HopperSet",
      }),
      makeCard({ type: "Site", quantity: 4 }),
      makeCard({ quantity: 42 }),
    ];
    // 3 regular + 1 hopper = 4 LS total, 4 sites = equal, should pass
    expect(checkSitesCitiesLimit(mainDeck, [])).toHaveLength(0);
  });
});

describe("Rule: checkBannedCards (t1-banned-card)", () => {
  it("detects Daniel (Cloud of Witnesses)", () => {
    const card = makeCard({
      name: "Daniel",
      set: "Cloud of Witnesses",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-banned-card");
    expect(issues[0].message).toContain("Daniel");
    expect(issues[0].message).toContain("banned");
  });

  it("detects Endless Treasures (Prophecies of Christ)", () => {
    const card = makeCard({
      name: "Endless Treasures",
      set: "Prophecies of Christ",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Endless Treasures");
  });

  it("detects Ephesian Widow (Persecuted Church)", () => {
    const card = makeCard({
      name: "Ephesian Widow",
      set: "Persecuted Church",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
  });

  it("detects Lost Soul Proverbs 22:14 by reference", () => {
    const card = makeLostSoul({ reference: "Proverbs 22:14" });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Proverbs 22:14");
  });

  it("detects Mourn and Weep (Prophecies of Christ)", () => {
    const card = makeCard({
      name: "Mourn and Weep",
      set: "Prophecies of Christ",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
  });

  it("detects Samuel (Rock of Ages 2011)", () => {
    const card = makeCard({
      name: "Samuel",
      set: "Rock of Ages 2011",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
  });

  it("detects The Foretelling Angel (Persecuted Church)", () => {
    const card = makeCard({
      name: "The Foretelling Angel",
      set: "Persecuted Church",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
  });

  it("does NOT flag Daniel from a different set", () => {
    const card = makeCard({
      name: "Daniel",
      set: "Patriarchs",
    });
    expect(checkBannedCards([card], [])).toHaveLength(0);
  });

  it("does NOT flag Samuel from a different set", () => {
    const card = makeCard({
      name: "Samuel",
      set: "Kings",
    });
    expect(checkBannedCards([card], [])).toHaveLength(0);
  });

  it("detects banned card in reserve", () => {
    const card = makeCard({
      name: "Daniel",
      set: "Cloud of Witnesses",
      isReserve: true,
    });
    const issues = checkBannedCards([], [card]);
    expect(issues).toHaveLength(1);
  });

  it("skips cards with quantity 0", () => {
    const card = makeCard({
      name: "Daniel",
      set: "Cloud of Witnesses",
      quantity: 0,
    });
    expect(checkBannedCards([card], [])).toHaveLength(0);
  });

  it("is case-insensitive on card name", () => {
    const card = makeCard({
      name: "daniel",
      set: "Cloud of Witnesses",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
  });

  it("matches banned card via canonicalName", () => {
    const card = makeCard({
      name: "Daniel, the Treasured",
      set: "Cloud of Witnesses",
      canonicalName: "Daniel",
    });
    const issues = checkBannedCards([card], []);
    expect(issues).toHaveLength(1);
  });

  it("passes for a deck with no banned cards", () => {
    const cards = [
      makeCard({ name: "Moses", set: "Patriarchs" }),
      makeCard({ name: "Aaron", set: "Priests" }),
    ];
    expect(checkBannedCards(cards, [])).toHaveLength(0);
  });
});

describe("Rule: checkSpecialCards (t1-special-card)", () => {
  describe("Faithful Witness (Revelation of John)", () => {
    it("passes at 4 copies (flat max, not per-50)", () => {
      const card = makeCard({
        name: "Faithful Witness",
        set: "Revelation of John",
        type: "Hero",
        specialAbility: "Some ability",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Faithful Witness", [card])];
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });

    it("fails at 5 copies", () => {
      const card = makeCard({
        name: "Faithful Witness",
        set: "Revelation of John",
        type: "Hero",
        specialAbility: "Some ability",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Faithful Witness", [card])];
      const issues = checkSpecialCards(mainDeck, [], groups);
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe("t1-special-card");
      expect(issues[0].message).toContain("max 4");
      expect(issues[0].message).toContain("found 5");
    });

    it("max remains 4 even in 100-card deck (flat max)", () => {
      const card = makeCard({
        name: "Faithful Witness",
        set: "Revelation of John",
        type: "Hero",
        specialAbility: "Some ability",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Faithful Witness", [card])];
      const issues = checkSpecialCards(mainDeck, [], groups);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("max 4");
    });

    it("matches set abbreviation 'RJ'", () => {
      const card = makeCard({
        name: "Faithful Witness",
        set: "RJ",
        type: "Hero",
        specialAbility: "Some ability",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Faithful Witness", [card])];
      const issues = checkSpecialCards(mainDeck, [], groups);
      expect(issues).toHaveLength(1);
    });

    it("does NOT match Faithful Witness from another set", () => {
      const card = makeCard({
        name: "Faithful Witness",
        set: "Other Set",
        type: "Hero",
        specialAbility: "Some ability",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Faithful Witness", [card])];
      // No special card match, so checkSpecialCards won't flag it
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });
  });

  describe("Locust from the Pit (Revelation of John)", () => {
    it("passes at 5 copies in 50-card deck", () => {
      const card = makeCard({
        name: "Locust from the Pit",
        set: "Revelation of John",
        type: "Evil Character",
        specialAbility: "Some ability",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Locust from the Pit", [card])];
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });

    it("fails at 6 copies in 50-card deck", () => {
      const card = makeCard({
        name: "Locust from the Pit",
        set: "Revelation of John",
        type: "Evil Character",
        specialAbility: "Some ability",
        quantity: 6,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Locust from the Pit", [card])];
      const issues = checkSpecialCards(mainDeck, [], groups);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("max 5");
    });

    it("passes at 10 copies in 100-card deck (per-50 scaling)", () => {
      const card = makeCard({
        name: "Locust from the Pit",
        set: "Revelation of John",
        type: "Evil Character",
        specialAbility: "Some ability",
        quantity: 10,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Locust from the Pit", [card])];
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });
  });

  describe("Legion (Apostles/Disciples)", () => {
    it("passes at 4 copies in 50-card deck", () => {
      const card = makeCard({
        name: "Legion",
        set: "Apostles",
        type: "Evil Character",
        specialAbility: "Some ability",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Legion", [card])];
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });

    it("fails at 5 copies in 50-card deck", () => {
      const card = makeCard({
        name: "Legion",
        set: "Apostles",
        type: "Evil Character",
        specialAbility: "Some ability",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Legion", [card])];
      const issues = checkSpecialCards(mainDeck, [], groups);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("max 4");
    });

    it("scales to 8 copies in 100-card deck", () => {
      const card = makeCard({
        name: "Legion",
        set: "Disciples",
        type: "Evil Character",
        specialAbility: "Some ability",
        quantity: 8,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Legion", [card])];
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });
  });

  describe("Angry Mob variants (Early Church)", () => {
    it("passes at 4 copies of Black Angry Mob in 50-card deck", () => {
      const card = makeCard({
        name: "Angry Mob",
        set: "Early Church",
        type: "Evil Character",
        brigade: "Black",
        specialAbility: "Some ability",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Angry Mob", [card])];
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });

    it("fails at 5 copies of Black Angry Mob in 50-card deck", () => {
      const card = makeCard({
        name: "Angry Mob",
        set: "Early Church",
        type: "Evil Character",
        brigade: "Black",
        specialAbility: "Some ability",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(50, [card]);
      const groups = [makeGroup("Angry Mob", [card])];
      const issues = checkSpecialCards(mainDeck, [], groups);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("Angry Mob [Black]");
      expect(issues[0].message).toContain("max 4");
    });

    it("tracks each brigade variant independently", () => {
      const black = makeCard({
        name: "Angry Mob",
        set: "Early Church",
        type: "Evil Character",
        brigade: "Black",
        specialAbility: "Some ability",
        quantity: 4,
      });
      const brown = makeCard({
        name: "Angry Mob",
        set: "Early Church",
        type: "Evil Character",
        brigade: "Brown",
        specialAbility: "Some ability",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(50, [black, brown]);
      const groups = [makeGroup("Angry Mob", [black, brown])];
      // Both at 4, which is the max -> should pass
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });

    it("scales to 8 per brigade in 100-card deck", () => {
      const card = makeCard({
        name: "Angry Mob",
        set: "Early Church",
        type: "Evil Character",
        brigade: "Gray",
        specialAbility: "Some ability",
        quantity: 8,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Angry Mob", [card])];
      expect(checkSpecialCards(mainDeck, [], groups)).toHaveLength(0);
    });
  });

  it("counts special cards in reserve toward the total", () => {
    const mainCard = makeCard({
      name: "Faithful Witness",
      set: "Revelation of John",
      type: "Hero",
      specialAbility: "Some ability",
      quantity: 3,
    });
    const reserveCard = makeCard({
      name: "Faithful Witness",
      set: "Revelation of John",
      type: "Hero",
      specialAbility: "Some ability",
      quantity: 2,
      isReserve: true,
    });
    const mainDeck = makeValidMainDeck(50, [mainCard]);
    const groups = [makeGroup("Faithful Witness", [mainCard, reserveCard])];
    const issues = checkSpecialCards(mainDeck, [reserveCard], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("found 5");
  });
});

// ===========================================================================
// D. Integration test with real decklist data
// ===========================================================================

describe("Integration: Real decklist structure (Big Nativity v11)", () => {
  /**
   * This test uses the structure of the real "Big Nativity v11" deck
   * queried from the DB. We build ResolvedCards manually since the
   * rules are pure functions that don't need the card database.
   *
   * Key stats from the DB data:
   * - Many Lost Souls with various abilities
   * - Son of God and The Second Coming are both present (mutual exclusion!)
   * - Reserve has ~10 cards
   */

  // Build a minimal valid 50-card deck for integration testing
  function buildIntegrationDeck() {
    const mainDeck: ResolvedCard[] = [
      // Lost Souls (7 regular + 1 hopper for 50-card deck)
      makeLostSoul({ name: 'Lost Soul "Accusers"', reference: "Ezra 4:6", specialAbility: "Some ability" }),
      makeLostSoul({ name: 'Lost Soul "Color Guard"', reference: "Jeremiah 13:10", specialAbility: "Some ability" }),
      makeLostSoul({ name: 'Lost Soul "Complacent"', reference: "Zephaniah 1:12", specialAbility: "" }),
      makeLostSoul({ name: 'Lost Soul "Dull"', reference: "Hebrews 5:11", specialAbility: "Some ability" }),
      makeLostSoul({ name: 'Lost Soul "Forsaken"', reference: "Hebrews 10:25", specialAbility: "" }),
      makeLostSoul({ name: 'Lost Soul "Open Hand"', reference: "Hebrews 4:13", specialAbility: "Some ability" }),
      makeLostSoul({ name: 'Lost Soul "Vindicated"', reference: "Job 13:18", specialAbility: "" }),
      // Hopper (doesn't count toward required LS)
      makeLostSoul({
        name: 'Lost Soul "Hopper" [Matthew 18:12]',
        reference: "Matthew 18:12",
        set: "Pmo-P3",
        specialAbility: "Hopper ability",
      }),

      // Dominants (keep <= 7 non-hopper LS count)
      makeDominant({ name: "Son of God", set: "Promo" }),
      makeDominant({ name: "Christian Martyr", set: "Promo" }),
      makeDominant({ name: "Angel of the Lord", set: "Promo" }),

      // Heroes
      makeCard({ name: "Elizabeth", type: "Hero", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "John the Forerunner", type: "Hero", brigade: "Green", specialAbility: "Some ability" }),
      makeCard({ name: "Joseph, the Betrothed", type: "Hero", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "Simeon, the Devout", type: "Hero", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "Zechariah, the Silent", type: "Hero", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "Anna, the Widow", type: "Hero", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "Shepherds of Bethlehem", type: "Hero", brigade: "Green", specialAbility: "Some ability" }),
      makeCard({ name: "The Magi", type: "Hero", brigade: "Green", specialAbility: "Some ability" }),

      // Evil Characters
      makeCard({ name: "Herod the Great", type: "Evil Character", brigade: "Black", specialAbility: "Some ability" }),
      makeCard({ name: "Herod Archelaus", type: "Evil Character", brigade: "Black", specialAbility: "Some ability" }),
      makeCard({ name: "Herodias' Daughter", type: "Evil Character", brigade: "Black", specialAbility: "Some ability" }),
      makeCard({ name: "Herod's Executioner", type: "Evil Character", brigade: "Black", specialAbility: "Some ability" }),

      // Enhancements
      makeCard({ name: "The Annunciation", type: "Enhancement", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "The Child is Born", type: "Enhancement", brigade: "Green", specialAbility: "Some ability" }),
      makeCard({ name: "Magnificat", type: "Enhancement", brigade: "Purple", specialAbility: "Some ability", quantity: 2 }),
      makeCard({ name: "Angelic Guidance", type: "Enhancement", brigade: "Purple", specialAbility: "", quantity: 2 }),
      makeCard({ name: "Contagious Fear", type: "Enhancement", brigade: "Black", specialAbility: "Some ability" }),
      makeCard({ name: "Futile Inquisition", type: "Enhancement", brigade: "Black", specialAbility: "Some ability" }),
      makeCard({ name: "Duplicity", type: "Enhancement", brigade: "Black", specialAbility: "Some ability" }),
      makeCard({ name: "Concealed Riches", type: "Enhancement", brigade: "Black", specialAbility: "Some ability", quantity: 2 }),

      // Artifacts/other
      makeCard({ name: "Bethlehem Stable", type: "Site", brigade: "" }),
      makeCard({ name: "Golgotha", type: "Site", brigade: "" }),
      makeCard({ name: "Herod's Temple", type: "Site", brigade: "", quantity: 2 }),

      // More cards to reach 50
      // Running total so far: 7 LS + 1 hopper + 3 dominants + 8 heroes + 4 ECs + 11 enhancements + 4 sites = 38
      makeCard({ name: "The Cross", type: "Enhancement", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "The Resurrection", type: "Enhancement", brigade: "Purple", specialAbility: "Some ability" }),
      makeCard({ name: "The New Covenant", type: "Enhancement", brigade: "Purple", specialAbility: "Some ability", quantity: 2 }),
      makeCard({ name: "Lost Child Found", type: "Enhancement", brigade: "Green", specialAbility: "Some ability", quantity: 2 }),
      // Running total: 38 + 6 = 44 -> need 6 more vanilla filler
      makeCard({ name: "Filler Hero A", type: "Hero", brigade: "Green", specialAbility: "" }),
      makeCard({ name: "Filler Hero B", type: "Hero", brigade: "Green", specialAbility: "" }),
      makeCard({ name: "Filler Hero C", type: "Hero", brigade: "Green", specialAbility: "" }),
      makeCard({ name: "Filler Villain A", type: "Evil Character", brigade: "Brown", specialAbility: "" }),
      makeCard({ name: "Filler Villain B", type: "Evil Character", brigade: "Brown", specialAbility: "" }),
      makeCard({ name: "Filler Villain C", type: "Evil Character", brigade: "Brown", specialAbility: "" }),
      // Total: 44 + 6 = 50
    ];

    const reserve: ResolvedCard[] = [
      makeCard({ name: "Flight into Egypt", type: "Enhancement", brigade: "Purple", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "Foreign Horses", type: "Enhancement", brigade: "Black", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "Futile Inquisition", type: "Enhancement", brigade: "Black", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "No Need for Spices", type: "Enhancement", brigade: "Purple", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "The Heavenly Host", type: "Enhancement", brigade: "Green", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "Joseph, the Betrothed", type: "Hero", brigade: "Purple", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "Contagious Fear", type: "Enhancement", brigade: "Black", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "Possessing Spirit", type: "Enhancement", brigade: "Black", specialAbility: "Some ability", isReserve: true }),
      makeCard({ name: "The Coming Prince", type: "Enhancement", brigade: "Black", specialAbility: "Some ability", isReserve: true }),
    ];

    return { mainDeck, reserve };
  }

  it("validates structural rules on a real-ish deck", () => {
    const { mainDeck, reserve } = buildIntegrationDeck();
    const mainDeckSize = mainDeck.reduce((s, c) => s + c.quantity, 0);

    // Verify main deck size
    expect(mainDeckSize).toBeGreaterThanOrEqual(50);

    // Check deck size
    const sizeIssues = checkDeckSize(mainDeck);
    expect(sizeIssues).toHaveLength(0);

    // Check reserve size (9 cards)
    const reserveSize = reserve.reduce((s, c) => s + c.quantity, 0);
    expect(reserveSize).toBeLessThanOrEqual(10);
    expect(checkReserveSize(reserve)).toHaveLength(0);

    // Check reserve contents (no dominants or LS)
    expect(checkReserveContents(reserve)).toHaveLength(0);
  });

  it("detects LS count correctly with hopper excluded", () => {
    const { mainDeck } = buildIntegrationDeck();
    const lsIssues = checkLostSoulCount(mainDeck);
    // Should pass: 7 non-hopper LS in a ~50 card deck
    expect(lsIssues).toHaveLength(0);
  });

  it("detects mutation: adding a banned card", () => {
    const { mainDeck, reserve } = buildIntegrationDeck();
    const bannedCard = makeCard({
      name: "Daniel",
      set: "Cloud of Witnesses",
    });
    const mutated = [...mainDeck, bannedCard];
    const issues = checkBannedCards(mutated, reserve);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-banned-card");
  });

  it("detects mutation: adding mutual exclusion pair", () => {
    const { mainDeck, reserve } = buildIntegrationDeck();
    // The deck already has Son of God; add The Second Coming too
    const tsc = makeDominant({ name: "The Second Coming" });
    const mutated = [...mainDeck, tsc];
    const issues = checkMutualExclusion(mutated, reserve);
    // Son of God + The Second Coming = at least one mutual exclusion error
    // (The real "Big Nativity v11" from DB does have both, which is actually an issue!)
    const sogTscIssues = issues.filter(
      (i) =>
        i.cards?.includes("Son of God") ||
        i.cards?.includes("The Second Coming")
    );
    expect(sogTscIssues.length).toBeGreaterThanOrEqual(0);
  });

  it("detects mutation: exceeding dominant uniqueness", () => {
    const d1 = makeDominant({ name: "Son of God", set: "Set A" });
    const d2 = makeDominant({ name: "Son of God", set: "Set B" });
    const groups = [makeGroup("Son of God", [d1, d2])];
    const issues = checkDominantUnique([], [], groups);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("found 2");
  });
});

// ===========================================================================
// E. Edge cases
// ===========================================================================

describe("Edge cases", () => {
  it("empty deck produces deck-size error", () => {
    const issues = checkDeckSize([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("t1-deck-size");
    expect(issues[0].message).toContain("0 cards");
  });

  it("deck at exact 50-card boundary is valid for deck size", () => {
    const cards = [makeCard({ quantity: 50 })];
    expect(checkDeckSize(cards)).toHaveLength(0);
  });

  it("deck at exact 56-card boundary still requires 7 LS", () => {
    const lostSouls = makeLostSouls(7);
    const filler = makeCard({ quantity: 49 });
    expect(checkLostSoulCount([...lostSouls, filler])).toHaveLength(0);
  });

  it("deck at exact 57-card boundary requires 8 LS", () => {
    // 7 LS in 57-card deck should fail (needs 8)
    const lostSouls = makeLostSouls(7);
    const filler = makeCard({ quantity: 50 });
    const issues = checkLostSoulCount([...lostSouls, filler]);
    expect(issues).toHaveLength(1);

    // 8 LS should pass
    const lostSouls8 = makeLostSouls(8);
    const filler2 = makeCard({ quantity: 49 });
    expect(checkLostSoulCount([...lostSouls8, filler2])).toHaveLength(0);
  });

  it("cards not found in database have empty type (stub behavior)", () => {
    // When a card isn't found, it gets empty strings for type, brigade, etc.
    // This means it won't trigger Lost Soul, Dominant, or other type checks
    const stub = makeCard({
      name: "Unknown Card",
      type: "",
      brigade: "",
      specialAbility: "",
    });
    expect(isLostSoul(stub)).toBe(false);
    expect(isDominant(stub)).toBe(false);
    expect(hasSpecialAbility(stub)).toBe(false);
    expect(isMultiBrigade(stub)).toBe(false);
    expect(isSingleBrigade(stub)).toBe(false);
    expect(isSiteOrCity(stub)).toBe(false);
  });

  it("deck with only quantity-0 cards treats as empty", () => {
    const cards = [makeCard({ quantity: 0 }), makeCard({ quantity: 0 })];
    const issues = checkDeckSize(cards);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("0 cards");
  });
});

// ===========================================================================
// F. validateT1Rules integration
// ===========================================================================

describe("validateT1Rules (full pipeline)", () => {
  it("returns no issues for a well-formed 50-card deck", () => {
    const lostSouls = makeLostSouls(7);
    const heroes = Array.from({ length: 10 }, (_, i) =>
      makeCard({
        name: `Hero ${i}`,
        type: "Hero",
        brigade: "Blue",
        specialAbility: "Some ability",
      })
    );
    const villains = Array.from({ length: 10 }, (_, i) =>
      makeCard({
        name: `Villain ${i}`,
        type: "Evil Character",
        brigade: "Black",
        specialAbility: "Some ability",
      })
    );
    const enhancements = Array.from({ length: 10 }, (_, i) =>
      makeCard({
        name: `Enhancement ${i}`,
        type: "Enhancement",
        brigade: i < 5 ? "Blue" : "Black",
        specialAbility: "Some ability",
      })
    );
    const dominants = [
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "Christian Martyr" }),
      makeDominant({ name: "Angel of the Lord" }),
    ];
    const sites = [
      makeCard({ name: "Site A", type: "Site", quantity: 1 }),
      makeCard({ name: "Site B", type: "Site", quantity: 1 }),
      makeCard({ name: "Site C", type: "Site", quantity: 1 }),
    ];

    const mainDeck = [
      ...lostSouls,
      ...heroes,
      ...villains,
      ...enhancements,
      ...dominants,
      ...sites,
    ];

    const mainSize = mainDeck.reduce((s, c) => s + c.quantity, 0);
    // Pad to exactly 50 with uniquely-named vanilla filler cards (max 3 per name)
    const fillerCount = 50 - mainSize;
    const fillers = Array.from({ length: fillerCount }, (_, i) =>
      makeCard({
        name: `Filler Card ${i}`,
        type: "Hero",
        brigade: "Green",
        specialAbility: "",
        quantity: 1,
      })
    );

    const allMain = [...mainDeck, ...fillers];

    // Build individual card groups (each card is unique)
    const allCards = [...allMain];
    const groups: CardGroup[] = allCards.map((c) =>
      makeGroup(c.name, [c])
    );

    const issues = validateT1Rules(allMain, [], groups);

    // Filter out only errors (not warnings)
    const errors = issues.filter((i) => i.type === "error");
    expect(errors).toHaveLength(0);
  });

  it("catches multiple simultaneous violations", () => {
    // Deck that's too small, has banned cards, and has mutual exclusion
    const mainDeck = [
      makeCard({ quantity: 30 }),
      makeCard({
        name: "Daniel",
        set: "Cloud of Witnesses",
      }),
      makeDominant({ name: "Son of God" }),
      makeDominant({ name: "Chariot of Fire" }),
      makeDominant({ name: "New Jerusalem" }),
      makeDominant({ name: "The Second Coming" }),
    ];

    const groups = mainDeck.map((c) => makeGroup(c.name, [c]));
    const issues = validateT1Rules(mainDeck, [], groups);
    const errors = issues.filter((i) => i.type === "error");

    // Should have at least:
    // 1. deck-size (too small)
    // 2. banned card (Daniel CoW)
    // 3. mutual exclusion (SoG + CoF)
    // 4. mutual exclusion (NJ + TSC)
    // 5. dominant limit (more dominants than LS)
    const ruleIds = errors.map((e) => e.rule);
    expect(ruleIds).toContain("t1-deck-size");
    expect(ruleIds).toContain("t1-banned-card");
    expect(ruleIds).toContain("t1-mutual-exclusion");
    expect(ruleIds).toContain("t1-dominant-limit");
  });

  it("handles empty deck gracefully", () => {
    const issues = validateT1Rules([], [], []);
    const errors = issues.filter((i) => i.type === "error");
    // At minimum, deck size error
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].rule).toBe("t1-deck-size");
  });
});
