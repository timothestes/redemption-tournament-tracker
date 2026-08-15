/**
 * REG Pre-Game Phase sub-step transitions (star reveals, then Lost Soul
 * activation). Pure — no ctx, no DB — so the ordering rules are unit-testable
 * and the click path, the auto-skip path, and the idle-timeout path all share
 * one implementation and cannot diverge.
 *
 * REG order: the selected first player acts first in BOTH steps, then the
 * other seat.
 *
 * The two steps treat "nothing to do" differently, and the difference is about
 * hidden information rather than convenience:
 *
 * - Souls auto-skips. The Land of Bondage is face up, so both players can
 *   already see whether a seat controls an activatable Lost Soul. Skipping
 *   tells the opponent nothing they couldn't read off the board.
 * - Stars does NOT. A hand is hidden, and an instantly-skipped star window
 *   announces "no stars in that hand" by timing alone. So the window opens for
 *   both seats every game and the client answers it — after a randomized pause
 *   when the hand is empty, so the two cases look alike from across the table.
 *   The client cannot fake this on its own: the opponent's view follows server
 *   state, so the window has to genuinely open.
 *
 * An open star window is backstopped by the pre-game idle timeout, so a closed
 * or disconnected client can't park the game on one.
 *
 * Paragon opts out of the whole phase (`applies: false`). Its Lost Souls are a
 * shared 21-card pile owned by neither seat and carrying no ability text, so
 * the souls step could never open there in the first place; skipping the star
 * step too keeps Paragon's pre-game the shared-soul-deck setup it already is,
 * rather than taxing every game with two star windows nobody can answer. There
 * is no leak in skipping: the format is public, so both players know up front
 * that no star window is coming.
 */

export type Seat = 0 | 1;
export type PregameStep = 'stars' | 'souls';

export interface PregameProgress {
  starsDone0: boolean;
  starsDone1: boolean;
  soulsDone0: boolean;
  soulsDone1: boolean;
}

export interface PregameEligibility {
  /** Does this seat control at least one Lost Soul with ability text? */
  controlsActivatableSoul(seat: Seat): boolean;
}

export type PregameAdvance =
  | { kind: 'await'; step: PregameStep; activeSeat: Seat; progress: PregameProgress }
  | { kind: 'complete'; progress: PregameProgress };

function isDone(progress: PregameProgress, step: PregameStep, seat: Seat): boolean {
  if (step === 'stars') return seat === 0 ? progress.starsDone0 : progress.starsDone1;
  return seat === 0 ? progress.soulsDone0 : progress.soulsDone1;
}

export function markDone(
  progress: PregameProgress,
  step: PregameStep,
  seat: Seat,
): PregameProgress {
  if (step === 'stars') {
    return seat === 0
      ? { ...progress, starsDone0: true }
      : { ...progress, starsDone1: true };
  }
  return seat === 0
    ? { ...progress, soulsDone0: true }
    : { ...progress, soulsDone1: true };
}

export function advancePregameFlow(
  step: PregameStep,
  firstSeat: Seat,
  progress: PregameProgress,
  eligibility: PregameEligibility,
  /** Whether the REG Pre-Game Phase runs in this game at all. False for
   *  Paragon — see the header. Defaults true so a new call site that forgets
   *  it gets the standard phase rather than silently skipping one. */
  applies = true,
): PregameAdvance {
  if (!applies) {
    return {
      kind: 'complete',
      progress: { starsDone0: true, starsDone1: true, soulsDone0: true, soulsDone1: true },
    };
  }

  const otherSeat: Seat = firstSeat === 0 ? 1 : 0;
  const order: Seat[] = [firstSeat, otherSeat];
  let next = progress;

  if (step === 'stars') {
    for (const seat of order) {
      if (isDone(next, 'stars', seat)) continue;
      // Unconditional — an empty hand still gets a window. See the header.
      return { kind: 'await', step: 'stars', activeSeat: seat, progress: next };
    }
  }

  for (const seat of order) {
    if (isDone(next, 'souls', seat)) continue;
    if (eligibility.controlsActivatableSoul(seat)) {
      return { kind: 'await', step: 'souls', activeSeat: seat, progress: next };
    }
    next = markDone(next, 'souls', seat); // auto-skip: nothing to activate
  }

  return { kind: 'complete', progress: next };
}
