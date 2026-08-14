/**
 * REG Pre-Game Phase sub-step transitions (star reveals, then Lost Soul
 * activation). Pure — no ctx, no DB — so the ordering rules are unit-testable
 * and the click path, the auto-skip path, and the idle-timeout path all share
 * one implementation and cannot diverge.
 *
 * REG order: the selected first player acts first in BOTH steps, then the
 * other seat. A seat with nothing to do is skipped server-side.
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
  /** Does this seat hold at least one star card in hand? */
  hasStarInHand(seat: Seat): boolean;
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
): PregameAdvance {
  const otherSeat: Seat = firstSeat === 0 ? 1 : 0;
  const order: Seat[] = [firstSeat, otherSeat];
  let next = progress;

  if (step === 'stars') {
    for (const seat of order) {
      if (isDone(next, 'stars', seat)) continue;
      if (eligibility.hasStarInHand(seat)) {
        return { kind: 'await', step: 'stars', activeSeat: seat, progress: next };
      }
      next = markDone(next, 'stars', seat); // auto-skip: nothing to reveal
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
