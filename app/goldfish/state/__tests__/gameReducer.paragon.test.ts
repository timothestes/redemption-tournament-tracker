import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction, ZoneId } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'x',
    cardName: 'X',
    cardSet: 'T',
    cardImgFile: 'X',
    type: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: '',
    reference: '',
    alignment: '',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: false,
    zone: 'soul-deck',
    ownerId: 'shared',
    notes: '',
    isSoulDeckOrigin: true,
    ...overrides,
  };
}

function makeState(zoneOverrides: Partial<Record<ZoneId, GameCard[]>>, format: 'T1'|'T2'|'Paragon' = 'Paragon'): GameState {
  const zones: GameState['zones'] = {
    deck: [], hand: [], reserve: [], discard: [], paragon: [],
    'land-of-bondage': [], 'soul-deck': [], territory: [], 'land-of-redemption': [], banish: [],
    ...zoneOverrides,
  } as GameState['zones'];
  return {
    sessionId: 's',
    deckId: 'd',
    deckName: 'T',
    isOwner: true,
    format,
    paragonName: null,
    turn: 1,
    phase: 'draw',
    zones,
    history: [],
    options: { format, startingHandSize: 8, autoRouteLostSouls: false, showPhaseReminder: false, showTurnCounter: false, soundEnabled: false, alwaysStartWith: [] },
    isSpreadHand: false,
    drawnThisTurn: false,
  };
}

function act(type: GameAction['type'], payload: GameAction['payload'] = {}): GameAction {
  return { id: 'a', type, playerId: 'player1', timestamp: 0, payload };
}

describe('Paragon refill on END_TURN', () => {
  it('refills LoB to 3 soul-origin souls when one was rescued prior', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' }), makeCard({ instanceId: 's-next' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage', isFlipped: false }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage', isFlipped: false }),
    ];
    // Provide a deck so END_TURN doesn't fail its auto-draw
    const deck: GameCard[] = [];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob, deck });
    const next = gameReducer(state, act('END_TURN'));
    const lobOrigin = next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(lobOrigin).toHaveLength(3);
    expect(next.zones['soul-deck']).toHaveLength(1);
  });

  it('is a no-op for non-Paragon formats', () => {
    const t1State = makeState({ 'soul-deck': [makeCard({ instanceId: 's' })], 'land-of-bondage': [] }, 'T1');
    const next = gameReducer(t1State, act('END_TURN'));
    expect(next.zones['soul-deck']).toHaveLength(1);
    expect(next.zones['land-of-bondage']).toHaveLength(0);
  });
});

describe('Paragon rescue + refill on MOVE_CARD', () => {
  it('transfers ownership from shared to player1 when rescuing from shared LoB to LoR', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'l1',
      toZone: 'land-of-redemption',
    }));
    const rescued = next.zones['land-of-redemption'].find(c => c.instanceId === 'l1');
    expect(rescued?.ownerId).toBe('player1');
    expect(rescued?.isSoulDeckOrigin).toBe(true);
  });

  it('refills LoB back to 3 soul-origin souls after rescue', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'l1',
      toZone: 'land-of-redemption',
    }));
    const lobOrigin = next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin);
    expect(lobOrigin).toHaveLength(3);
    expect(next.zones['soul-deck']).toHaveLength(0);
  });

  it('does NOT refill when a non-soul-origin card leaves LoB', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'token', zone: 'land-of-bondage', isToken: true, isSoulDeckOrigin: false, ownerId: 'player2' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARD', {
      cardInstanceId: 'token',
      toZone: 'land-of-redemption',
    }));
    expect(next.zones['soul-deck']).toHaveLength(1);
    expect(next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin)).toHaveLength(3);
  });
});

describe('Paragon rescue + refill on MOVE_CARDS_BATCH', () => {
  it('transfers ownership and refills when batch-rescuing a soul-origin card', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARDS_BATCH', {
      cardInstanceIds: ['l1'],
      toZone: 'land-of-redemption',
    }));
    const rescued = next.zones['land-of-redemption'].find(c => c.instanceId === 'l1');
    expect(rescued?.ownerId).toBe('player1');
    expect(rescued?.isSoulDeckOrigin).toBe(true);
    expect(next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin)).toHaveLength(3);
    expect(next.zones['soul-deck']).toHaveLength(0);
  });

  it('does NOT transfer ownership or refill when a non-soul-origin card leaves LoB via batch', () => {
    const soulDeck = [makeCard({ instanceId: 's-top' })];
    const lob = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage' }),
      makeCard({ instanceId: 'token', zone: 'land-of-bondage', isToken: true, isSoulDeckOrigin: false, ownerId: 'player2' }),
    ];
    const state = makeState({ 'soul-deck': soulDeck, 'land-of-bondage': lob });
    const next = gameReducer(state, act('MOVE_CARDS_BATCH', {
      cardInstanceIds: ['token'],
      toZone: 'land-of-redemption',
    }));
    // The token's ownerId should remain player2 (not transferred)
    const movedToken = next.zones['land-of-redemption'].find(c => c.instanceId === 'token');
    expect(movedToken?.ownerId).toBe('player2');
    // Soul deck should still have its card (refill is no-op because 3 soul-origin remain in LoB)
    expect(next.zones['soul-deck']).toHaveLength(1);
    expect(next.zones['land-of-bondage'].filter(c => c.isSoulDeckOrigin)).toHaveLength(3);
  });
});
