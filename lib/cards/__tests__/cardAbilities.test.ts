// lib/cards/__tests__/cardAbilities.test.ts
import { describe, it, expect } from 'vitest';
import { findCard } from '../lookup';
import { CARD_ABILITIES, SPECIAL_TOKEN_CARDS, abilityLabel, getAbilitiesForCard, resolveTokenCard } from '../cardAbilities';

describe('CARD_ABILITIES registry', () => {
  it('every key resolves to a real card via findCard()', () => {
    const bad: string[] = [];
    for (const identifier of Object.keys(CARD_ABILITIES)) {
      if (!findCard(identifier)) bad.push(identifier);
    }
    expect(bad).toEqual([]);
  });

  it('every spawn_token.tokenName resolves via resolveTokenCard()', () => {
    // Real carddata tokens (Proselyte, etc.) resolve via findCard; handcrafted
    // tokens (Harvest Soul, Daniel Soul, etc.) resolve via SPECIAL_TOKEN_CARDS.
    const bad: Array<{ source: string; tokenName: string }> = [];
    for (const [source, abilities] of Object.entries(CARD_ABILITIES)) {
      for (const a of abilities) {
        if (a.type === 'spawn_token' && !resolveTokenCard(a.tokenName)) {
          bad.push({ source, tokenName: a.tokenName });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every SPECIAL_TOKEN_CARDS image path resolves to a public/gameplay asset', () => {
    for (const [name, data] of Object.entries(SPECIAL_TOKEN_CARDS)) {
      expect(data.imgFile, `${name} imgFile`).toMatch(/^\/gameplay\/.+\.(png|jpg|jpeg|svg|webp)$/i);
    }
  });

  it('getAbilitiesForCard returns [] for unknown identifiers', () => {
    expect(getAbilitiesForCard('Nonexistent Card')).toEqual([]);
  });

  it('SpacetimeDB duplicate of CARD_ABILITIES stays in sync', async () => {
    const spacetimeCopy = await import('@/spacetimedb/src/cardAbilities');
    expect(spacetimeCopy.CARD_ABILITIES).toEqual(CARD_ABILITIES);
  });

  it('every spawn_token in the registry has metadata in TOKEN_CARD_DATA (server-side)', async () => {
    const { TOKEN_CARD_DATA } = await import('@/spacetimedb/src/cardAbilities');
    const bad: string[] = [];
    for (const abilities of Object.values(CARD_ABILITIES)) {
      for (const a of abilities) {
        if (a.type === 'spawn_token' && !TOKEN_CARD_DATA[a.tokenName]) {
          bad.push(a.tokenName);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('abilityLabel', () => {
  it('formats singular spawn_token without multiplier', () => {
    expect(abilityLabel({ type: 'spawn_token', tokenName: 'Proselyte Token' }))
      .toBe('Create Proselyte Token');
  });

  it('formats spawn_token with count > 1 using ×N prefix', () => {
    expect(abilityLabel({ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }))
      .toBe('Create 2× Violent Possessor Token');
  });

  it('formats shuffle_and_draw', () => {
    expect(abilityLabel({ type: 'shuffle_and_draw', shuffleCount: 6, drawCount: 6 }))
      .toBe('Shuffle 6 from hand, draw 6');
  });

  it('uses explicit label for custom abilities', () => {
    expect(abilityLabel({ type: 'custom', reducerName: 'foo', label: 'Do Thing' }))
      .toBe('Do Thing');
  });
});
