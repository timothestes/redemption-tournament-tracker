// app/goldfish/state/__tests__/gameReducer.drawBottom.test.ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'c',
    cardName: 'Filler',
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
    zone: 'deck',
    ownerId: 'player1',
    notes: '',
    ...overrides,
  };
}

// Cards are pushed into zones in array order, so deck cards land top -> bottom
// in the order given (last deck card = bottom of deck).
function makeState(cards: GameCard[], autoRouteLostSouls: boolean): GameState {
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
    options: { autoRouteLostSouls } as any,
    isSpreadHand: false,
  } as unknown as GameState;
}

function exec(cardInstanceId: string, abilityIndex = 0): GameAction {
  return { id: 'a', type: 'EXECUTE_CARD_ABILITY', playerId: 'player1', timestamp: 0, payload: { cardInstanceId, abilityIndex } };
}

describe('draw_bottom_of_deck — Lost Soul replacement', () => {
  it('routes a bottom Lost Soul to Land of Bondage and replaces it from the next bottom card', () => {
    // Treacherous Land draws 1 from the bottom of the deck.
    const source = makeCard({ instanceId: 'src', cardName: 'Treacherous Land', type: 'Site', zone: 'territory' });
    const top = makeCard({ instanceId: 'top', cardName: 'Top Card' });
    const replacement = makeCard({ instanceId: 'repl', cardName: 'Replacement' });
    const ls = makeCard({ instanceId: 'ls', cardName: 'Lost Soul', type: 'LS' });
    // deck top -> bottom: [top, replacement, ls]
    const state = makeState([top, replacement, ls, source], true);

    const next = gameReducer(state, exec('src'));

    // Before the fix the bottom Lost Soul went to LoB but nothing replaced it,
    // leaving the hand empty.
    expect(next.zones['land-of-bondage'].map(c => c.instanceId)).toEqual(['ls']);
    expect(next.zones.hand.map(c => c.instanceId)).toEqual(['repl']);
    expect(next.zones.deck.map(c => c.instanceId)).toEqual(['top']);
  });

  it('with auto-route off, a bottom Lost Soul is drawn straight to hand', () => {
    const source = makeCard({ instanceId: 'src', cardName: 'Treacherous Land', type: 'Site', zone: 'territory' });
    const replacement = makeCard({ instanceId: 'repl', cardName: 'Replacement' });
    const ls = makeCard({ instanceId: 'ls', cardName: 'Lost Soul', type: 'LS' });
    const state = makeState([replacement, ls, source], false);

    const next = gameReducer(state, exec('src'));

    expect(next.zones['land-of-bondage']).toHaveLength(0);
    expect(next.zones.hand.map(c => c.instanceId)).toEqual(['ls']);
    expect(next.zones.deck.map(c => c.instanceId)).toEqual(['repl']);
  });

  it('Balaam (draw 2) skips a bottom Lost Soul and still draws 2 real cards', () => {
    const source = makeCard({ instanceId: 'src', cardName: 'Balaam Son of Beor', type: 'EC', zone: 'territory' });
    const a = makeCard({ instanceId: 'a', cardName: 'A' });
    const b = makeCard({ instanceId: 'b', cardName: 'B' });
    const ls = makeCard({ instanceId: 'ls', cardName: 'Lost Soul', type: 'LS' });
    // deck top -> bottom: [a, b, ls] ; draw 2 from bottom: ls -> LoB, then b, then a
    const state = makeState([a, b, ls, source], true);

    const next = gameReducer(state, exec('src'));

    expect(next.zones['land-of-bondage'].map(c => c.instanceId)).toEqual(['ls']);
    expect(next.zones.hand.map(c => c.instanceId)).toEqual(['b', 'a']);
    expect(next.zones.deck).toHaveLength(0);
  });
});
