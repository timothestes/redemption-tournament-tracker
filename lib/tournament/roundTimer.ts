export type PanelState = "not-started" | "running" | "between-rounds";

export interface CurrentRound {
  started_at: string | null;
  is_completed: boolean;
}

export interface Urgency {
  isExpired: boolean;
  isWarning: boolean;
  isUrgent: boolean;
}

/** Seconds remaining in the round. Null startTime => full duration (round not started). */
export function getRemainingSeconds(
  startTime: string | null,
  durationMinutes: number,
  nowMs: number,
): number {
  if (!startTime) return durationMinutes * 60;
  const startMs = new Date(startTime).getTime();
  const endMs = startMs + durationMinutes * 60 * 1000;
  return Math.floor(Math.max(0, endMs - nowMs) / 1000);
}

/** mm:ss, or h:mm:ss when an hour or more remains. */
export function formatRemaining(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/** Escalation flags. Mirrors the existing CountdownTimer thresholds (10% / 25%). */
export function getUrgency(remainingSeconds: number, durationMinutes: number): Urgency {
  const totalSeconds = durationMinutes * 60;
  const pct = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const isExpired = remainingSeconds === 0;
  const isWarning = !isExpired && pct <= 0.1;
  const isUrgent = !isExpired && !isWarning && pct <= 0.25;
  return { isExpired, isWarning, isUrgent };
}

/** Which panel state to show, derived from the current round row. */
export function derivePanelState(round: CurrentRound | null): PanelState {
  if (!round || !round.started_at) return "not-started";
  if (round.is_completed) return "between-rounds";
  return "running";
}
