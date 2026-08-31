import { describe, it, expect } from 'vitest';
import { tapMoveReducer, legalDestinations, type TapMoveState } from '../tapToMoveCore';

const idle: TapMoveState = { kind: 'idle' };
const armed: TapMoveState = {
  kind: 'armed', cardId: 'c1', sourceZone: 'hand', sourceOwner: 'my', side: 'my',
};

describe('tapMoveReducer', () => {
  it('arms on a card tap from idle', () => {
    const r = tapMoveReducer(idle, { type: 'tapCard', cardId: 'c1', zone: 'hand', owner: 'my' });
    expect(r.state).toEqual(armed);
    expect(r.commit).toBeNull();
  });

  it('disarms when the same card is tapped again', () => {
    const r = tapMoveReducer(armed, { type: 'tapCard', cardId: 'c1', zone: 'hand', owner: 'my' });
    expect(r.state.kind).toBe('idle');
    expect(r.commit).toBeNull();
  });

  it('re-arms onto a different card', () => {
    const r = tapMoveReducer(armed, { type: 'tapCard', cardId: 'c2', zone: 'territory', owner: 'my' });
    expect(r.state).toEqual({
      kind: 'armed', cardId: 'c2', sourceZone: 'territory', sourceOwner: 'my', side: 'my',
    });
    expect(r.commit).toBeNull();
  });

  it('commits with a point when a zone is tapped on canvas', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapZone', zone: 'territory', owner: 'my', point: { x: 500, y: 700 },
    });
    expect(r.state.kind).toBe('idle');
    expect(r.commit).toEqual({
      cardId: 'c1', toZone: 'territory', toOwner: 'my', atPoint: { x: 500, y: 700 },
    });
  });

  it('commits without a point when a rail chip is tapped', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapDestinationChip', zone: 'land-of-redemption', owner: 'opponent',
    });
    expect(r.commit).toEqual({
      cardId: 'c1', toZone: 'land-of-redemption', toOwner: 'opponent', atPoint: null,
    });
  });

  it('ignores a zone tap while idle', () => {
    const r = tapMoveReducer(idle, {
      type: 'tapZone', zone: 'territory', owner: 'my', point: { x: 1, y: 2 },
    });
    expect(r.state.kind).toBe('idle');
    expect(r.commit).toBeNull();
  });

  it('does not commit a move to the card own source zone', () => {
    const r = tapMoveReducer(armed, {
      type: 'tapZone', zone: 'hand', owner: 'my', point: { x: 1, y: 2 },
    });
    expect(r.commit).toBeNull();
    expect(r.state.kind).toBe('idle');
  });

  it('cancels on empty-space tap and on explicit cancel', () => {
    expect(tapMoveReducer(armed, { type: 'tapEmpty' }).state.kind).toBe('idle');
    expect(tapMoveReducer(armed, { type: 'cancel' }).state.kind).toBe('idle');
  });
});

