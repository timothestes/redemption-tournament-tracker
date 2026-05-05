import { describe, it, expect } from 'vitest';
import { gameScoreFor, lostSoulScoreFor } from '../scoring';
import type { MatchOutcome } from '../types';

describe('gameScoreFor', () => {
  const cases: Array<[MatchOutcome, number]> = [
    ['full_win', 3],
    ['partial_win', 2],
    ['tie', 1.5],
    ['partial_loss', 1],
    ['full_loss', 0],
    ['bye', 3],
    ['forfeit', 0],
    ['forfeit_opponent', 3],
    ['no_show', 0],
  ];
  it.each(cases)('outcome %s → game score %d', (outcome, score) => {
    expect(gameScoreFor(outcome)).toBe(score);
  });
});

describe('lostSoulScoreFor', () => {
  it('played match: returns own_souls − opponent_souls (Type 1, cap 5)', () => {
    expect(lostSoulScoreFor('full_win', 5, 3, 5)).toBe(2);
    expect(lostSoulScoreFor('full_loss', 3, 5, 5)).toBe(-2);
    expect(lostSoulScoreFor('partial_win', 4, 1, 5)).toBe(3);
    expect(lostSoulScoreFor('partial_loss', 1, 4, 5)).toBe(-3);
  });

  it('played match: returns own_souls − opponent_souls (Type 2, cap 7)', () => {
    expect(lostSoulScoreFor('full_win', 7, 4, 7)).toBe(3);
    expect(lostSoulScoreFor('partial_win', 6, 2, 7)).toBe(4);
  });

  it('caps souls at the win threshold N before subtracting', () => {
    // Even if a wild input had souls beyond cap, they are capped first.
    expect(lostSoulScoreFor('full_win', 99, 0, 5)).toBe(5);
    expect(lostSoulScoreFor('full_loss', 0, 99, 5)).toBe(-5);
  });

  it('tied game returns 0 regardless of souls', () => {
    expect(lostSoulScoreFor('tie', 4, 4, 5)).toBe(0);
    expect(lostSoulScoreFor('tie', 2, 2, 7)).toBe(0);
  });

  it('bye returns 0', () => {
    expect(lostSoulScoreFor('bye', 0, 0, 5)).toBe(0);
  });

  it('forfeiter returns literal -5 (per official rules, not scaled to N)', () => {
    expect(lostSoulScoreFor('forfeit', 0, 0, 5)).toBe(-5);
    expect(lostSoulScoreFor('forfeit', 0, 0, 7)).toBe(-5);
  });

  it('forfeit_opponent returns 0', () => {
    expect(lostSoulScoreFor('forfeit_opponent', 0, 0, 5)).toBe(0);
  });

  it('no_show returns 0', () => {
    expect(lostSoulScoreFor('no_show', 0, 0, 5)).toBe(0);
  });
});
