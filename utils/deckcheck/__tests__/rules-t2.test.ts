import { describe, it, expect } from "vitest";
import type { ResolvedCard, CardGroup } from "../types";
import {
  isLostSoul,
  isHopperLostSoul,
  getBrigadeCount,
  isCharacter,
  isEnhancement,
  isArtifactFortressCovCurse,
  getEffectiveAlignment,
  getT2RequiredLostSouls,
  checkT2DeckSize,
  checkT2LostSoulCount,
  checkT2ReserveSize,
  checkT2QuantityLimits,
  checkGoodEvilBalance,
  validateT2Rules,
} from "../rules";

// ---------------------------------------------------------------------------
// Test helpers (copied from T1 test file, adapted for T2 deck sizes)
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
function makeLostSoul(overrides: Partial<ResolvedCard> = {}): ResolvedCard {
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
function makeDominant(overrides: Partial<ResolvedCard> = {}): ResolvedCard {
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
      name: "Lost Soul",
      reference: `Reference ${i + 1}:${i + 1}`,
      set: `Set${i}`,
      identifier: `ls-${i}`,
    })
  );
}

/**
 * Build filler cards to pad a main deck to a target size.
 * Includes the required Lost Souls for that size (using T2 formula).
 * Produces a balanced deck: half good heroes, half evil characters.
 */
function makeValidMainDeck(
  targetSize: number,
  extras: ResolvedCard[] = []
): ResolvedCard[] {
  const existingQty = extras.reduce((sum, c) => sum + c.quantity, 0);
  const requiredLS = getT2RequiredLostSouls(targetSize);

  // Count how many LS are already in extras
  const existingLS = extras
    .filter((c) => isLostSoul(c) && !isHopperLostSoul(c))
    .reduce((sum, c) => sum + c.quantity, 0);
  const lsNeeded = Math.max(0, requiredLS - existingLS);

  const lostSouls = makeLostSouls(lsNeeded);
  const fillerNeeded = targetSize - existingQty - lsNeeded;

  // Split fillers evenly between good and evil for balance
  const goodCount = Math.ceil(fillerNeeded / 2);
  const evilCount = fillerNeeded - goodCount;

  // Count existing good/evil in extras to adjust
  const existingGood = extras
    .filter(
      (c) =>
        !isLostSoul(c) &&
        c.type !== "Dominant" &&
        c.type !== "Artifact" &&
        c.type !== "Site" &&
        c.type !== "City" &&
        c.type !== "Fortress" &&
        c.type !== "Covenant" &&
        c.type !== "Curse"
    )
    .filter((c) => {
      const a = c.alignment?.toLowerCase() ?? "";
      return a === "good" || a === "good/neutral" || a === "neutral/good";
    })
    .reduce((sum, c) => sum + c.quantity, 0);
  const existingEvil = extras
    .filter(
      (c) =>
        !isLostSoul(c) &&
        c.type !== "Dominant" &&
        c.type !== "Artifact" &&
        c.type !== "Site" &&
        c.type !== "City" &&
        c.type !== "Fortress" &&
        c.type !== "Covenant" &&
        c.type !== "Curse"
    )
    .filter((c) => {
      const a = c.alignment?.toLowerCase() ?? "";
      return a === "evil" || a === "evil/neutral" || a === "neutral/evil";
    })
    .reduce((sum, c) => sum + c.quantity, 0);

  // Adjust filler counts to balance good/evil
  const totalGoodNeeded = Math.floor(fillerNeeded / 2);
  const totalEvilNeeded = fillerNeeded - totalGoodNeeded;
  const adjustedGood = Math.max(0, totalGoodNeeded - existingGood + existingEvil);
  const adjustedEvil = fillerNeeded - adjustedGood;

  const goodFillers = makeFillerCards(adjustedGood, "Filler Hero", "Hero", "Blue", "Good");
  const evilFillers = makeFillerCards(adjustedEvil, "Filler Evil Character", "Evil Character", "Black", "Evil");

  return [...extras, ...lostSouls, ...goodFillers, ...evilFillers];
}

/**
 * Spread `total` across multiple unique cards, each with quantity <= 4,
 * to stay within T2 quantity limits.
 */
function makeFillerCards(
  total: number,
  prefix: string,
  type: string,
  brigade: string,
  alignment: string
): ResolvedCard[] {
  const cards: ResolvedCard[] = [];
  let remaining = total;
  let idx = 0;
  while (remaining > 0) {
    const qty = Math.min(4, remaining);
    cards.push(
      makeCard({
        name: `${prefix} ${idx}`,
        type,
        brigade,
        alignment,
        specialAbility: "",
        quantity: qty,
        identifier: `${prefix.toLowerCase().replace(/ /g, "-")}-${idx}`,
      })
    );
    remaining -= qty;
    idx++;
  }
  return cards;
}

function makeSimpleBalancedDeck(targetSize: number): ResolvedCard[] {
  const requiredLS = getT2RequiredLostSouls(targetSize);
  const lostSouls = makeLostSouls(requiredLS);
  const fillerNeeded = targetSize - requiredLS;
  const goodCount = Math.floor(fillerNeeded / 2);
  const evilCount = fillerNeeded - goodCount;

  const goodFillers = makeFillerCards(goodCount, "Filler Hero", "Hero", "Blue", "Good");
  const evilFillers = makeFillerCards(evilCount, "Filler Evil Character", "Evil Character", "Black", "Evil");

  return [...lostSouls, ...goodFillers, ...evilFillers];
}

