import { describe, it, expect } from 'vitest';
import type { GameCard } from '../../types';
import {
  EQUIP_OFFSET_RATIO,
  computeEquipOffset,
  getAttachedWeapons,
  hitTestWarrior,
} from '../equipLayout';

function card(partial: Partial<GameCard> & { instanceId: string }): GameCard {
  return {
    cardName: 'C', cardSet: 'T', cardImgFile: 'C',
    type: '', brigade: '', strength: '', toughness: '', specialAbility: '',
    identifier: '', reference: '', alignment: '',
    isMeek: false, counters: [], isFlipped: false, isToken: false,
    zone: 'territory', ownerId: 'player1', notes: '',
    ...partial,
  };
}

describe('computeEquipOffset', () => {
  it('returns OFFSET_RATIO * dimension for both axes', () => {
    const { dx, dy } = computeEquipOffset(100, 140);
    expect(dx).toBeCloseTo(-100 * EQUIP_OFFSET_RATIO);
    expect(dy).toBeCloseTo(-140 * EQUIP_OFFSET_RATIO);
  });
});

describe('getAttachedWeapons', () => {
  it('returns weapons pointing at the given warrior, in order of appearance', () => {
    const warrior = card({ instanceId: 'h1' });
    const w1 = card({ instanceId: 'w1', equippedTo: 'h1' });
    const w2 = card({ instanceId: 'w2', equippedTo: 'h1' });
    const other = card({ instanceId: 'w3', equippedTo: 'h2' });
    const weapons = getAttachedWeapons(warrior, [warrior, w1, other, w2]);
    expect(weapons.map(w => w.instanceId)).toEqual(['w1', 'w2']);
  });

  it('returns an empty array when nothing is attached', () => {
    const warrior = card({ instanceId: 'h1' });
    expect(getAttachedWeapons(warrior, [warrior])).toEqual([]);
  });
});

describe('hitTestWarrior', () => {
  const candidates = [
    card({ instanceId: 'h1', posX: 100, posY: 100 }),
    card({ instanceId: 'h2', posX: 400, posY: 400 }),
  ];

  it('returns the warrior whose rect contains (dropX, dropY)', () => {
    const result = hitTestWarrior(150, 150, 100, 140, candidates, 'skipme');
    expect(result?.instanceId).toBe('h1');
  });

  it('returns null when the point hits no warrior', () => {
    expect(hitTestWarrior(0, 0, 100, 140, candidates, 'skipme')).toBeNull();
  });

  it('excludes the skipInstanceId (the card being dragged)', () => {
    const self = card({ instanceId: 'self', posX: 100, posY: 100 });
    const result = hitTestWarrior(150, 150, 100, 140, [self, ...candidates], 'self');
    expect(result?.instanceId).toBe('h1');
  });

  it('ignores candidates without posX/posY (not yet placed)', () => {
    const ghost = card({ instanceId: 'h3' });
    expect(hitTestWarrior(150, 150, 100, 140, [ghost], 'skipme')).toBeNull();
  });
});
