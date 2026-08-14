import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it
// via the **/__tests__/** glob.
import {
  advancePregameFlow,
  markDone,
  type PregameProgress,
  type PregameEligibility,
  type Seat,
} from '../src/pregameFlow';

const FRESH: PregameProgress = {
  starsDone0: false, starsDone1: false, soulsDone0: false, soulsDone1: false,
};

const eligibility = (
  stars: [boolean, boolean],
  souls: [boolean, boolean],
): PregameEligibility => ({
  hasStarInHand: (seat: Seat) => stars[seat],
  controlsActivatableSoul: (seat: Seat) => souls[seat],
});

describe('advancePregameFlow', () => {
  it('opens the star window for the first player when they hold a star', () => {
    const r = advancePregameFlow('stars', 1, FRESH, eligibility([true, true], [false, false]));
    expect(r).toEqual({
      kind: 'await', step: 'stars', activeSeat: 1,
      progress: FRESH,
    });
  });

  it('skips a seat with no stars and opens the other', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, true], [false, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('stars');
    expect(r.activeSeat).toBe(1);
    expect(r.progress.starsDone0).toBe(true);
  });

  it('falls through to souls when neither player holds a star', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, false], [true, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('souls');
    expect(r.activeSeat).toBe(0);
    expect(r.progress.starsDone0).toBe(true);
    expect(r.progress.starsDone1).toBe(true);
  });

  it('completes when neither player has stars or activatable souls', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, false], [false, false]));
    expect(r.kind).toBe('complete');
    expect(r.progress).toEqual({
      starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: true,
    });
  });

  it('honours REG order — the selected first player acts first in both steps', () => {
    const stars = advancePregameFlow('stars', 1, FRESH, eligibility([true, true], [true, true]));
    expect(stars.kind === 'await' && stars.activeSeat).toBe(1);

    const bothStarsDone = { ...FRESH, starsDone0: true, starsDone1: true };
    const souls = advancePregameFlow('souls', 1, bothStarsDone, eligibility([true, true], [true, true]));
    expect(souls.kind === 'await' && souls.activeSeat).toBe(1);
  });

  it('moves to the second seat once the first finishes stars', () => {
    const after = markDone(FRESH, 'stars', 0);
    const r = advancePregameFlow('stars', 0, after, eligibility([true, true], [false, false]));
    expect(r.kind === 'await' && r.activeSeat).toBe(1);
  });

  it('completes from the souls step when both seats are done', () => {
    const done = { starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: false };
    const r = advancePregameFlow('souls', 0, done, eligibility([false, false], [true, false]));
    expect(r.kind).toBe('complete');
    expect(r.progress.soulsDone1).toBe(true);
  });

  it('never re-opens a window a seat already finished', () => {
    // Seat 0 still HOLDS a star but has already had its star window; the flow
    // must skip past it rather than re-open. Seat 0 keeps an activatable soul
    // so the result is an open souls window — with nothing left to do at all
    // the correct answer would be 'complete' (see the test above), which would
    // not distinguish "moved on" from "re-opened".
    const done = { ...FRESH, starsDone0: true };
    const r = advancePregameFlow('stars', 0, done, eligibility([true, false], [true, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('souls');
  });
});

describe('markDone', () => {
  it('sets only the addressed flag and does not mutate its input', () => {
    const next = markDone(FRESH, 'souls', 1);
    expect(next.soulsDone1).toBe(true);
    expect(next.soulsDone0).toBe(false);
    expect(FRESH.soulsDone1).toBe(false);
  });
});
