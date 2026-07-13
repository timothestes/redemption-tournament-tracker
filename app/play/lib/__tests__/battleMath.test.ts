import { describe, it, expect } from 'vitest';
import {
  battleSideOf,
  sideTotals,
  computeInitiative,
  brigadeMismatch,
  summarizeAutoReturn,
  type BattleCardLike,
} from '../battleMath';

// Card factory. Defaults land the card on its OWNER's own half
// (dbY=0.6, cardRelH=0.1 -> centerY=0.65 >= 0.5) so most totals/initiative
// tests can just set `ownerSeat` to place a card on a given battle side.
// dbY is stored owner-local (spec §3), so a card's side-derivation math is
// identical regardless of which player owns it or which client is
// rendering it -- no separate "opponent-owned" variant is needed for these
// tests; battleSideOf's own describe block below covers the geometry.
function mkCard(overrides: Partial<BattleCardLike> = {}): BattleCardLike {
  return {
    ownerSeat: '0',
    dbY: 0.6,
    cardRelH: 0.1,
    strength: '5',
    toughness: '5',
    brigade: '',
    cardType: 'Hero',
    specialAbility: '',
    isFlipped: false,
    cardName: 'Test Hero',
    ...overrides,
  };
}

describe('battleSideOf', () => {
  it('centerY >= 0.5 puts the card on its owner side', () => {
    const c = mkCard({ ownerSeat: '0', dbY: 0.5, cardRelH: 0.1 }); // center 0.55
    expect(battleSideOf(c)).toBe('0');
  });

  it('centerY < 0.5 puts the card on the opponent side (dragged across the centerline)', () => {
    const c = mkCard({ ownerSeat: '0', dbY: 0.1, cardRelH: 0.1 }); // center 0.15
    expect(battleSideOf(c)).toBe('1');
  });

  it('centerY exactly 0.5 is inclusive (>=), stays on owner side', () => {
    const c = mkCard({ ownerSeat: '0', dbY: 0.4, cardRelH: 0.2 }); // center exactly 0.5
    expect(battleSideOf(c)).toBe('0');
  });

  it('works symmetrically for seat 1 as owner', () => {
    const c = mkCard({ ownerSeat: '1', dbY: 0.6, cardRelH: 0.1 }); // center 0.65
    expect(battleSideOf(c)).toBe('1');
  });

  it('anchor-clamp regression: dbY=0.33, cardRelH=0.67 (max clamped anchor) is OWN side', () => {
    // Write-time clamping caps an own-card anchor at 1 - cardRelH within a
    // 0.19-height band, so dbY alone can sit at 0.33 even for a card that's
    // fully on the owner's half. centerY = 0.33 + 0.67/2 = 0.665 >= 0.5.
    // An anchor-only `dbY >= 0.5` test would wrongly classify this as
    // opponent-side (0.33 < 0.5) -- this is the regression this lib guards.
    const c = mkCard({ ownerSeat: '0', dbY: 0.33, cardRelH: 0.67 });
    expect(battleSideOf(c)).toBe('0');
  });
});

