// app/goldfish/state/__tests__/gameReducer.flipAndTokens.test.ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import { actions as gameActions } from '../gameActions';
import type { GameCard, GameState } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'card-1',
    cardName: 'Test Card (GoC)',
    cardSet: 'GoC',
    cardImgFile: 'test.png',
    type: 'GE',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: 'Generic',
    reference: '',
    alignment: 'Good',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: false,
    zone: 'territory',
    ownerId: 'player1',
    notes: '',
    ...overrides,
  };
}

function makeState(cards: GameCard[]): GameState {
  const zones: GameState['zones'] = {
    deck: [], hand: [], reserve: [], discard: [], paragon: [],
    'land-of-bondage': [], 'soul-deck': [], territory: [], 'land-of-redemption': [], banish: [],
  };
  for (const c of cards) zones[c.zone].push(c);
  return {
    zones,
    history: [],
    turn: 1,
    phase: 'preparation',
    drawnThisTurn: false,
    deckName: 'Test',
    deckFormat: 'T1',
    options: { autoRouteLostSouls: false } as any,
    isSpreadHand: false,
  } as unknown as GameState;
}

function findById(state: GameState, id: string): GameCard | undefined {
  for (const zone of Object.values(state.zones)) {
    const c = zone.find(c => c.instanceId === id);
    if (c) return c;
  }
  return undefined;
}

describe('FLIP_CARD — face-down reset', () => {
  it('clears notes and counters when flipping face-down', () => {
    const card = makeCard({
      isFlipped: false,
      notes: 'my custom text',
      counters: [{ color: 'red', count: 3 }],
    });
    const next = gameReducer(makeState([card]), gameActions.flipCard('card-1'));
    const result = findById(next, 'card-1')!;
    expect(result.isFlipped).toBe(true);
    expect(result.notes).toBe('');
    expect(result.counters).toEqual([]);
  });

  it('does not wipe notes/counters when flipping back face-up', () => {
    const card = makeCard({
      isFlipped: true,
      notes: 'still here',
      counters: [{ color: 'blue', count: 1 }],
    });
    const next = gameReducer(makeState([card]), gameActions.flipCard('card-1'));
    const result = findById(next, 'card-1')!;
    expect(result.isFlipped).toBe(false);
    expect(result.notes).toBe('still here');
    expect(result.counters).toEqual([{ color: 'blue', count: 1 }]);
  });
});

describe('MOVE_CARDS_BATCH — token deletion', () => {
  it('deletes tokens group-dragged to the discard pile', () => {
    const token1 = makeCard({ instanceId: 't1', isToken: true, zone: 'territory' });
    const token2 = makeCard({ instanceId: 't2', isToken: true, zone: 'territory' });
    const real = makeCard({ instanceId: 'r1', isToken: false, zone: 'territory' });
    const state = makeState([token1, token2, real]);

    const next = gameReducer(
      state,
      gameActions.moveCardsBatch(['t1', 't2', 'r1'], 'discard'),
    );

    // Tokens vanish; the real card lands in discard.
    expect(findById(next, 't1')).toBeUndefined();
    expect(findById(next, 't2')).toBeUndefined();
    const r = findById(next, 'r1')!;
    expect(r.zone).toBe('discard');
    expect(next.zones.discard.map(c => c.instanceId)).toEqual(['r1']);
  });

  it('keeps tokens that are group-dragged within a play zone', () => {
    const token = makeCard({ instanceId: 't1', isToken: true, zone: 'territory' });
    const next = gameReducer(
      makeState([token]),
      gameActions.moveCardsBatch(['t1'], 'land-of-bondage'),
    );
    expect(findById(next, 't1')?.zone).toBe('land-of-bondage');
  });
});
