import { describe, it, expect } from 'vitest';
import type { GameCard, ZoneId } from '@/app/shared/types/gameCard';
import { ALL_ZONES } from '@/app/shared/types/gameCard';
import { refillSoulDeck } from '../refill';

type Zones = Record<ZoneId, GameCard[]>;

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: overrides.instanceId ?? Math.random().toString(36).slice(2),
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

function emptyZones(): Zones {
  const z = {} as Zones;
  for (const id of ALL_ZONES) z[id] = [];
  return z;
}

describe('refillSoulDeck', () => {
  it('moves cards from soul-deck to land-of-bondage until LoB has 3 soul-origin souls', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [
      makeCard({ instanceId: 's1' }),
      makeCard({ instanceId: 's2' }),
      makeCard({ instanceId: 's3' }),
      makeCard({ instanceId: 's4' }),
    ];
    const next = refillSoulDeck(zones);
    expect(next['soul-deck']).toHaveLength(1);
    expect(next['land-of-bondage']).toHaveLength(3);
    expect(next['land-of-bondage'].every(c => c.isSoulDeckOrigin && c.zone === 'land-of-bondage' && !c.isFlipped)).toBe(true);
  });

  it('is a no-op when 3 soul-origin souls are already in LoB', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [makeCard({ instanceId: 'top' })];
    zones['land-of-bondage'] = [
      makeCard({ instanceId: 'l1', zone: 'land-of-bondage', isFlipped: false }),
      makeCard({ instanceId: 'l2', zone: 'land-of-bondage', isFlipped: false }),
      makeCard({ instanceId: 'l3', zone: 'land-of-bondage', isFlipped: false }),
    ];
    const next = refillSoulDeck(zones);
    expect(next['soul-deck']).toHaveLength(1);
    expect(next['land-of-bondage']).toHaveLength(3);
  });

  it('ignores captured humans and LS tokens in LoB when counting', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [
      makeCard({ instanceId: 's1' }),
      makeCard({ instanceId: 's2' }),
      makeCard({ instanceId: 's3' }),
    ];
    zones['land-of-bondage'] = [
      makeCard({ instanceId: 'token1', isToken: true, isSoulDeckOrigin: false, zone: 'land-of-bondage', ownerId: 'player1' }),
      makeCard({ instanceId: 'human1', isSoulDeckOrigin: false, type: 'Hero', zone: 'land-of-bondage', ownerId: 'player2' }),
    ];
    const next = refillSoulDeck(zones);
    // LoB still has the 2 originals plus 3 refilled soul-deck souls
    expect(next['land-of-bondage']).toHaveLength(5);
    expect(next['soul-deck']).toHaveLength(0);
    const soulOriginCount = next['land-of-bondage'].filter(c => c.isSoulDeckOrigin).length;
    expect(soulOriginCount).toBe(3);
  });

  it('stops refilling when the soul-deck is empty', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [makeCard({ instanceId: 'only' })];
    const next = refillSoulDeck(zones);
    expect(next['soul-deck']).toHaveLength(0);
    expect(next['land-of-bondage']).toHaveLength(1);
  });

  it('draws from the top of the soul-deck (index 0)', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [
      makeCard({ instanceId: 'top' }),
      makeCard({ instanceId: 'middle' }),
      makeCard({ instanceId: 'bottom' }),
    ];
    const next = refillSoulDeck(zones);
    expect(next['land-of-bondage'].map(c => c.instanceId)).toEqual(['top', 'middle', 'bottom']);
    expect(next['soul-deck']).toHaveLength(0);
  });

  it('returns a new zones object and does not mutate inputs', () => {
    const zones = emptyZones();
    zones['soul-deck'] = [makeCard({ instanceId: 's1' })];
    const originalSoulDeck = zones['soul-deck'];
    const originalLob = zones['land-of-bondage'];
    refillSoulDeck(zones);
    expect(zones['soul-deck']).toBe(originalSoulDeck);
    expect(zones['land-of-bondage']).toBe(originalLob);
    expect(zones['soul-deck']).toHaveLength(1);
  });
});
