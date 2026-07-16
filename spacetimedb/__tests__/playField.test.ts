import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it via
// the **/__tests__/** glob.
import { isLeavingPlayField } from '../src/playField';

// A card "leaves the play field" only when it moves from an on-field zone
// (territory, land-of-bondage, battle) to an OFF-field zone (deck, hand,
// discard, reserve, banish, soul-deck, land-of-redemption). Relocations that
// keep the card in play — most importantly the battle-zone round trip — are
// NOT leaving play. This predicate gates clearing the lasting `isMeek`
// characteristic and manual `notes` in leavePlayFieldOverrides.
describe('isLeavingPlayField', () => {
  it('does not count the battle round trip as leaving play (the meek bug)', () => {
    // Entering battle from territory, and returning battle -> territory, keep
    // the card on the field, so a meek hero must stay meek across both.
    expect(isLeavingPlayField('territory', 'battle')).toBe(false);
    expect(isLeavingPlayField('battle', 'territory')).toBe(false);
  });

  it('does not count moves between any two on-field zones as leaving play', () => {
    expect(isLeavingPlayField('territory', 'land-of-bondage')).toBe(false);
    expect(isLeavingPlayField('land-of-bondage', 'battle')).toBe(false);
    expect(isLeavingPlayField('battle', 'land-of-bondage')).toBe(false);
  });

  it('counts a move to an off-field zone as leaving play', () => {
    for (const to of ['deck', 'hand', 'discard', 'reserve', 'banish', 'soul-deck', 'land-of-redemption']) {
      expect(isLeavingPlayField('territory', to)).toBe(true);
      expect(isLeavingPlayField('battle', to)).toBe(true);
      expect(isLeavingPlayField('land-of-bondage', to)).toBe(true);
    }
  });

  it('is false when the card starts off-field, regardless of destination', () => {
    expect(isLeavingPlayField('deck', 'territory')).toBe(false);
    expect(isLeavingPlayField('hand', 'battle')).toBe(false);
    expect(isLeavingPlayField('discard', 'discard')).toBe(false);
  });

  it('is false for a no-op move within the same on-field zone', () => {
    expect(isLeavingPlayField('territory', 'territory')).toBe(false);
    expect(isLeavingPlayField('battle', 'battle')).toBe(false);
  });
});
