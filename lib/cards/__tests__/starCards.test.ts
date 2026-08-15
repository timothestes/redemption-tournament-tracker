import { describe, it, expect } from 'vitest';
import { isStarAbilityText, STAR_ABILITY_RE } from '@/lib/cards/starCards';
import { CARDS } from '@/lib/cards/lookup';

describe('isStarAbilityText', () => {
  it('matches both printed star markers', () => {
    expect(isStarAbilityText('(Star) Look at the top card of a deck.')).toBe(true);
    expect(isStarAbilityText('STAR: Look at the top 10 cards of a deck.')).toBe(true);
  });

  it('is anchored — "star" elsewhere in the text does not match', () => {
    expect(isStarAbilityText('At the start of your turn, draw 1.')).toBe(false);
    expect(isStarAbilityText('Band to Aristarchus.')).toBe(false);
    expect(isStarAbilityText('Topdeck a good * card. STAR: not really')).toBe(false);
  });

  it('handles empty and absent text', () => {
    expect(isStarAbilityText('')).toBe(false);
    expect(isStarAbilityText(null)).toBe(false);
    expect(isStarAbilityText(undefined)).toBe(false);
  });

  it('matches exactly the 244 star cards in the pool', () => {
    const matched = CARDS.filter((c) => isStarAbilityText(c.specialAbility));
    expect(matched.length).toBe(244);
  });

  it('has no false negatives — every card whose text mentions a star marker is matched', () => {
    const markerish = CARDS.filter((c) =>
      /(\(star\)|star:)/i.test(c.specialAbility ?? ''),
    );
    for (const c of markerish) {
      expect(isStarAbilityText(c.specialAbility)).toBe(true);
    }
  });

  it('every match begins with a star marker', () => {
    for (const c of CARDS.filter((x) => isStarAbilityText(x.specialAbility))) {
      expect(c.specialAbility).toMatch(STAR_ABILITY_RE);
    }
  });
});
