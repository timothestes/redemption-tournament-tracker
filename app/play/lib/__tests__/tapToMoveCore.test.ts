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