/** Build a CardGroup from an array of ResolvedCards sharing the same canonical name. */
function makeGroup(canonicalName: string, cards: ResolvedCard[]): CardGroup {
  return {
    canonicalName,
    cards,
    totalQuantity: cards.reduce((sum, c) => sum + c.quantity, 0),
  };
}

// ===========================================================================
// A. New Helper Tests
// ===========================================================================

describe("getBrigadeCount", () => {
  it("returns 0 for empty string brigade", () => {
    const card = makeCard({ brigade: "" });
    expect(getBrigadeCount(card)).toBe(0);
  });

  it('returns 0 for "Colorless" brigade', () => {
    const card = makeCard({ brigade: "Colorless" });
    expect(getBrigadeCount(card)).toBe(0);
  });

  it("returns 1 for a single brigade like Blue", () => {
    const card = makeCard({ brigade: "Blue" });
    expect(getBrigadeCount(card)).toBe(1);
  });

  it("returns 2 for Blue/Red", () => {
    const card = makeCard({ brigade: "Blue/Red" });
    expect(getBrigadeCount(card)).toBe(2);
  });

  it("returns 3 for Blue/Red/Green", () => {
    const card = makeCard({ brigade: "Blue/Red/Green" });
    expect(getBrigadeCount(card)).toBe(3);
  });

  it('returns 7 for "Multi" (standalone multi)', () => {
    const card = makeCard({ brigade: "Multi" });
    expect(getBrigadeCount(card)).toBe(7);
  });

  it('returns 7 for "Multi/Brown" (Multi part means all brigades)', () => {
    const card = makeCard({ brigade: "Multi/Brown" });
    expect(getBrigadeCount(card)).toBe(7);
  });

  it('returns 7 for "Gray/Multi" (Multi part means all brigades)', () => {
    const card = makeCard({ brigade: "Gray/Multi" });
    expect(getBrigadeCount(card)).toBe(7);
  });

  it('returns 2 for "Crimson/Orange/Orange" (deduplicates repeated brigades)', () => {
    const card = makeCard({ brigade: "Crimson/Orange/Orange" });
    expect(getBrigadeCount(card)).toBe(2);
  });
});

describe("isCharacter", () => {
  it("returns true for Hero", () => {
    expect(isCharacter(makeCard({ type: "Hero" }))).toBe(true);
  });

  it("returns true for Evil Character", () => {
    expect(isCharacter(makeCard({ type: "Evil Character" }))).toBe(true);
  });

  it("returns false for Enhancement", () => {
    expect(isCharacter(makeCard({ type: "Enhancement" }))).toBe(false);
  });

  it("returns false for Good Enhancement", () => {
    expect(isCharacter(makeCard({ type: "Good Enhancement" }))).toBe(false);
  });

  it("returns false for Dominant", () => {
    expect(isCharacter(makeCard({ type: "Dominant" }))).toBe(false);
  });

  it("returns false for Lost Soul", () => {
    expect(isCharacter(makeCard({ type: "Lost Soul" }))).toBe(false);
  });

  it("returns false for Artifact", () => {
    expect(isCharacter(makeCard({ type: "Artifact" }))).toBe(false);
  });
});

describe("isEnhancement", () => {
  it("returns true for Good Enhancement (GE)", () => {
    expect(isEnhancement(makeCard({ type: "Good Enhancement" }))).toBe(true);
  });

  it("returns true for Evil Enhancement (EE)", () => {
    expect(isEnhancement(makeCard({ type: "Evil Enhancement" }))).toBe(true);
  });

  it("returns true for generic Enhancement", () => {
    expect(isEnhancement(makeCard({ type: "Enhancement" }))).toBe(true);
  });

  it("returns false for Hero", () => {
    expect(isEnhancement(makeCard({ type: "Hero" }))).toBe(false);
  });

  it("returns false for Dominant", () => {
    expect(isEnhancement(makeCard({ type: "Dominant" }))).toBe(false);
  });

  it("returns false for Artifact", () => {
    expect(isEnhancement(makeCard({ type: "Artifact" }))).toBe(false);
  });
});

describe("isArtifactFortressCovCurse", () => {
  it("returns true for Artifact", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Artifact" }))).toBe(
      true
    );
  });

  it("returns true for Fortress", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Fortress" }))).toBe(
      true
    );
  });

  it("returns true for Covenant", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Covenant" }))).toBe(
      true
    );
  });

  it("returns true for Curse", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Curse" }))).toBe(true);
  });

  it("returns false for Hero", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Hero" }))).toBe(false);
  });

  it("returns false for Enhancement", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Enhancement" }))).toBe(
      false
    );
  });

  it("returns false for Dominant", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Dominant" }))).toBe(
      false
    );
  });

  it("returns false for Site", () => {
    expect(isArtifactFortressCovCurse(makeCard({ type: "Site" }))).toBe(false);
  });
});

