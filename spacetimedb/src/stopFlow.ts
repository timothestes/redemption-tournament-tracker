/**
 * Phase Stops (opponent-turn priority stops) — pure decision logic.
 * Pure — no ctx, no DB — so the scan/toggle rules are unit-testable and every
 * phase mover (set_phase, end_turn, end_battle, surrender_soul, enter_battle,
 * finishPregame) shares one implementation. See
 * docs/superpowers/specs/2026-08-15-phase-stops-design.md §5/§6.5.
 */

export const STOP_PHASES = ['draw', 'upkeep', 'preparation', 'battle', 'discard'] as const;

export function parseStops(csv: string): string[] {
  if (!csv) return [];
  return csv.split(',').filter((p) => (STOP_PHASES as readonly string[]).includes(p));
}

/** Canonical order + dedupe, so csv comparisons are stable. */
export function serializeStops(list: string[]): string {
  return STOP_PHASES.filter((p) => list.includes(p)).join(',');
}

export function toggleStop(csv: string, phase: string, enabled: boolean): string {
  const current = parseStops(csv);
  if (enabled) return serializeStops([...current, phase]);
  return serializeStops(current.filter((p) => p !== phase));
}

/**
 * First phase strictly after `fromIdx`, up to and including `toIdx`, that is
 * in `stopsCsv` and not in `firedCsv`; null if none. Used by set_phase
 * (toIdx = target), end_turn (toIdx = 4), the battle→discard advance
 * (fromIdx = 3, toIdx = 4), and the turn-flip / finishPregame draw check
 * (fromIdx = -1, toIdx = 0).
 */
export function firstStopInRange(
  fromIdx: number,
  toIdx: number,
  stopsCsv: string,
  firedCsv: string,
): string | null {
  const stops = parseStops(stopsCsv);
  if (stops.length === 0) return null;
  const fired = parseStops(firedCsv);
  const last = Math.min(toIdx, STOP_PHASES.length - 1);
  for (let i = Math.max(fromIdx + 1, 0); i <= last; i++) {
    const phase = STOP_PHASES[i];
    if (stops.includes(phase) && !fired.includes(phase)) return phase;
  }
  return null;
}
