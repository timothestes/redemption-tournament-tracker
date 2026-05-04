import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameState, GameAction, GameCard } from '../../types';
import { DEFAULT_OPTIONS } from '../../types';

function makeCard(instanceId: string, zone: GameCard['zone'] = 'hand'): GameCard {
  return {
    instanceId,
    cardName: 'Test Card',
    cardSet: 'X',
    cardImgFile: '',
    type: 'Hero',
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
    zone,
    ownerId: 'player1',
    notes: '',
  };
}

function makeState(hand: GameCard[] = [], territory: GameCard[] = []): GameState {
  return {
    sessionId: 's',
    deckId: 'd',
    deckName: 'n',
    isOwner: true,
    format: 'T1',
    paragonName: null,
    turn: 1,
    phase: 'draw',
    zones: {
      deck: [], hand, reserve: [], discard: [], paragon: [],
      'land-of-bondage': [], 'soul-deck': [], territory,
      'land-of-redemption': [], banish: [],
    },
    history: [],
    options: DEFAULT_OPTIONS,
    isSpreadHand: false,
    drawnThisTurn: false,
  };
}

function action(type: GameAction['type'], payload: GameAction['payload'] = {}): GameAction {
  return { id: 't', type, playerId: 'player1', timestamp: 0, payload };
}

describe('REVEAL_CARD_IN_HAND', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-04-20T00:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('sets revealUntil on the target hand card', () => {
    const card = makeCard('c1', 'hand');
    const state = makeState([card]);
    const revealUntil = Date.now() + 30_000;
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'c1', value: revealUntil }));
    expect(next.zones.hand[0].revealUntil).toBe(revealUntil);
  });

  it('ignores non-hand cards', () => {
    const card = makeCard('c1', 'territory');
    const state = makeState([], [card]);
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'c1', value: Date.now() + 30_000 }));
    expect(next.zones.territory[0].revealUntil).toBeUndefined();
  });

  it('no-ops on unknown card id', () => {
    const state = makeState([makeCard('c1', 'hand')]);
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'nope', value: 123 }));
    expect(next).toEqual(state);
  });

  it('re-revealing resets revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: 100 };
    const state = makeState([card]);
    const next = gameReducer(state, action('REVEAL_CARD_IN_HAND', { cardInstanceId: 'c1', value: 999 }));
    expect(next.zones.hand[0].revealUntil).toBe(999);
  });
});

describe('reveal lifecycle clears when hand card moves', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-04-20T00:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('MOVE_CARD out of hand clears revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([card]);
    const next = gameReducer(state, action('MOVE_CARD', { cardInstanceId: 'c1', toZone: 'discard' }));
    expect(next.zones.discard[0].revealUntil).toBeUndefined();
  });

  it('MOVE_TO_TOP_OF_DECK clears revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([card]);
    const next = gameReducer(state, action('MOVE_TO_TOP_OF_DECK', { cardInstanceId: 'c1' }));
    expect(next.zones.deck[0].revealUntil).toBeUndefined();
  });

  it('MOVE_TO_BOTTOM_OF_DECK clears revealUntil', () => {
    const card = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([card]);
    const next = gameReducer(state, action('MOVE_TO_BOTTOM_OF_DECK', { cardInstanceId: 'c1' }));
    const last = next.zones.deck[next.zones.deck.length - 1];
    expect(last.revealUntil).toBeUndefined();
  });

  it('MOVE_CARDS_BATCH out of hand clears revealUntil', () => {
    const c1 = { ...makeCard('c1', 'hand'), revealUntil: Date.now() + 10_000 };
    const c2 = { ...makeCard('c2', 'hand'), revealUntil: Date.now() + 10_000 };
    const state = makeState([c1, c2]);
    const next = gameReducer(state, action('MOVE_CARDS_BATCH', { cardInstanceIds: ['c1', 'c2'], toZone: 'discard' }));
    expect(next.zones.discard.every(c => c.revealUntil === undefined)).toBe(true);
  });
});