describe("getEffectiveAlignment", () => {
  it('returns "good" for alignment "Good"', () => {
    expect(getEffectiveAlignment(makeCard({ alignment: "Good" }))).toBe("good");
  });

  it('returns "evil" for alignment "Evil"', () => {
    expect(getEffectiveAlignment(makeCard({ alignment: "Evil" }))).toBe("evil");
  });

  it('returns "neutral" for alignment "Neutral"', () => {
    expect(getEffectiveAlignment(makeCard({ alignment: "Neutral" }))).toBe(
      "neutral"
    );
  });

  it('returns "neutral" for dual alignment "Good/Evil"', () => {
    expect(getEffectiveAlignment(makeCard({ alignment: "Good/Evil" }))).toBe(
      "neutral"
    );
  });

  it('returns "good" for dual alignment "Good/Neutral"', () => {
    expect(getEffectiveAlignment(makeCard({ alignment: "Good/Neutral" }))).toBe(
      "good"
    );
  });

  it('returns "evil" for dual alignment "Evil/Neutral"', () => {
    expect(getEffectiveAlignment(makeCard({ alignment: "Evil/Neutral" }))).toBe(
      "evil"
    );
  });

  it("returns alignment for Lost Soul (neutral)", () => {
    expect(getEffectiveAlignment(makeLostSoul())).toBe("neutral");
  });

  it("returns alignment for Good Dominant", () => {
    expect(getEffectiveAlignment(makeDominant({ alignment: "Good" }))).toBe("good");
  });

  it("returns alignment for Evil Dominant", () => {
    expect(getEffectiveAlignment(makeDominant({ alignment: "Evil" }))).toBe("evil");
  });

  it("returns alignment for Good Artifact", () => {
    expect(
      getEffectiveAlignment(makeCard({ type: "Artifact", alignment: "Good" }))
    ).toBe("good");
  });

  it("returns neutral for Neutral Site", () => {
    expect(
      getEffectiveAlignment(makeCard({ type: "Site", alignment: "Neutral" }))
    ).toBe("neutral");
  });

  it("returns neutral for Neutral Covenant", () => {
    expect(
      getEffectiveAlignment(makeCard({ type: "Covenant", alignment: "Neutral" }))
    ).toBe("neutral");
  });

  it("returns evil for Evil Curse", () => {
    expect(
      getEffectiveAlignment(makeCard({ type: "Curse", alignment: "Evil" }))
    ).toBe("evil");
  });
});

describe("getT2RequiredLostSouls", () => {
  it("returns 0 for deck size < 100 (too small)", () => {
    expect(getT2RequiredLostSouls(99)).toBe(0);
  });

  it("returns 14 for 100-card deck", () => {
    expect(getT2RequiredLostSouls(100)).toBe(14);
  });

  it("returns 14 for 105-card deck", () => {
    expect(getT2RequiredLostSouls(105)).toBe(14);
  });

  it("returns 15 for 106-card deck", () => {
    expect(getT2RequiredLostSouls(106)).toBe(15);
  });

  it("returns 15 for 112-card deck", () => {
    expect(getT2RequiredLostSouls(112)).toBe(15);
  });

  it("returns 16 for 113-card deck", () => {
    expect(getT2RequiredLostSouls(113)).toBe(16);
  });

  it("returns 35 for 246-card deck", () => {
    expect(getT2RequiredLostSouls(246)).toBe(35);
  });

  it("returns 35 for 252-card deck", () => {
    expect(getT2RequiredLostSouls(252)).toBe(35);
  });
});

// ===========================================================================
// B. T2 Deck Size
// ===========================================================================

