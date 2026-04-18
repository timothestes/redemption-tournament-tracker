import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction, ZoneId } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'x',
    cardName: 'X',
    cardSet: 'T',
    cardImgFile: 'X',
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
    zone: 'territory',
    ownerId: 'player1',
    notes: '',
    ...overrides,
  };
}

function makeState(cards: GameCard[]): GameState {
  const zones: GameState['zones'] = {
    deck: [], hand: [], reserve: [], discard: [], paragon: [],
    'land-of-bondage': [], territory: [], 'land-of-redemption': [], banish: [],
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

function act(type: GameAction['type'], payload: GameAction['payload']): GameAction {
  return { id: 'a', type, playerId: 'player1', timestamp: 0, payload };
}

describe('ATTACH_CARD', () => {
  it('sets equippedTo on the weapon', () => {
    const weapon = makeCard({ instanceId: 'w1', posX: 100, posY: 100 });
    const warrior = makeCard({ instanceId: 'h1', posX: 200, posY: 200 });
    const next = gameReducer(makeState([weapon, warrior]), act('ATTACH_CARD', {
      cardInstanceId: 'w1', warriorInstanceId: 'h1',
    }));
    const out = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(out?.equippedTo).toBe('h1');
  });

  it('is a no-op when warrior is missing', () => {
    const weapon = makeCard({ instanceId: 'w1' });
    const state = makeState([weapon]);
    const next = gameReducer(state, act('ATTACH_CARD', {
      cardInstanceId: 'w1', warriorInstanceId: 'missing',
    }));
    expect(next).toBe(state);
  });

  it('pushes history so the attach can be undone', () => {
    const weapon = makeCard({ instanceId: 'w1' });
    const warrior = makeCard({ instanceId: 'h1' });
    const next = gameReducer(makeState([weapon, warrior]), act('ATTACH_CARD', {
      cardInstanceId: 'w1', warriorInstanceId: 'h1',
    }));
    expect(next.history.length).toBe(1);
  });
});

describe('DETACH_CARD', () => {
  it('clears equippedTo', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const next = gameReducer(makeState([weapon]), act('DETACH_CARD', { cardInstanceId: 'w1' }));
    const out = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(out?.equippedTo).toBeUndefined();
  });
});

describe('auto-detach', () => {
  it('clears equippedTo on the weapon when the warrior leaves territory', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const warrior = makeCard({ instanceId: 'h1' });
    const next = gameReducer(makeState([weapon, warrior]), act('MOVE_CARD', {
      cardInstanceId: 'h1', toZone: 'discard' as ZoneId,
    }));
    const outWeapon = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(outWeapon?.equippedTo).toBeUndefined();
  });

  it('clears equippedTo on the weapon when the weapon itself leaves territory', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const warrior = makeCard({ instanceId: 'h1' });
    const next = gameReducer(makeState([weapon, warrior]), act('MOVE_CARD', {
      cardInstanceId: 'w1', toZone: 'discard' as ZoneId,
    }));
    const outWeapon = next.zones.discard.find(c => c.instanceId === 'w1');
    expect(outWeapon?.equippedTo).toBeUndefined();
  });

  it('leaves equippedTo intact when a warrior is repositioned within territory', () => {
    const weapon = makeCard({ instanceId: 'w1', equippedTo: 'h1' });
    const warrior = makeCard({ instanceId: 'h1', posX: 100, posY: 100 });
    const next = gameReducer(makeState([weapon, warrior]), act('MOVE_CARD', {
      cardInstanceId: 'h1', toZone: 'territory', posX: 300, posY: 300,
    }));
    const outWeapon = next.zones.territory.find(c => c.instanceId === 'w1');
    expect(outWeapon?.equippedTo).toBe('h1');
  });
});
