/**
 * Phase Stops (opponent-turn priority stops) — pure decision logic.
 * Pure — no ctx, no DB — so the scan/toggle rules are unit-testable and every
 * phase mover (set_phase, end_turn, end_battle, surrender_soul, enter_battle)
 * shares one implementation. See
 * docs/superpowers/specs/2026-08-15-phase-stops-design.md §5/§6.5/§14.
 *
 * Rev 4: a stop is a ONE-SHOT gate on a turn boundary. Gates are named by the
 * phase they precede — upkeep/preparation/battle/discard — plus 'end', the
 * boundary between the discard phase and the turn flip. There is no gate
 * before draw (the flip auto-draws; the window before it is the previous
 * turn's 'end' gate). Tripping consumes the stop — it must be re-toggled to
 * fire again.
 */

/** The turn's phases, in order (boundary indices 0-4). */
export const TURN_PHASES = ['draw', 'upkeep', 'preparation', 'battle', 'discard'] as const;

/** Valid gate names, in canonical (turn) order. */
export const STOP_PHASES = ['upkeep', 'preparation', 'battle', 'discard', 'end'] as const;

/**
 * Boundary index of a gate on the turn's number line: gate P sits between
 * TURN_PHASES[b-1] and TURN_PHASES[b]; 'end' sits at b = 5, between discard
 * and the turn flip.
 */
export function gateBoundaryIndex(gate: string): number {
  return (STOP_PHASES as readonly string[]).indexOf(gate) + 1;
}

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
 * First armed gate on a boundary strictly after `fromIdx`, up to and
 * including `toIdx`, or null. Indices are TURN_PHASES boundary indices
 * (1..5; 5 = the 'end' boundary). Used by set_phase (toIdx = target index),
 * end_turn (toIdx = 5), and the battle→discard advance (fromIdx = 3,
 * toIdx = 4). One-shot means there is no separate "fired" set — a tripped
 * gate has already been removed from `stopsCsv`.
 */
export function firstStopInRange(
  fromIdx: number,
  toIdx: number,
  stopsCsv: string,
): string | null {
  const stops = parseStops(stopsCsv);
  if (stops.length === 0) return null;
  const last = Math.min(toIdx, STOP_PHASES.length);
  for (let b = Math.max(fromIdx + 1, 1); b <= last; b++) {
    const gate = STOP_PHASES[b - 1];
    if (stops.includes(gate)) return gate;
  }
  return null;
}