describe('tapMoveReducer - side gate (stray-tap guardrail)', () => {
  it('re-targets instead of committing on a cross-side zone tap', () => {
    // The live-QA failure: armed hand card + one stray tap on opponent
    // territory = combat card revealed in the wrong territory. Now the tap
    // flips the rail's side and moves nothing.
    const r = tapMoveReducer(armed, {
      type: 'tapZone', zone: 'territory', owner: 'opponent', point: { x: 9, y: 9 },
    });
    expect(r.commit).toBeNull();
    expect(r.state).toEqual({ ...armed, side: 'opponent' });
  });

  it('commits on the second tap into the re-targeted zone', () => {
    const first = tapMoveReducer(armed, {
      type: 'tapZone', zone: 'territory', owner: 'opponent', point: { x: 9, y: 9 },
    });
    const second = tapMoveReducer(first.state, {
      type: 'tapZone', zone: 'territory', owner: 'opponent', point: { x: 10, y: 10 },
    });
    expect(second.state.kind).toBe('idle');
    expect(second.commit).toEqual({
      cardId: 'c1', toZone: 'territory', toOwner: 'opponent', atPoint: { x: 10, y: 10 },
    });
  });

  it('commits shared-owner zones regardless of side', () => {
    // A shared zone (Paragon LoB / soul deck) can't be "the wrong side".
    const r = tapMoveReducer(armed, {
      type: 'tapZone', zone: 'land-of-bondage', owner: 'shared', point: { x: 1, y: 2 },
    });
    expect(r.commit).toEqual({
      cardId: 'c1', toZone: 'land-of-bondage', toOwner: 'shared', atPoint: { x: 1, y: 2 },
    });
    expect(r.state.kind).toBe('idle');
  });

  it('commits the battle band in one tap even with the rail flipped to Theirs', () => {
    // The band is effectively shared space (findZoneAtPosition reports it as
    // 'my'); "arm, tap band" must stay a one-tap attack regardless of side.
    const flipped = tapMoveReducer(armed, { type: 'setSide', side: 'opponent' }).state;
    const r = tapMoveReducer(flipped, {
      type: 'tapZone', zone: 'battle', owner: 'my', point: { x: 3, y: 4 },
    });
    expect(r.commit).toEqual({
      cardId: 'c1', toZone: 'battle', toOwner: 'my', atPoint: { x: 3, y: 4 },
    });
    expect(r.state.kind).toBe('idle');
  });

  it('setSide updates the armed side without committing', () => {
    const r = tapMoveReducer(armed, { type: 'setSide', side: 'opponent' });
    expect(r.state).toEqual({ ...armed, side: 'opponent' });
    expect(r.commit).toBeNull();

    // ...and a same-side tap then commits directly.
    const commit = tapMoveReducer(r.state, {
      type: 'tapZone', zone: 'territory', owner: 'opponent', point: { x: 3, y: 4 },
    });
    expect(commit.commit).not.toBeNull();
  });

  it('setSide is a no-op while idle', () => {
    const r = tapMoveReducer(idle, { type: 'setSide', side: 'opponent' });
    expect(r.state).toEqual(idle);
    expect(r.commit).toBeNull();
  });

  it('arming resets the side to my own', () => {
    const flipped = tapMoveReducer(armed, { type: 'setSide', side: 'opponent' }).state;
    const rearmed = tapMoveReducer(flipped, { type: 'tapCard', cardId: 'c2', zone: 'hand', owner: 'my' });
    expect(rearmed.state).toEqual({
      kind: 'armed', cardId: 'c2', sourceZone: 'hand', sourceOwner: 'my', side: 'my',
    });
  });

  it('same-zone no-op still wins over the side gate', () => {
    // Tapping the source zone disarms without committing even when the source
    // is on the other side (e.g. a card armed FROM opponent territory).
    const oppArmed: TapMoveState = {
      kind: 'armed', cardId: 'c1', sourceZone: 'territory', sourceOwner: 'opponent', side: 'my',
    };
    const r = tapMoveReducer(oppArmed, {
      type: 'tapZone', zone: 'territory', owner: 'opponent', point: { x: 1, y: 2 },
    });
    expect(r.state.kind).toBe('idle');
    expect(r.commit).toBeNull();
  });
});

describe('legalDestinations', () => {
  it('offers both sides', () => {
    const d = legalDestinations('hand', 'my', 'T1');
    expect(d.some((x) => x.owner === 'my')).toBe(true);
    expect(d.some((x) => x.owner === 'opponent')).toBe(true);
  });

  it('excludes the source zone itself', () => {
    const d = legalDestinations('hand', 'my', 'T1');
    expect(d.some((x) => x.zone === 'hand' && x.owner === 'my')).toBe(false);
  });

  it('includes the opponent Land of Redemption - the cross-side case', () => {
    const d = legalDestinations('territory', 'my', 'T1');
    expect(d).toContainEqual({ zone: 'land-of-redemption', owner: 'opponent' });
  });

  it('offers shared zones only in Paragon', () => {
    expect(legalDestinations('hand', 'my', 'Paragon').some((x) => x.owner === 'shared')).toBe(true);
    expect(legalDestinations('hand', 'my', 'T1').some((x) => x.owner === 'shared')).toBe(false);
  });

  it('never offers the battle zone - that is phase-driven', () => {
    expect(legalDestinations('hand', 'my', 'T1').some((x) => x.zone === 'battle')).toBe(false);
  });
});

