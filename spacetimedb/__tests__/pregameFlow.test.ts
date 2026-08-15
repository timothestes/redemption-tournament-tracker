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

const BOTH_STARS_DONE: PregameProgress = {
  ...FRESH, starsDone0: true, starsDone1: true,
};

// Only the souls step consults eligibility now — the star window opens for
// everyone. See the anti-leak tests below.
const eligibility = (souls: [boolean, boolean]): PregameEligibility => ({
  controlsActivatableSoul: (seat: Seat) => souls[seat],
});

describe('advancePregameFlow', () => {
  it('opens the star window for the first player', () => {
    const r = advancePregameFlow('stars', 1, FRESH, eligibility([false, false]));
    expect(r).toEqual({
      kind: 'await', step: 'stars', activeSeat: 1,
      progress: FRESH,
    });
  });

  // The anti-leak invariant. A hand is hidden, so a star window that only
  // opened for seats actually holding a star would announce the hand's contents
  // by timing alone — the opponent would learn "no stars" from the skip. Both
  // seats get a window every game; the client answers an empty one after a
  // randomized pause so the two cases are indistinguishable.
  it('opens the star window for a seat that holds no stars', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('stars');
    expect(r.activeSeat).toBe(0);
    expect(r.progress.starsDone0).toBe(false);
  });

  it('still opens the second seat’s star window after the first finishes', () => {
    const r = advancePregameFlow('stars', 0, markDone(FRESH, 'stars', 0), eligibility([false, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('stars');
    expect(r.activeSeat).toBe(1);
  });

  it('falls through to souls only once both star windows are answered', () => {
    const r = advancePregameFlow('stars', 0, BOTH_STARS_DONE, eligibility([true, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('souls');
    expect(r.activeSeat).toBe(0);
  });

  it('completes when both star windows are answered and neither seat has souls', () => {
    const r = advancePregameFlow('stars', 0, BOTH_STARS_DONE, eligibility([false, false]));
    expect(r.kind).toBe('complete');
    expect(r.progress).toEqual({
      starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: true,
    });
  });

  it('honours REG order — the selected first player acts first in both steps', () => {
    const stars = advancePregameFlow('stars', 1, FRESH, eligibility([true, true]));
    expect(stars.kind === 'await' && stars.activeSeat).toBe(1);

    const souls = advancePregameFlow('souls', 1, BOTH_STARS_DONE, eligibility([true, true]));
    expect(souls.kind === 'await' && souls.activeSeat).toBe(1);
  });

  it('never re-opens a window a seat already finished', () => {
    // Seat 0 has already had its star window. The flow must move past it rather
    // than re-open. Seat 0 keeps an activatable soul so the result is an open
    // souls window — with nothing left to do at all the correct answer would be
    // 'complete', which would not distinguish "moved on" from "re-opened".
    const done = { ...BOTH_STARS_DONE };
    const r = advancePregameFlow('stars', 0, done, eligibility([true, false]));
    expect(r.kind).toBe('await');
    if (r.kind !== 'await') return;
    expect(r.step).toBe('souls');
  });

  // Paragon has no REG Pre-Game Phase. Without this the anti-leak change above
  // would open two star windows in every Paragon game — windows nobody can
  // answer, since Paragon's souls are shared and carry no ability text.
  it('completes immediately when the phase does not apply (Paragon)', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([true, true]), false);
    expect(r.kind).toBe('complete');
    expect(r.progress).toEqual({
      starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: true,
    });
  });

  it('still runs the phase when `applies` is omitted', () => {
    const r = advancePregameFlow('stars', 0, FRESH, eligibility([false, false]));
    expect(r.kind).toBe('await');
  });

  it('completes from the souls step when both seats are done', () => {
    const done = { starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: false };
    const r = advancePregameFlow('souls', 0, done, eligibility([true, false]));
    expect(r.kind).toBe('complete');
    expect(r.progress.soulsDone1).toBe(true);
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
