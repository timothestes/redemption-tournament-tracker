// Pure decision logic for the SpacetimeConnectionResetWrapper's
// ReconnectOnResume child. Extracted from the React component so the
// branching can be tested without a DOM. Mirrors the community provider's
// branching at https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx

export const HIDDEN_DURATION_THRESHOLD_MS = 30_000;

export type ConnectionHealthKind = 'live' | 'dropped' | 'down';

export interface ConnectionHealthState {
  kind: ConnectionHealthKind;
}

export interface PingCheckInput {
  kind: ConnectionHealthKind;
  hiddenDurationMs: number | null;
}

/**
 * Returns true when the connection is in a known-bad state and we should
 * reset immediately without bothering to ping. Use this branch first; only
 * fall through to shouldRequirePingCheck when this returns false.
 */
export function shouldRequireResetWithoutPing(state: ConnectionHealthState): boolean {
  return state.kind !== 'live';
}

/**
 * Returns true when the connection is nominally live BUT the tab was hidden
 * long enough that a silent zombie WS is plausible — caller should ping to
 * verify the round trip works, and reset only if the ping fails.
 */
export function shouldRequirePingCheck(input: PingCheckInput): boolean {
  if (input.kind !== 'live') return false;
  const hidden = input.hiddenDurationMs ?? 0;
  return hidden >= HIDDEN_DURATION_THRESHOLD_MS;
}