describe('sideTotals', () => {
  it('sums strength/toughness only for cards on the requested side', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '4' }),
      mkCard({ ownerSeat: '0', strength: '2', toughness: '1' }),
      mkCard({ ownerSeat: '1', strength: '9', toughness: '9' }),
    ];
    expect(sideTotals(cards, '0')).toEqual({ str: 5, tgh: 5, hasUnknown: false });
    expect(sideTotals(cards, '1')).toEqual({ str: 9, tgh: 9, hasUnknown: false });
  });

  it('unparseable stats ("", "*", "X") count as 0 and set hasUnknown', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '', toughness: '4' }),
      mkCard({ ownerSeat: '0', strength: '*', toughness: '4' }),
      mkCard({ ownerSeat: '0', strength: 'X', toughness: '4' }),
    ];
    const totals = sideTotals(cards, '0');
    expect(totals.str).toBe(0);
    expect(totals.tgh).toBe(12);
    expect(totals.hasUnknown).toBe(true);
  });

  it('face-down (isFlipped) cards are excluded from sums entirely and set hasUnknown', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5', isFlipped: false }),
      mkCard({ ownerSeat: '0', strength: '99', toughness: '99', isFlipped: true }),
    ];
    const totals = sideTotals(cards, '0');
    expect(totals.str).toBe(5);
    expect(totals.tgh).toBe(5);
    expect(totals.hasUnknown).toBe(true);
  });

  it('an empty side returns zero totals with no unknown flag', () => {
    const cards = [mkCard({ ownerSeat: '1' })];
    expect(sideTotals(cards, '0')).toEqual({ str: 0, tgh: 0, hasUnknown: false });
  });
});

describe('computeInitiative — REG table rows', () => {
  it('losing side has initiative: attacker 4/4 vs defender 5/5 (strA<tghB strict edge)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '4', toughness: '4' }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'initiative', seat: '0', reason: 'losing' });
  });

  it('losing boundary: tghA<=strB is inclusive (tghA===strB=5 still counts as losing)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '5' }), // tghA=5
      mkCard({ ownerSeat: '1', strength: '5', toughness: '9' }), // strB=5
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'initiative', seat: '0', reason: 'losing' });
  });

  it('winning side never gets initiative directly — asserted via the losing (defender) side', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '9', toughness: '9' }), // overwhelming attacker
      mkCard({ ownerSeat: '1', strength: '1', toughness: '1' }), // outmatched defender
    ];
    const result = computeInitiative(cards, '0', '');
    expect(result).toEqual({ kind: 'initiative', seat: '1', reason: 'losing' });
  });

  it('mutual destruction: 5/5 vs 5/5 (str>=opp tgh via equality, not stalemate)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5' }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '1')).toEqual({
      kind: 'initiative',
      seat: '0',
      reason: 'mutual-destruction',
    });
  });

  it('stalemate: 3/9 vs 3/9 (tgh>opp str strictly)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '9' }),
      mkCard({ ownerSeat: '1', strength: '3', toughness: '9' }),
    ];
    expect(computeInitiative(cards, '0', '0')).toEqual({ kind: 'initiative', seat: '1', reason: 'stalemate' });
  });

  it('stalemate/mutual initiative seat is whoever did NOT play last', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '9' }),
      mkCard({ ownerSeat: '1', strength: '3', toughness: '9' }),
    ];
    expect(computeInitiative(cards, '0', '1')).toEqual({ kind: 'initiative', seat: '0', reason: 'stalemate' });
  });

  it('stalemate with lastPlayBySeat==="" is unknown (spec is silent on a default)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '9' }),
      mkCard({ ownerSeat: '1', strength: '3', toughness: '9' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'unknown' });
  });

  it('mutual destruction with lastPlayBySeat==="" is unknown', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5' }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'unknown' });
  });
});

describe('computeInitiative — empty-side and unknown-stat states', () => {
  it('defender side empty of characters -> waiting-blocker', () => {
    const cards = [mkCard({ ownerSeat: '0', cardType: 'Hero' })];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'waiting-blocker' });
  });

  it('attacker side empty of characters -> no-attacker', () => {
    const cards = [mkCard({ ownerSeat: '1', cardType: 'Evil Character' })];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'no-attacker' });
  });

  it('both sides empty of characters -> waiting-blocker (band just opened)', () => {
    expect(computeInitiative([], '0', '')).toEqual({ kind: 'waiting-blocker' });
  });

  it('non-character cards on both sides (e.g. Sites/Enhancements) still count as empty', () => {
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'GE', strength: '', toughness: '' }),
      mkCard({ ownerSeat: '1', cardType: 'Site', strength: '', toughness: '' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'waiting-blocker' });
  });

  it('either side hasUnknown (face-down card) -> unknown even with both sides populated', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5', isFlipped: true }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '1')).toEqual({ kind: 'unknown' });
  });

  it('either side hasUnknown (unparseable "*") -> unknown even with a clear REG row otherwise', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '4', toughness: '4' }),
      mkCard({ ownerSeat: '1', strength: '*', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'unknown' });
  });

  it('recognizes Evil Character (not just Hero) for the empty-side presence check', () => {
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'Hero', strength: '4', toughness: '4' }),
      mkCard({ ownerSeat: '1', cardType: 'Evil Character', strength: '5', toughness: '5' }),
    ];
    // Both sides populated with real characters -> falls through to the REG table,
    // not waiting-blocker/no-attacker.
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'initiative', seat: '0', reason: 'losing' });
  });
});