describe('legalDestinations - adversarial review regressions', () => {
  it('omits the per-seat Land of Bondage in Paragon', () => {
    // Paragon collapses each seat's LoB to a zero-height placeholder and
    // renders one shared LoB instead. Offering the per-seat zone sent the card
    // somewhere that does not render - recoverable only via Undo.
    const d = legalDestinations('hand', 'my', 'Paragon');
    expect(d.some((x) => x.zone === 'land-of-bondage' && x.owner === 'my')).toBe(false);
    expect(d.some((x) => x.zone === 'land-of-bondage' && x.owner === 'opponent')).toBe(false);
    // ...but the SHARED one is still offered.
    expect(d).toContainEqual({ zone: 'land-of-bondage', owner: 'shared' });
  });

  it('keeps the per-seat Land of Bondage outside Paragon', () => {
    const d = legalDestinations('hand', 'my', 'T1');
    expect(d).toContainEqual({ zone: 'land-of-bondage', owner: 'my' });
    expect(d).toContainEqual({ zone: 'land-of-bondage', owner: 'opponent' });
  });

  it('offers the opponent deck and reserve, which the drop path accepts', () => {
    const d = legalDestinations('hand', 'my', 'T1');
    expect(d).toContainEqual({ zone: 'deck', owner: 'opponent' });
    expect(d).toContainEqual({ zone: 'reserve', owner: 'opponent' });
  });

  it('never offers a destination twice', () => {
    for (const fmt of ['T1', 'T2', 'Paragon'] as const) {
      const d = legalDestinations('hand', 'my', fmt);
      const keys = d.map((x) => `${x.owner}:${x.zone}`);
      expect(new Set(keys).size, `${fmt} has duplicates`).toBe(keys.length);
    }
  });
});

describe('legalDestinations - Lost Soul ordering', () => {
  it('puts Land of Bondage and Land of Redemption first for a Lost Soul', () => {
    const d = legalDestinations('hand', 'my', 'T1', { isLostSoul: true });
    const mine = d.filter((x) => x.owner === 'my').map((x) => x.zone);
    expect(mine.slice(0, 2)).toEqual(['land-of-bondage', 'land-of-redemption']);
  });

  it('leads with the rescue when the soul is already in a Land of Bondage', () => {
    const d = legalDestinations('land-of-bondage', 'opponent', 'T1', { isLostSoul: true });
    const mine = d.filter((x) => x.owner === 'my').map((x) => x.zone);
    // A soul in a Land of Bondage is nearly always about to be rescued.
    expect(mine.slice(0, 2)).toEqual(['land-of-redemption', 'land-of-bondage']);
    // The source zone is still filtered out of its own side.
    const theirs = d.filter((x) => x.owner === 'opponent').map((x) => x.zone);
    expect(theirs).not.toContain('land-of-bondage');
    expect(theirs[0]).toBe('land-of-redemption');
  });

  it('leaves the order alone for anything that is not a Lost Soul', () => {
    expect(legalDestinations('hand', 'my', 'T1', { isLostSoul: false }))
      .toEqual(legalDestinations('hand', 'my', 'T1'));
  });

  it('offers the same set of destinations either way', () => {
    const plain = legalDestinations('hand', 'my', 'T1');
    const soul = legalDestinations('hand', 'my', 'T1', { isLostSoul: true });
    const key = (d: { zone: string; owner: string }) => `${d.owner}:${d.zone}`;
    expect(new Set(soul.map(key))).toEqual(new Set(plain.map(key)));
  });

  it('never offers the hidden per-seat LoB in Paragon, even hoisted', () => {
    const d = legalDestinations('hand', 'my', 'Paragon', { isLostSoul: true });
    expect(d.some((x) => x.owner !== 'shared' && x.zone === 'land-of-bondage')).toBe(false);
    expect(d.filter((x) => x.owner === 'my')[0].zone).toBe('land-of-redemption');
  });
});
