import { describe, it, expect } from 'vitest';
import {
  shouldRequireResetWithoutPing,
  shouldRequirePingCheck,
  HIDDEN_DURATION_THRESHOLD_MS,
} from '../connectionResetDecision';

describe('shouldRequireResetWithoutPing', () => {
  it('returns true when state is "dropped"', () => {
    expect(shouldRequireResetWithoutPing({ kind: 'dropped' })).toBe(true);
  });

  it('returns true when state is "down"', () => {
    expect(shouldRequireResetWithoutPing({ kind: 'down' })).toBe(true);
  });

  it('returns false when state is "live"', () => {
    expect(shouldRequireResetWithoutPing({ kind: 'live' })).toBe(false);
  });
});

describe('shouldRequirePingCheck', () => {
  it('returns true when state is live AND hidden ≥ threshold', () => {
    expect(
      shouldRequirePingCheck({
        kind: 'live',
        hiddenDurationMs: HIDDEN_DURATION_THRESHOLD_MS,
      })
    ).toBe(true);
    expect(
      shouldRequirePingCheck({
        kind: 'live',
        hiddenDurationMs: HIDDEN_DURATION_THRESHOLD_MS + 1_000,
      })
    ).toBe(true);
  });

  it('returns false when hidden duration is below threshold', () => {
    expect(
      shouldRequirePingCheck({
        kind: 'live',
        hiddenDurationMs: HIDDEN_DURATION_THRESHOLD_MS - 1,
      })
    ).toBe(false);
  });

  it('returns false when state is not live (caller should reset without ping)', () => {
    expect(
      shouldRequirePingCheck({
        kind: 'dropped',
        hiddenDurationMs: HIDDEN_DURATION_THRESHOLD_MS + 60_000,
      })
    ).toBe(false);
    expect(
      shouldRequirePingCheck({
        kind: 'down',
        hiddenDurationMs: HIDDEN_DURATION_THRESHOLD_MS,
      })
    ).toBe(false);
  });

  it('treats null/undefined hiddenDurationMs as 0 (tab was always visible)', () => {
    expect(
      shouldRequirePingCheck({ kind: 'live', hiddenDurationMs: null })
    ).toBe(false);
  });
});

describe('HIDDEN_DURATION_THRESHOLD_MS', () => {
  it('is 30 seconds (matches community provider)', () => {
    expect(HIDDEN_DURATION_THRESHOLD_MS).toBe(30_000);
  });
});