describe('brigadeMismatch', () => {
  it('exact single-brigade match -> no mismatch', () => {
    const enh = mkCard({ brigade: 'Good Gold' });
    const chars = [mkCard({ brigade: 'Good Gold' })];
    expect(brigadeMismatch(enh, chars)).toBe(false);
  });

  it('no matching brigade among same-side characters -> mismatch', () => {
    const enh = mkCard({ brigade: 'Good Gold' });
    const chars = [mkCard({ brigade: 'Evil Brown' })];
    expect(brigadeMismatch(enh, chars)).toBe(true);
  });

  it('"Multi" on the enhancement matches anything', () => {
    const enh = mkCard({ brigade: 'Multi' });
    const chars = [mkCard({ brigade: 'Evil Brown' })];
    expect(brigadeMismatch(enh, chars)).toBe(false);
  });

  it('"Good Multi" / "Evil Multi" on a character matches any enhancement brigade', () => {
    const enh = mkCard({ brigade: 'Good Gold' });
    const chars = [mkCard({ brigade: 'Evil Multi' })];
    expect(brigadeMismatch(enh, chars)).toBe(false);
  });

  it('empty/neutral brigade on the enhancement matches anything', () => {
    const enh = mkCard({ brigade: '' });
    const chars = [mkCard({ brigade: 'Evil Brown' })];
    expect(brigadeMismatch(enh, chars)).toBe(false);
  });

  it('"Good Gold/Evil Gold" splits on "/" and matches a character with just "Evil Gold"', () => {
    const enh = mkCard({ brigade: 'Good Gold/Evil Gold' });
    const chars = [mkCard({ brigade: 'Evil Gold' })];
    expect(brigadeMismatch(enh, chars)).toBe(false);
  });

  it('no same-side characters present + a real enhancement brigade -> mismatch', () => {
    const enh = mkCard({ brigade: 'Good Gold' });
    expect(brigadeMismatch(enh, [])).toBe(true);
  });

  it('no same-side characters present + neutral enhancement brigade -> still no mismatch', () => {
    const enh = mkCard({ brigade: '' });
    expect(brigadeMismatch(enh, [])).toBe(false);
  });
});

