// app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'source-1',
    cardName: 'Two Possessed',
    cardSet: 'GoC',
    cardImgFile: 'two-possessed.png',
    type: 'EC',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: 'Two Possessed (GoC)',
    reference: '',
    alignment: 'Evil',
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

function act(cardInstanceId: string, abilityIndex: number): GameAction {
  return {
    id: 'a',
    type: 'EXECUTE_CARD_ABILITY',
    playerId: 'player1',
    timestamp: 0,
    payload: { cardInstanceId, abilityIndex },
  };
}

describe('EXECUTE_CARD_ABILITY — spawn_token', () => {
  it('Two Possessed spawns 2 Violent Possessor Tokens in the same zone', () => {
    const source = makeCard({ zone: 'territory', identifier: 'Two Possessed (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    expect(next.zones.territory).toHaveLength(3); // source + 2 tokens
    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(2);
    expect(tokens.every(t => t.cardName === 'Violent Possessor Token')).toBe(true);
    expect(tokens.every(t => t.ownerId === 'player1')).toBe(true);
    expect(tokens[0].instanceId).not.toEqual(tokens[1].instanceId);
    expect(tokens[0].instanceId).not.toEqual('source-1');
  });

  it('single-count ability spawns exactly one token', () => {
    const source = makeCard({ identifier: 'The Proselytizers (GoC)', cardName: 'The Proselytizers' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].cardName).toBe('Proselyte Token');
  });

  it('spawn from a non-play zone falls back to territory', () => {
    const source = makeCard({ zone: 'hand', identifier: 'The Proselytizers (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(next.zones.hand.filter(c => c.isToken)).toHaveLength(0);
  });

  it('unknown source instanceId is a no-op (returns same state reference)', () => {
    const state = makeState([makeCard({})]);
    const next = gameReducer(state, act('does-not-exist', 0));
    expect(next).toBe(state);
  });

  it('out-of-range abilityIndex is a no-op (returns same state reference)', () => {
    const source = makeCard({ identifier: 'Two Possessed (GoC)' });
    const state = makeState([source]);
    const next = gameReducer(state, act('source-1', 99));
    expect(next).toBe(state);
  });

  it('card with no registered abilities is a no-op', () => {
    const source = makeCard({ identifier: 'No Such Ability Card' });
    const state = makeState([source]);
    const next = gameReducer(state, act('source-1', 0));
    expect(next).toBe(state);
  });

  it('ownerId is inherited from source (player2 source → player2 tokens)', () => {
    const source = makeCard({ ownerId: 'player2', identifier: 'The Proselytizers (GoC)' });
    const state = makeState([source]);
    const next = gameReducer(state, act('source-1', 0));
    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].ownerId).toBe('player2');
  });
});
