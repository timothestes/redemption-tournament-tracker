import { describe, it, expect } from 'vitest';
import { tapMoveReducer, legalDestinations, type TapMoveState } from '../tapToMoveCore';

const idle: TapMoveState = { kind: 'idle' };
const armed: TapMoveState = {
  kind: 'armed', cardId: 'c1', sourceZone: 'hand', sourceOwner: 'my',
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
      kind: 'armed', cardId: 'c2', sourceZone: 'territory', sourceOwner: 'my',
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