describe('summarizeAutoReturn', () => {
  it('an equipped card (equippedToInstanceId set) counts as weaponsAttached, taking priority over its type', () => {
    const cards = [
      mkCard({ cardType: 'GE', equippedToInstanceId: 3n }), // would otherwise be an enhancement
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary.weaponsAttached).toBe(1);
    expect(summary.toDiscard).toBe(0);
    expect(summary.toTerritory).toBe(0);
  });

  it('equippedToInstanceId accepts a plain number too', () => {
    const cards = [mkCard({ cardType: 'GE', equippedToInstanceId: 7 })];
    expect(summarizeAutoReturn(cards).weaponsAttached).toBe(1);
  });

  it('equippedToInstanceId of 0n/0 means unattached (default) and falls through to its type', () => {
    const cards = [mkCard({ cardType: 'Hero', equippedToInstanceId: 0n })];
    const summary = summarizeAutoReturn(cards);
    expect(summary.weaponsAttached).toBe(0);
    expect(summary.toTerritory).toBe(1);
  });

  it('a Lost Soul card (cardType "LS") routes to toLandOfBondage', () => {
    const cards = [mkCard({ cardType: 'LS', cardName: 'Lost Soul (Adam)' })];
    expect(summarizeAutoReturn(cards).toLandOfBondage).toBe(1);
  });

  it('a Lost Soul recognized only by cardName ("lost soul" substring) still routes to toLandOfBondage', () => {
    const cards = [mkCard({ cardType: 'TOKEN', cardName: 'Lost Soul Token' })];
    expect(summarizeAutoReturn(cards).toLandOfBondage).toBe(1);
  });

  it('a character card routes to toTerritory', () => {
    const cards = [mkCard({ cardType: 'Hero' }), mkCard({ cardType: 'Evil Character' })];
    expect(summarizeAutoReturn(cards).toTerritory).toBe(2);
  });

  it('a GE/EE enhancement with no keep-heuristic match routes to toDiscard', () => {
    const cards = [mkCard({ cardType: 'GE', specialAbility: 'Adds 2 strength.', cardName: 'Sword' })];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(1);
    expect(summary.keptInPlay).toEqual([]);
  });

  it('a GE/EE enhancement whose specialAbility matches the "place" keep heuristic is kept in territory', () => {
    const cards = [
      mkCard({ cardType: 'EE', specialAbility: 'Place this card in your territory.', cardName: 'Curse of Stone' }),
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(0);
    expect(summary.toTerritory).toBe(1);
    expect(summary.keptInPlay).toEqual(['Curse of Stone']);
  });

  it('"take the place of" / "in place of" phrasings are excluded from the keep heuristic (still discarded)', () => {
    const cards = [
      mkCard({ cardType: 'GE', specialAbility: 'May take the place of a Hero in battle.', cardName: 'Stand-In' }),
      mkCard({ cardType: 'GE', specialAbility: 'Used in place of a weapon.', cardName: 'Substitute' }),
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(2);
    expect(summary.keptInPlay).toEqual([]);
  });

  it('cardType with a slash still matches the exact GE/EE segment (e.g. "Artifact/GE")', () => {
    const cards = [mkCard({ cardType: 'Artifact/GE', specialAbility: '', cardName: 'Odd Combo' })];
    expect(summarizeAutoReturn(cards).toDiscard).toBe(1);
  });

  it('everything else (Dominant/Artifact/Curse/Fortress/unknown type) routes to toTerritory', () => {
    const cards = [
      mkCard({ cardType: 'Dominant' }),
      mkCard({ cardType: 'Artifact' }),
      mkCard({ cardType: 'Fortress' }),
      mkCard({ cardType: 'SomeUnknownType' }),
    ];
    expect(summarizeAutoReturn(cards).toTerritory).toBe(4);
  });

  it('aggregates a mixed battle band into the correct bucket for every card', () => {
    const cards = [
      mkCard({ cardType: 'GE', equippedToInstanceId: 1n }), // weapon, attached
      mkCard({ cardType: 'LS', cardName: 'Lost Soul (Eve)' }), // -> LoB
      mkCard({ cardType: 'Hero' }), // -> territory
      mkCard({ cardType: 'GE', specialAbility: '', cardName: 'Fireball' }), // -> discard
      mkCard({ cardType: 'EE', specialAbility: 'Place in territory.', cardName: 'Curse' }), // -> kept in territory
      mkCard({ cardType: 'Artifact' }), // -> territory (rule 5)
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary).toEqual({
      toTerritory: 3, // Hero + kept Curse + Artifact
      toDiscard: 1, // Fireball
      toLandOfBondage: 1, // Lost Soul (Eve)
      keptInPlay: ['Curse'],
      weaponsAttached: 1,
    });
  });
});
