// lib/cards/__tests__/cardAbilities.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { findCard } from '../lookup';
import {
  CARD_ABILITIES,
  SPECIAL_TOKEN_CARDS,
  abilityLabel,
  getAbilitiesForCard,
  resolveTokenCard,
  IMITATE_SOUL_IMAGES as libImitateImages,
  CARD_ABILITIES as libCardAbilities,
  simplifyLostSoulName,
} from '../cardAbilities';
import {
  IMITATE_SOUL_IMAGES as serverImitateImages,
  IMITATE_ORIGINAL_IMG,
} from '@/spacetimedb/src/cardAbilities';

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

  it('formats all_players_shuffle_and_draw', () => {
    expect(abilityLabel({ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }))
      .toBe('All players shuffle 6 from hand, draw 6');
  });

  it('formats reveal_own_deck for top position', () => {
    expect(abilityLabel({ type: 'reveal_own_deck', position: 'top', count: 6 }))
      .toBe('Reveal top 6 cards of deck');
  });

  it('formats reveal_own_deck for random position', () => {
    expect(abilityLabel({ type: 'reveal_own_deck', position: 'random', count: 3 }))
      .toBe('Reveal 3 random cards of deck');
  });

  it('formats reveal_own_deck singular', () => {
    expect(abilityLabel({ type: 'reveal_own_deck', position: 'bottom', count: 1 }))
      .toBe('Reveal bottom 1 card of deck');
  });

  it('uses explicit label for custom abilities', () => {
    expect(abilityLabel({ type: 'custom', reducerName: 'foo', label: 'Do Thing' }))
      .toBe('Do Thing');
  });

  it('formats discard_opponent_deck for top position singular', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'top', count: 1 }))
      .toBe("Discard top 1 card of opponent's deck");
  });

  it('formats discard_opponent_deck for top position plural', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'top', count: 3 }))
      .toBe("Discard top 3 cards of opponent's deck");
  });

  it('formats discard_opponent_deck for bottom position', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'bottom', count: 2 }))
      .toBe("Discard bottom 2 cards of opponent's deck");
  });

  it('formats discard_opponent_deck for random position', () => {
    expect(abilityLabel({ type: 'discard_opponent_deck', position: 'random', count: 4 }))
      .toBe("Discard 4 random cards of opponent's deck");
  });
});

describe('IMITATE_SOUL_IMAGES parity + integrity', () => {
  it('lib and spacetimedb copies are identical', () => {
    expect(serverImitateImages).toEqual(libImitateImages);
  });

  it('every key resolves to a real card via findCard', () => {
    for (const cardName of Object.keys(libImitateImages)) {
      expect(findCard(cardName), `findCard(${JSON.stringify(cardName)})`).toBeTruthy();
    }
  });

  it('every value points to an existing file under public/imitate-souls/cards/', () => {
    for (const [cardName, imgPath] of Object.entries(libImitateImages)) {
      const absPath = path.join(process.cwd(), 'public', imgPath);
      expect(
        fs.existsSync(absPath),
        `${cardName} → ${imgPath} (resolved: ${absPath})`,
      ).toBe(true);
    }
  });

  it('both Imitate Lost Soul variants are registered with imitate_lost_soul', () => {
    const a = libCardAbilities['Lost Soul "Imitate" [III John 1:11]'];
    const b = libCardAbilities['Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]'];
    expect(a, 'regular variant registered').toBeDefined();
    expect(b, 'AB variant registered (note literal double space)').toBeDefined();
    expect(a?.[0]?.type).toBe('imitate_lost_soul');
    expect(b?.[0]?.type).toBe('imitate_lost_soul');
  });

  it('IMITATE_ORIGINAL_IMG matches findCard().imgFile for each Imitate variant', () => {
    for (const [cardName, originalImg] of Object.entries(IMITATE_ORIGINAL_IMG)) {
      const card = findCard(cardName);
      expect(card, `findCard(${cardName})`).toBeTruthy();
      expect(card?.imgFile).toBe(originalImg);
    }
  });
});

describe('simplifyLostSoulName', () => {
  it('extracts the quoted name when present', () => {
    expect(simplifyLostSoulName('Lost Soul "Awake" [Ephesians 5:14 - TPC]')).toBe('Awake');
    expect(simplifyLostSoulName('Lost Soul "Open Hand" [Hebrews 4:13]')).toBe('Open Hand');
  });

  it('falls back to the parenthetical when no quoted name', () => {
    expect(simplifyLostSoulName('Lost Soul Acts 11:18 (NT Only)')).toBe('NT Only');
    expect(simplifyLostSoulName('Lost Soul Matthew 19:26 (First Round Protect)')).toBe('First Round Protect');
  });

  it('strips "Lost Soul " prefix when neither quoted nor parenthetical exists', () => {
    expect(simplifyLostSoulName('Lost Soul Romans 3:23')).toBe('Romans 3:23');
  });
});