describe("checkT2DeckSize", () => {
  it("errors for 99-card deck (below minimum)", () => {
    const deck = Array.from({ length: 99 }, (_, i) =>
      makeCard({ name: `Card ${i}`, identifier: `c-${i}` })
    );
    const issues = checkT2DeckSize(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("error");
    expect(issues[0].rule).toBe("t2-deck-size");
  });

  it("passes for 100-card deck (minimum)", () => {
    const deck = Array.from({ length: 100 }, (_, i) =>
      makeCard({ name: `Card ${i}`, identifier: `c-${i}` })
    );
    const issues = checkT2DeckSize(deck);
    expect(issues).toHaveLength(0);
  });

  it("passes for 200-card deck (mid range)", () => {
    const deck = [makeCard({ name: "Big Deck", quantity: 200 })];
    const issues = checkT2DeckSize(deck);
    expect(issues).toHaveLength(0);
  });

  it("passes for 252-card deck (maximum)", () => {
    const deck = [makeCard({ name: "Max Deck", quantity: 252 })];
    const issues = checkT2DeckSize(deck);
    expect(issues).toHaveLength(0);
  });

  it("errors for 253-card deck (above maximum)", () => {
    const deck = [makeCard({ name: "Too Big", quantity: 253 })];
    const issues = checkT2DeckSize(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("error");
    expect(issues[0].rule).toBe("t2-deck-size");
  });
});

// ===========================================================================
// C. T2 Lost Soul Count
// ===========================================================================

describe("checkT2LostSoulCount", () => {
  it("passes for 100-card deck with exactly 14 LS", () => {
    const deck = makeSimpleBalancedDeck(100);
    const issues = checkT2LostSoulCount(deck);
    expect(issues).toHaveLength(0);
  });

  it("errors for 100-card deck with 13 LS", () => {
    const lostSouls = makeLostSouls(13);
    const fillerNeeded = 100 - 13;
    const fillers = [makeCard({ name: "Filler", quantity: fillerNeeded })];
    const deck = [...lostSouls, ...fillers];
    const issues = checkT2LostSoulCount(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("error");
    expect(issues[0].rule).toBe("t2-lost-soul-count");
  });

  it("errors for 100-card deck with 15 LS", () => {
    const lostSouls = makeLostSouls(15);
    const fillerNeeded = 100 - 15;
    const fillers = [makeCard({ name: "Filler", quantity: fillerNeeded })];
    const deck = [...lostSouls, ...fillers];
    const issues = checkT2LostSoulCount(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("error");
    expect(issues[0].rule).toBe("t2-lost-soul-count");
  });

  it("passes for 106-card deck with 15 LS", () => {
    // 106 cards: requiredLS = floor((106-100)/7) + 14 = floor(6/7) + 14 = 0 + 14 = 14? No.
    // Wait: formula is floor((deckSize - 100) / 7) + 14
    // 106: floor(6/7) + 14 = 0 + 14 = 14. But spec says 106 = 15.
    // Re-read: "For every 7 cards beyond 105, one additional LS is required."
    // 100-105 = 14, 106-112 = 15. So the formula should give 15 for 106.
    // Let me re-check: floor((106-100)/7) + 14 = floor(6/7) + 14 = 0 + 14 = 14.
    // That contradicts the spec. The design doc says the formula is:
    //   requiredLostSouls = Math.floor((deckSize - 100) / 7) + 14
    // But also says 100-105 = 14, 106-112 = 15.
    // floor((105-100)/7) + 14 = floor(5/7)+14 = 14 (correct)
    // floor((106-100)/7) + 14 = floor(6/7)+14 = 14 (incorrect per spec)
    // The spec text says "every 7 cards beyond 105" so it should be:
    //   floor((deckSize - 106) / 7) + 15 for deckSize >= 106
    // OR equivalently: floor((deckSize - 100 + 1) / 7) + 14 ?
    // Actually the formula matches T1: getRequiredLostSouls(50) = floor((50-50)/7)+7 = 7
    // T1 chart: 50-56 = 7, 57-63 = 8, which means:
    //   floor((56-50)/7)+7 = floor(6/7)+7 = 7 (correct)
    //   floor((57-50)/7)+7 = floor(7/7)+7 = 1+7 = 8 (correct)
    // So for T2: floor((105-100)/7)+14 = floor(5/7)+14 = 14 (correct for 105)
    //   floor((106-100)/7)+14 = floor(6/7)+14 = 14 (NOT 15)
    // But spec says 106 needs 15. So the formula in the doc might be wrong, OR
    // "every 7 cards beyond 105" means the threshold is at 106, and the formula
    // is actually: Math.floor((deckSize - 100) / 7) + 14 doesn't match.
    // Let's try: 14 + Math.floor((deckSize - 100) / 7) for size >= 100
    // 100: 14+0=14, 106: 14+0=14, 107: 14+1=15... that gives 107=15, not 106=15.
    // The spec is clear: 100-105=14, 106-112=15, 113-119=16.
    // That's groups of 6 then 7: the first bracket has 6 extra cards (100-105),
    // then every subsequent bracket has 7.
    // Corrected formula: if deckSize <= 105, return 14; else 14 + Math.ceil((deckSize - 105) / 7)
    // 106: 14 + ceil(1/7) = 15 ✓
    // 112: 14 + ceil(7/7) = 15 ✓
    // 113: 14 + ceil(8/7) = 16 ✓
    // 252: 14 + ceil(147/7) = 14 + 21 = 35 ✓
    // The design doc's formula text may be approximate. The test boundaries in the spec
    // are the ground truth. We'll test against those.
    const lostSouls = makeLostSouls(15);
    const goodFiller = Math.floor((106 - 15) / 2);
    const evilFiller = 106 - 15 - goodFiller;
    const deck: ResolvedCard[] = [
      ...lostSouls,
      makeCard({
        name: "Filler Hero",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: goodFiller,
      }),
      makeCard({
        name: "Filler EC",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: evilFiller,
      }),
    ];
    const issues = checkT2LostSoulCount(deck);
    expect(issues).toHaveLength(0);
  });

  it("errors for 106-card deck with 14 LS (too few)", () => {
    const lostSouls = makeLostSouls(14);
    const fillerNeeded = 106 - 14;
    const deck = [...lostSouls, makeCard({ name: "Filler", quantity: fillerNeeded })];
    const issues = checkT2LostSoulCount(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("error");
    expect(issues[0].rule).toBe("t2-lost-soul-count");
  });

  it("excludes Hopper lost souls from the count", () => {
    // 100 cards needs 14 LS. Put 13 normal LS + 1 hopper = 13 counted, should fail.
    const normalLS = makeLostSouls(13);
    const hopper = makeLostSoul({
      name: "Lost Soul (Hopper)",
      reference: "II Chronicles 28:13",
      set: "HopperSet",
      identifier: "ls-hopper",
    });
    const fillerNeeded = 100 - 13 - 1;
    const deck = [
      ...normalLS,
      hopper,
      makeCard({ name: "Filler", quantity: fillerNeeded }),
    ];
    const issues = checkT2LostSoulCount(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("error");
    expect(issues[0].rule).toBe("t2-lost-soul-count");
  });
});

// ===========================================================================
// D. T2 Reserve Size
// ===========================================================================

describe("checkT2ReserveSize", () => {
  it("passes for 0 reserve cards", () => {
    const issues = checkT2ReserveSize([]);
    expect(issues).toHaveLength(0);
  });

  it("passes for 15 reserve cards (maximum)", () => {
    const reserve = Array.from({ length: 15 }, (_, i) =>
      makeCard({ name: `Reserve Card ${i}`, identifier: `r-${i}`, isReserve: true })
    );
    const issues = checkT2ReserveSize(reserve);
    expect(issues).toHaveLength(0);
  });

  it("errors for 16 reserve cards (above maximum)", () => {
    const reserve = Array.from({ length: 16 }, (_, i) =>
      makeCard({ name: `Reserve Card ${i}`, identifier: `r-${i}`, isReserve: true })
    );
    const issues = checkT2ReserveSize(reserve);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("error");
    expect(issues[0].rule).toBe("t2-reserve-size");
  });

  it("passes for 10 reserve cards (mid range)", () => {
    const reserve = [
      makeCard({ name: "Reserve Batch", quantity: 10, isReserve: true }),
    ];
    const issues = checkT2ReserveSize(reserve);
    expect(issues).toHaveLength(0);
  });
});

// ===========================================================================
// E. T2 Quantity Limits
// ===========================================================================

describe("checkT2QuantityLimits", () => {
  // ---- Max 1: 3+ brigades ----

  describe("3+ brigade cards (max 1)", () => {
    it("errors when a 3-brigade card has 2 copies", () => {
      const card = makeCard({
        name: "Triple Brigade Hero",
        brigade: "Blue/Red/Green",
        type: "Hero",
        quantity: 2,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Triple Brigade Hero", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-3plus-brigade"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });

    it("passes when a 3-brigade card has 1 copy", () => {
      const card = makeCard({
        name: "Triple Brigade Hero",
        brigade: "Blue/Red/Green",
        type: "Hero",
        quantity: 1,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Triple Brigade Hero", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-3plus-brigade"
      );
      expect(relevant).toHaveLength(0);
    });
  });

  // ---- Max 1: Multi brigade ----

  describe("Multi brigade cards (max 1)", () => {
    it("errors when a Multi brigade card has 2 copies", () => {
      const card = makeCard({
        name: "Multi Hero",
        brigade: "Multi",
        type: "Hero",
        quantity: 2,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Multi Hero", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-3plus-brigade"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });

    it("passes when a Multi brigade card has 1 copy", () => {
      const card = makeCard({
        name: "Multi Hero",
        brigade: "Multi",
        type: "Hero",
        quantity: 1,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Multi Hero", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-3plus-brigade"
      );
      expect(relevant).toHaveLength(0);
    });
  });

  // Note: Dominant uniqueness (max 1) is tested via checkDominantUnique in rules.test.ts
  // It's not duplicated in checkT2QuantityLimits.

  // ---- Max 2: 2-brigade cards ----

  describe("2-brigade cards (max 2)", () => {
    it("passes when a 2-brigade card has 2 copies", () => {
      const card = makeCard({
        name: "Dual Brigade Hero",
        brigade: "Blue/Red",
        type: "Hero",
        quantity: 2,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Dual Brigade Hero", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-2-brigade"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when a 2-brigade card has 3 copies", () => {
      const card = makeCard({
        name: "Dual Brigade Hero",
        brigade: "Blue/Red",
        type: "Hero",
        quantity: 3,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Dual Brigade Hero", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-2-brigade"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });

  // ---- Max 2: SA Lost Soul ----

  describe("Lost Souls with special ability (max 2)", () => {
    it("passes when an SA Lost Soul has 2 copies", () => {
      const card = makeLostSoul({
        name: "Lost Soul (Wanderer)",
        specialAbility: "When this Lost Soul is rescued, you may search your deck.",
        quantity: 2,
        identifier: "ls-wanderer",
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Lost Soul (Wanderer)", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-ls-ability"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when an SA Lost Soul has 3 copies", () => {
      const card = makeLostSoul({
        name: "Lost Soul (Wanderer)",
        specialAbility: "When this Lost Soul is rescued, you may search your deck.",
        quantity: 3,
        identifier: "ls-wanderer",
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Lost Soul (Wanderer)", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-ls-ability"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });

  // ---- Max 2: SA Site/City with 1 brigade ----

  describe("SA Sites/Cities with 1 brigade (max 2)", () => {
    it("passes when an SA Site with 1 brigade has 2 copies", () => {
      const card = makeCard({
        name: "Bethlehem",
        type: "Site",
        brigade: "Purple",
        specialAbility: "Some special ability text.",
        alignment: "Neutral",
        quantity: 2,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Bethlehem", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-sa-site-city"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when an SA Site with 1 brigade has 3 copies", () => {
      const card = makeCard({
        name: "Bethlehem",
        type: "Site",
        brigade: "Purple",
        specialAbility: "Some special ability text.",
        alignment: "Neutral",
        quantity: 3,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Bethlehem", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-sa-site-city"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });

  // ---- Max 3: Artifact/Fortress/Covenant/Curse with 1 brigade ----

  describe("Artifacts/Fortresses/Covenants/Curses with 1 brigade (max 3)", () => {
    it("passes when an Artifact with 1 brigade has 3 copies", () => {
      const card = makeCard({
        name: "Ark of the Covenant",
        type: "Artifact",
        brigade: "Gold",
        alignment: "Good",
        quantity: 3,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Ark of the Covenant", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-artifact-fortress"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when an Artifact with 1 brigade has 4 copies", () => {
      const card = makeCard({
        name: "Ark of the Covenant",
        type: "Artifact",
        brigade: "Gold",
        alignment: "Good",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Ark of the Covenant", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-artifact-fortress"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });

    it("passes when a Fortress with 1 brigade has 3 copies", () => {
      const card = makeCard({
        name: "Fortified City",
        type: "Fortress",
        brigade: "Black",
        alignment: "Evil",
        quantity: 3,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Fortified City", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-artifact-fortress"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when a Fortress with 1 brigade has 4 copies", () => {
      const card = makeCard({
        name: "Fortified City",
        type: "Fortress",
        brigade: "Black",
        alignment: "Evil",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Fortified City", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-artifact-fortress"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });

  // ---- Max 4: Characters with 1 brigade ----

  describe("Characters with 1 brigade (max 4)", () => {
    it("passes when a Hero with 1 brigade has 4 copies", () => {
      const card = makeCard({
        name: "Moses",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Moses", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-character-enhancement"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when a Hero with 1 brigade has 5 copies", () => {
      const card = makeCard({
        name: "Moses",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Moses", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-character-enhancement"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });

  // ---- Max 4: Enhancements with 1 brigade ----

  describe("Enhancements with 1 brigade (max 4)", () => {
    it("passes when a Good Enhancement with 1 brigade has 4 copies", () => {
      const card = makeCard({
        name: "Faith",
        type: "Good Enhancement",
        brigade: "Blue",
        alignment: "Good",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Faith", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-character-enhancement"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when a Good Enhancement with 1 brigade has 5 copies", () => {
      const card = makeCard({
        name: "Faith",
        type: "Good Enhancement",
        brigade: "Blue",
        alignment: "Good",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Faith", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-character-enhancement"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });

  // ---- Max 4: Non-SA Sites with 1 brigade ----

  describe("Non-SA Sites/Cities with 1 brigade (max 4)", () => {
    it("passes when a non-SA Site with 1 brigade has 4 copies", () => {
      const card = makeCard({
        name: "Jerusalem",
        type: "Site",
        brigade: "Purple",
        alignment: "Neutral",
        specialAbility: "",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Jerusalem", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-vanilla-site"
      );
      expect(relevant).toHaveLength(0);
    });

    it("errors when a non-SA Site with 1 brigade has 5 copies", () => {
      const card = makeCard({
        name: "Jerusalem",
        type: "Site",
        brigade: "Purple",
        alignment: "Neutral",
        specialAbility: "",
        quantity: 5,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Jerusalem", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-vanilla-site"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });

  // ---- Colorless / 0-brigade cards follow type tier ----

  describe("0-brigade (colorless) cards follow type tier", () => {
    it("allows 4 copies of a colorless Hero (max 4, character tier)", () => {
      const card = makeCard({
        name: "Colorless Hero",
        type: "Hero",
        brigade: "",
        alignment: "Good",
        quantity: 4,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Colorless Hero", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) =>
          i.rule === "t2-quantity-character-enhancement" &&
          i.cards?.includes("Colorless Hero")
      );
      expect(relevant).toHaveLength(0);
    });

    it("allows 3 copies of a colorless Artifact (max 3, artifact tier)", () => {
      const card = makeCard({
        name: "Colorless Artifact",
        type: "Artifact",
        brigade: "Colorless",
        alignment: "Neutral",
        quantity: 3,
      });
      const mainDeck = makeValidMainDeck(100, [card]);
      const groups = [makeGroup("Colorless Artifact", [card])];
      const issues = checkT2QuantityLimits(mainDeck, [], groups);
      const relevant = issues.filter(
        (i) =>
          i.rule === "t2-quantity-artifact-fortress" &&
          i.cards?.includes("Colorless Artifact")
      );
      expect(relevant).toHaveLength(0);
    });
  });

  // ---- Cross main + reserve counting ----

  describe("quantity counts across main deck and reserve", () => {
    it("errors when total quantity across main and reserve exceeds limit", () => {
      const mainCard = makeCard({
        name: "Moses",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 3,
      });
      const reserveCard = makeCard({
        name: "Moses",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 2,
        isReserve: true,
      });
      const mainDeck = makeValidMainDeck(100, [mainCard]);
      const reserve = [reserveCard];
      const groups = [makeGroup("Moses", [mainCard, reserveCard])];
      const issues = checkT2QuantityLimits(mainDeck, reserve, groups);
      const relevant = issues.filter(
        (i) => i.rule === "t2-quantity-character-enhancement"
      );
      expect(relevant).toHaveLength(1);
      expect(relevant[0].type).toBe("error");
    });
  });
});

// ===========================================================================
// F. Good/Evil Balance
// ===========================================================================

describe("checkGoodEvilBalance", () => {
  it("passes when good and evil counts are equal in main deck", () => {
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 43,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 43,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, []);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    expect(relevant).toHaveLength(0);
  });

  it("errors when main deck has more good than evil", () => {
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 50,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 36,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, []);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    expect(relevant[0].type).toBe("error");
    expect(relevant[0].message).toContain("Good");
  });

  it("errors when main deck has more evil than good", () => {
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 36,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 50,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, []);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    expect(relevant[0].type).toBe("error");
  });

  it('dual alignment "Good/Evil" counts as neutral and does not affect balance', () => {
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 40,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 40,
      }),
      makeCard({
        name: "Neutral Char",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good/Evil",
        quantity: 6,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, []);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    expect(relevant).toHaveLength(0);
  });

  it('dual alignment "Good/Neutral" counts as good', () => {
    // 43 good (via alignment) + 2 Good/Neutral = 45 good, 43 evil = unbalanced
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 43,
      }),
      makeCard({
        name: "Good/Neutral Char",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good/Neutral",
        quantity: 2,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 41,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, []);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    // 45 good vs 41 evil = unbalanced
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    expect(relevant[0].type).toBe("error");
  });

  it("counts ALL cards toward balance including Dominants and Artifacts", () => {
    const mainDeck = [
      ...makeLostSouls(14), // neutral — don't affect balance
      makeDominant({ name: "Son of God", alignment: "Good", quantity: 1 }),
      makeDominant({ name: "Falling Away", alignment: "Evil", quantity: 1 }),
      makeCard({
        name: "Ark of the Covenant",
        type: "Artifact",
        brigade: "Gold",
        alignment: "Good",
        quantity: 1,
      }),
      makeCard({
        name: "Curse of Ham",
        type: "Curse",
        brigade: "Black",
        alignment: "Evil",
        quantity: 1,
      }),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 40,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 40,
      }),
      makeCard({
        name: "Some Site",
        type: "Site",
        brigade: "Purple",
        alignment: "Neutral",
        quantity: 2,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, []);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    // 42 good (40 hero + 1 dominant + 1 artifact) = 42 evil (40 EC + 1 dominant + 1 curse)
    expect(relevant).toHaveLength(0);
  });

  it("checks reserve separately from main deck", () => {
    // Main deck is balanced, but reserve is not
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 43,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 43,
      }),
    ];
    const reserve = [
      makeCard({
        name: "Reserve Hero",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 5,
        isReserve: true,
      }),
      makeCard({
        name: "Reserve EC",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 3,
        isReserve: true,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, reserve);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    // Main deck balanced (43=43), reserve unbalanced (5 good != 3 evil)
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    expect(relevant[0].type).toBe("error");
  });

  it("passes when both main deck and reserve are balanced", () => {
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 43,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 43,
      }),
    ];
    const reserve = [
      makeCard({
        name: "Reserve Hero",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 4,
        isReserve: true,
      }),
      makeCard({
        name: "Reserve EC",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 4,
        isReserve: true,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, reserve);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    expect(relevant).toHaveLength(0);
  });

  it("counts Sites, Cities, Covenants, Curses, Fortresses toward balance", () => {
    const mainDeck = [
      ...makeLostSouls(14),
      makeCard({
        name: "Hero A",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 35,
      }),
      makeCard({
        name: "Evil Char A",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 35,
      }),
      // Good side: 2 Sites + 2 Covenants + 1 Fortress = 5 Good
      makeCard({
        name: "A Good Site",
        type: "Site",
        brigade: "Purple",
        alignment: "Good",
        quantity: 2,
      }),
      makeCard({
        name: "A Covenant",
        type: "Covenant",
        brigade: "Gold",
        alignment: "Good",
        quantity: 2,
      }),
      makeCard({
        name: "A Good Fortress",
        type: "Fortress",
        brigade: "White",
        alignment: "Good",
        quantity: 1,
      }),
      // Evil side: 2 Cities + 2 Curses + 1 Fortress = 5 Evil
      makeCard({
        name: "A City",
        type: "City",
        brigade: "Purple",
        alignment: "Evil",
        quantity: 2,
      }),
      makeCard({
        name: "A Curse",
        type: "Curse",
        brigade: "Crimson",
        alignment: "Evil",
        quantity: 2,
      }),
      makeCard({
        name: "An Evil Fortress",
        type: "Fortress",
        brigade: "Black",
        alignment: "Evil",
        quantity: 1,
      }),
      // Neutral filler
      makeCard({
        name: "Neutral Site",
        type: "Site",
        alignment: "Neutral",
        quantity: 4,
      }),
    ];
    const issues = checkGoodEvilBalance(mainDeck, []);
    const relevant = issues.filter((i) => i.rule === "t2-good-evil-balance");
    // 40 good (35 hero + 2 site + 2 covenant + 1 fortress) = 40 evil (35 EC + 2 city + 2 curse + 1 fortress)
    expect(relevant).toHaveLength(0);
  });
});

// ===========================================================================
// G. validateT2Rules Integration
// ===========================================================================

describe("validateT2Rules", () => {
  it("returns no errors for a well-formed 100-card T2 deck", () => {
    const mainDeck = makeSimpleBalancedDeck(100);
    const reserve: ResolvedCard[] = [];

    // Build card groups from the deck
    const groupMap = new Map<string, ResolvedCard[]>();
    for (const card of [...mainDeck, ...reserve]) {
      const key = card.canonicalName ?? card.name;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(card);
    }
    const cardGroups: CardGroup[] = Array.from(groupMap.entries()).map(
      ([name, cards]) => makeGroup(name, cards)
    );

    const issues = validateT2Rules(mainDeck, reserve, cardGroups);
    const errors = issues.filter((i) => i.type === "error");
    expect(errors).toHaveLength(0);
  });

  it("detects multiple simultaneous violations", () => {
    // Build a deck with multiple problems:
    // 1. Deck too small (90 cards)
    // 2. Wrong LS count (put 7 instead of whatever is needed)
    // 3. Unbalanced good/evil
    const lostSouls = makeLostSouls(7);
    const heroes = makeCard({
      name: "Hero A",
      type: "Hero",
      brigade: "Blue",
      alignment: "Good",
      quantity: 60,
    });
    const evilChars = makeCard({
      name: "Evil Char A",
      type: "Evil Character",
      brigade: "Black",
      alignment: "Evil",
      quantity: 23,
    });
    const mainDeck = [...lostSouls, heroes, evilChars];
    // total = 7 + 60 + 23 = 90 cards (too small)
    // LS = 7 (wrong)
    // good = 60, evil = 23 (unbalanced)

    const groupMap = new Map<string, ResolvedCard[]>();
    for (const card of mainDeck) {
      const key = card.canonicalName ?? card.name;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(card);
    }
    const cardGroups: CardGroup[] = Array.from(groupMap.entries()).map(
      ([name, cards]) => makeGroup(name, cards)
    );

    const issues = validateT2Rules(mainDeck, [], cardGroups);
    const errors = issues.filter((i) => i.type === "error");

    // Should detect at least: deck size, LS count, good/evil balance
    const ruleIds = errors.map((e) => e.rule);
    expect(ruleIds).toContain("t2-deck-size");
    expect(ruleIds).toContain("t2-lost-soul-count");
    expect(ruleIds).toContain("t2-good-evil-balance");
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("validates a deck with a balanced reserve", () => {
    const mainDeck = makeSimpleBalancedDeck(100);
    const reserve = [
      makeCard({
        name: "Reserve Hero",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 3,
        isReserve: true,
      }),
      makeCard({
        name: "Reserve EC",
        type: "Evil Character",
        brigade: "Black",
        alignment: "Evil",
        quantity: 3,
        isReserve: true,
      }),
    ];

    const groupMap = new Map<string, ResolvedCard[]>();
    for (const card of [...mainDeck, ...reserve]) {
      const key = card.canonicalName ?? card.name;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(card);
    }
    const cardGroups: CardGroup[] = Array.from(groupMap.entries()).map(
      ([name, cards]) => makeGroup(name, cards)
    );

    const issues = validateT2Rules(mainDeck, reserve, cardGroups);
    const errors = issues.filter((i) => i.type === "error");
    expect(errors).toHaveLength(0);
  });

  it("catches reserve-specific balance violation even when main deck is valid", () => {
    const mainDeck = makeSimpleBalancedDeck(100);
    const reserve = [
      makeCard({
        name: "Reserve Hero",
        type: "Hero",
        brigade: "Blue",
        alignment: "Good",
        quantity: 5,
        isReserve: true,
      }),
      // No evil in reserve
    ];

    const groupMap = new Map<string, ResolvedCard[]>();
    for (const card of [...mainDeck, ...reserve]) {
      const key = card.canonicalName ?? card.name;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(card);
    }
    const cardGroups: CardGroup[] = Array.from(groupMap.entries()).map(
      ([name, cards]) => makeGroup(name, cards)
    );

    const issues = validateT2Rules(mainDeck, reserve, cardGroups);
    const balanceErrors = issues.filter(
      (i) => i.rule === "t2-good-evil-balance" && i.type === "error"
    );
    expect(balanceErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("catches oversized reserve", () => {
    const mainDeck = makeSimpleBalancedDeck(100);
    const reserve = Array.from({ length: 16 }, (_, i) =>
      makeCard({
        name: `Reserve Card ${i}`,
        identifier: `r-${i}`,
        isReserve: true,
        // Alternate good/evil for balance
        type: i % 2 === 0 ? "Hero" : "Evil Character",
        brigade: i % 2 === 0 ? "Blue" : "Black",
        alignment: i % 2 === 0 ? "Good" : "Evil",
      })
    );

    const groupMap = new Map<string, ResolvedCard[]>();
    for (const card of [...mainDeck, ...reserve]) {
      const key = card.canonicalName ?? card.name;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(card);
    }
    const cardGroups: CardGroup[] = Array.from(groupMap.entries()).map(
      ([name, cards]) => makeGroup(name, cards)
    );

    const issues = validateT2Rules(mainDeck, reserve, cardGroups);
    const sizeErrors = issues.filter(
      (i) => i.rule === "t2-reserve-size" && i.type === "error"
    );
    expect(sizeErrors).toHaveLength(1);
  });

  it("catches quantity violations in an otherwise valid deck", () => {
    const overLimitCard = makeCard({
      name: "Moses",
      type: "Hero",
      brigade: "Blue",
      alignment: "Good",
      quantity: 5,
    });
    const mainDeck = makeValidMainDeck(100, [overLimitCard]);
    const cardGroups = [makeGroup("Moses", [overLimitCard])];

    const issues = validateT2Rules(mainDeck, [], cardGroups);
    const quantityErrors = issues.filter(
      (i) =>
        i.rule === "t2-quantity-character-enhancement" && i.type === "error"
    );
    expect(quantityErrors).toHaveLength(1);
  });
});
