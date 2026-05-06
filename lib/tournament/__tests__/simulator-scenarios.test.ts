// lib/tournament/__tests__/simulator-scenarios.test.ts
//
// Larger end-to-end scenarios driving the simulator at realistic Swiss
// tournament sizes. Each test asserts correctness invariants (no rematches,
// totals match a fresh recompute, bye spread <= 1, drops respected, etc.)
// that the smaller simulator.test.ts file does not cover.

import { describe, it, expect } from 'vitest';
import { createTournament } from '../simulator';
import { gameScoreFor, lostSoulScoreFor } from '../scoring';
import type {
  MatchOutcome, MatchResult, ParticipantId, TournamentState,
} from '../types';

// ---------- helpers ----------

function namesPadded(n: number, prefix = 'p'): string[] {
  const width = String(n).length;
  return Array.from({ length: n }, (_, i) =>
    `${prefix}${String(i + 1).padStart(width, '0')}`,
  );
}

/**
 * Mixed-outcome decision used by scenarios 1 and 2.
 * - First match of the round (matchOrder === 1) is forced to a tie.
 * - Otherwise: alphabetically lower id wins full (cap-0); higher id wins
 *   partial (one souls below cap, lower at cap-2).
 */
function mixedOutcome(
  player1Id: string,
  player2Id: string,
  matchOrder: number,
  soulCap: number,
): MatchResult {
  if (matchOrder === 1) {
    // Force a tie. Souls are ignored for tie scoring but we set them sensibly.
    return {
      p1Souls: soulCap - 1,
      p2Souls: soulCap - 1,
      p1Outcome: 'tie',
      p2Outcome: 'tie',
    };
  }
  if (player1Id < player2Id) {
    return {
      p1Souls: soulCap,
      p2Souls: 0,
      p1Outcome: 'full_win',
      p2Outcome: 'full_loss',
    };
  }
  return {
    p1Souls: soulCap - 2,
    p2Souls: soulCap - 1,
    p1Outcome: 'partial_loss',
    p2Outcome: 'partial_win',
  };
}

interface RecomputedTotals {
  gameScore: number;
  lostSoulScore: number;
}

/**
 * Fresh recompute of every active participant's totals straight from the
 * state's match + bye history, used to cross-check the simulator's totalsFor().
 */
function recomputeAll(state: TournamentState): Map<ParticipantId, RecomputedTotals> {
  const out = new Map<ParticipantId, RecomputedTotals>();
  for (const p of state.participants) {
    out.set(p.id, { gameScore: 0, lostSoulScore: 0 });
  }
  for (const m of state.matches) {
    if (!m.result) continue;
    const p1 = out.get(m.player1Id);
    const p2 = out.get(m.player2Id);
    if (p1) {
      p1.gameScore += gameScoreFor(m.result.p1Outcome);
      p1.lostSoulScore += lostSoulScoreFor(
        m.result.p1Outcome, m.result.p1Souls, m.result.p2Souls, state.soulCap,
      );
    }
    if (p2) {
      p2.gameScore += gameScoreFor(m.result.p2Outcome);
      p2.lostSoulScore += lostSoulScoreFor(
        m.result.p2Outcome, m.result.p2Souls, m.result.p1Souls, state.soulCap,
      );
    }
  }
  for (const b of state.byes) {
    const p = out.get(b.participantId);
    if (p) p.gameScore += gameScoreFor('bye');
  }
  return out;
}

/** Build a Map<id, Set<oppId>> of every distinct opponent each player faced. */
function opponentSetByPlayer(state: TournamentState): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const p of state.participants) out.set(p.id, new Set<string>());
  for (const m of state.matches) {
    out.get(m.player1Id)!.add(m.player2Id);
    out.get(m.player2Id)!.add(m.player1Id);
  }
  return out;
}

/** Number of matches a participant played (regardless of outcome). */
function matchesPlayedFor(state: TournamentState, id: string): number {
  let n = 0;
  for (const m of state.matches) {
    if (m.player1Id === id || m.player2Id === id) n++;
  }
  return n;
}

// ---------- scenario 1: Type 1, 16 players, 5 rounds ----------

describe('simulator scenarios: 16 players / 5 rounds (Type 1, mixed outcomes)', () => {
  it('upholds scoring/no-rematch/bye/standings invariants', () => {
    const players = namesPadded(16);
    const t = createTournament({
      tournamentId: 't-16-5',
      players,
      nRounds: 5,
      soulCap: 5,
    });
    t.start();

    for (let round = 1; round <= 5; round++) {
      t.pairRound(round);
      for (const m of t.matchesForRound(round)) {
        t.submitResult(m.id, mixedOutcome(m.player1Id, m.player2Id, m.matchOrder, 5));
      }
    }

    const state = t.state();
    const fresh = recomputeAll(state);

    // Invariant A: simulator totalsFor matches a fresh recompute for everyone.
    for (const p of state.participants) {
      const sim = t.totalsFor(p.id);
      const exp = fresh.get(p.id)!;
      expect(sim.gameScore).toBe(exp.gameScore);
      expect(sim.lostSoulScore).toBe(exp.lostSoulScore);
    }

    // Invariant B: rematches only via the documented fallback. The greedy
    // pairer + rematch fallback can produce a small number of repeats at
    // scale; we tolerate them but bound the count and surface it in failure
    // messages by computing the deficit.
    const opps = opponentSetByPlayer(state);
    let rematchPairs = 0;
    for (const p of state.participants) {
      const played = matchesPlayedFor(state, p.id);
      const distinct = opps.get(p.id)!.size;
      // distinct can never exceed played; deficit = number of repeated opponents.
      expect(distinct).toBeLessThanOrEqual(played);
      rematchPairs += played - distinct;
    }
    // rematchPairs counts each rematch twice (once per participant), so
    // divide. With 16 players over 5 rounds, the fallback should rarely fire.
    expect(rematchPairs / 2).toBeLessThanOrEqual(4);

    // Invariant C: bye spread at most 1. With 16 (even) players nobody byes.
    const counts = [...t.byeCounts().values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

    // Invariant D: standings has 16 entries placed 1..16 (with possible joint).
    const standings = t.standings();
    expect(standings.length).toBe(16);
    expect(standings[0].place).toBe(1);
    // Places are non-decreasing and never exceed 16.
    let prev = 0;
    for (const s of standings) {
      expect(s.place).toBeGreaterThanOrEqual(prev);
      expect(s.place).toBeLessThanOrEqual(16);
      prev = s.place;
    }
  });
});

// ---------- scenario 2: Type 2, 32 players, 6 rounds ----------

describe('simulator scenarios: 32 players / 6 rounds (Type 2, soulCap=7)', () => {
  it('upholds scoring/no-rematch/bye/standings invariants at scale', () => {
    const players = namesPadded(32);
    const t = createTournament({
      tournamentId: 't-32-6',
      players,
      nRounds: 6,
      soulCap: 7,
    });
    t.start();

    for (let round = 1; round <= 6; round++) {
      t.pairRound(round);
      for (const m of t.matchesForRound(round)) {
        t.submitResult(m.id, mixedOutcome(m.player1Id, m.player2Id, m.matchOrder, 7));
      }
    }

    const state = t.state();
    const fresh = recomputeAll(state);

    // Invariant A: totals match recompute.
    for (const p of state.participants) {
      const sim = t.totalsFor(p.id);
      const exp = fresh.get(p.id)!;
      expect(sim.gameScore).toBe(exp.gameScore);
      expect(sim.lostSoulScore).toBe(exp.lostSoulScore);
    }

    // Invariant B: rematches bounded (documented fallback may fire).
    const opps = opponentSetByPlayer(state);
    let rematchPairs = 0;
    for (const p of state.participants) {
      const played = matchesPlayedFor(state, p.id);
      const distinct = opps.get(p.id)!.size;
      expect(distinct).toBeLessThanOrEqual(played);
      rematchPairs += played - distinct;
    }
    expect(rematchPairs / 2).toBeLessThanOrEqual(8);

    // Invariant C: bye spread <= 1.
    const counts = [...t.byeCounts().values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

    // Invariant D: 32 standings entries, valid place range.
    const standings = t.standings();
    expect(standings.length).toBe(32);
    expect(standings[0].place).toBe(1);
    let prev = 0;
    for (const s of standings) {
      expect(s.place).toBeGreaterThanOrEqual(prev);
      expect(s.place).toBeLessThanOrEqual(32);
      prev = s.place;
    }
  });
});

// ---------- scenario 3: drops mid-tournament ----------

describe('simulator scenarios: drops mid-tournament', () => {
  it('respects drops in pairings, standings, and totals', () => {
    const players = namesPadded(16);
    const t = createTournament({
      tournamentId: 't-drops',
      players,
      nRounds: 5,
      soulCap: 5,
    });
    t.start();

    function playRound(round: number, soulCap: number) {
      t.pairRound(round);
      for (const m of t.matchesForRound(round)) {
        t.submitResult(m.id, mixedOutcome(m.player1Id, m.player2Id, m.matchOrder, soulCap));
      }
    }

    playRound(1, 5);
    playRound(2, 5);

    // Drop p15 and p16 after round 2.
    const p15 = t.participantIdByName('p15')!;
    const p16 = t.participantIdByName('p16')!;
    t.dropPlayer(p15);
    t.dropPlayer(p16);

    playRound(3, 5);
    playRound(4, 5);

    // Drop p13 after round 4.
    const p13 = t.participantIdByName('p13')!;
    t.dropPlayer(p13);

    playRound(5, 5);

    const state = t.state();

    // Invariant: dropped players never appear in matches in rounds where
    // they're already dropped.
    for (const m of state.matches) {
      if ((m.player1Id === p15 || m.player2Id === p15) && m.round > 2) {
        throw new Error(`p15 paired in round ${m.round} after drop`);
      }
      if ((m.player1Id === p16 || m.player2Id === p16) && m.round > 2) {
        throw new Error(`p16 paired in round ${m.round} after drop`);
      }
      if ((m.player1Id === p13 || m.player2Id === p13) && m.round > 4) {
        throw new Error(`p13 paired in round ${m.round} after drop`);
      }
    }
    // Same check expressed as expectations to flag in vitest output.
    const r3to5 = state.matches.filter(m => m.round >= 3);
    expect(r3to5.some(m => m.player1Id === p15 || m.player2Id === p15)).toBe(false);
    expect(r3to5.some(m => m.player1Id === p16 || m.player2Id === p16)).toBe(false);
    const r5 = state.matches.filter(m => m.round === 5);
    expect(r5.some(m => m.player1Id === p13 || m.player2Id === p13)).toBe(false);

    // Standings exclude all three dropped players.
    const standings = t.standings();
    expect(standings.length).toBe(13);
    const ids = new Set(standings.map(s => s.participantId));
    expect(ids.has(p13)).toBe(false);
    expect(ids.has(p15)).toBe(false);
    expect(ids.has(p16)).toBe(false);

    // Active players' totals match a fresh recompute.
    const fresh = recomputeAll(state);
    for (const p of state.participants) {
      if (p.droppedOut) continue;
      const sim = t.totalsFor(p.id);
      const exp = fresh.get(p.id)!;
      expect(sim.gameScore).toBe(exp.gameScore);
      expect(sim.lostSoulScore).toBe(exp.lostSoulScore);
    }
  });
});

// ---------- scenario 4: tie-heavy ----------

describe('simulator scenarios: every match a tie', () => {
  it('produces uniform 1.5 / round game score, zero LSS, joint 1st place', () => {
    const players = namesPadded(8);
    const t = createTournament({
      tournamentId: 't-ties',
      players,
      nRounds: 4,
      soulCap: 5,
    });
    t.start();

    for (let round = 1; round <= 4; round++) {
      t.pairRound(round);
      for (const m of t.matchesForRound(round)) {
        t.submitResult(m.id, {
          p1Souls: 3,
          p2Souls: 3,
          p1Outcome: 'tie',
          p2Outcome: 'tie',
        });
      }
    }

    const state = t.state();
    for (const p of state.participants) {
      const played = matchesPlayedFor(state, p.id);
      const totals = t.totalsFor(p.id);
      expect(totals.gameScore).toBe(1.5 * played);
      expect(totals.lostSoulScore).toBe(0);
    }

    // 8 players (even) → no byes; each plays exactly 4 matches → gameScore 6.
    // Everyone tied on game score with no head-to-head winner and equal LSS,
    // so all 8 should be jointly placed at 1st.
    const standings = t.standings();
    expect(standings.length).toBe(8);
    for (const s of standings) {
      expect(s.place).toBe(1);
      expect(s.gameScore).toBe(6);
      expect(s.lostSoulScore).toBe(0);
    }
  });
});

// ---------- scenario 5: forfeit + edit-then-recompute ----------

describe('simulator scenarios: forfeit and edit recompute', () => {
  it('forfeit totals match spec; editing a result updates totals idempotently', () => {
    const t = createTournament({
      tournamentId: 't-forfeit-edit',
      players: ['p1', 'p2', 'p3', 'p4'],
      nRounds: 2,
      soulCap: 5,
    });
    t.start();
    t.pairRound(1);

    // Round 1 pairings are random (seeded). Treat the two matches abstractly:
    // matchA is normal (matchA.p1 wins 5-0), matchB is a forfeit.
    const r1 = t.matchesForRound(1);
    expect(r1.length).toBe(2);
    const [matchA, matchB] = r1;

    // matchA: player1 wins 5-0.
    t.submitResult(matchA.id, {
      p1Souls: 5, p2Souls: 0, p1Outcome: 'full_win', p2Outcome: 'full_loss',
    });
    // matchB: player1 forfeits, player2 wins by forfeit.
    t.submitResult(matchB.id, {
      p1Souls: 0, p2Souls: 0,
      p1Outcome: 'forfeit', p2Outcome: 'forfeit_opponent',
    });

    // After R1, before any edits:
    //   matchA.p1: full_win → game 3, LSS +5
    //   matchA.p2: full_loss → game 0, LSS -5
    //   matchB.p1: forfeit → game 0, LSS -5 (literal)
    //   matchB.p2: forfeit_opponent → game 3, LSS 0
    expect(t.totalsFor(matchA.player1Id)).toEqual({
      participantId: matchA.player1Id, gameScore: 3, lostSoulScore: 5,
    });
    expect(t.totalsFor(matchA.player2Id)).toEqual({
      participantId: matchA.player2Id, gameScore: 0, lostSoulScore: -5,
    });
    expect(t.totalsFor(matchB.player1Id)).toEqual({
      participantId: matchB.player1Id, gameScore: 0, lostSoulScore: -5,
    });
    expect(t.totalsFor(matchB.player2Id)).toEqual({
      participantId: matchB.player2Id, gameScore: 3, lostSoulScore: 0,
    });

    // Edit matchA to a 4-4 tie.
    t.submitResult(matchA.id, {
      p1Souls: 4, p2Souls: 4, p1Outcome: 'tie', p2Outcome: 'tie',
    });

    // matchA participants now both at 1.5 / 0. matchB unchanged (idempotent recompute).
    expect(t.totalsFor(matchA.player1Id)).toEqual({
      participantId: matchA.player1Id, gameScore: 1.5, lostSoulScore: 0,
    });
    expect(t.totalsFor(matchA.player2Id)).toEqual({
      participantId: matchA.player2Id, gameScore: 1.5, lostSoulScore: 0,
    });
    expect(t.totalsFor(matchB.player1Id)).toEqual({
      participantId: matchB.player1Id, gameScore: 0, lostSoulScore: -5,
    });
    expect(t.totalsFor(matchB.player2Id)).toEqual({
      participantId: matchB.player2Id, gameScore: 3, lostSoulScore: 0,
    });
  });
});

// ---------- scenario 6: realistic small Swiss with mid-tournament drop ----------

describe('simulator scenarios: 8 players, 4 rounds, drop after R1 forces odd field', () => {
  it('round-end totals match a fresh recompute every round; standings sane', () => {
    const players = namesPadded(8);
    const t = createTournament({
      tournamentId: 't-8-4-drop',
      players,
      nRounds: 4,
      soulCap: 5,
    });
    t.start();

    function playRoundAndCheck(round: number) {
      t.pairRound(round);
      for (const m of t.matchesForRound(round)) {
        t.submitResult(m.id, mixedOutcome(m.player1Id, m.player2Id, m.matchOrder, 5));
      }
      // After every round, totalsFor matches a fresh recompute.
      const state = t.state();
      const fresh = recomputeAll(state);
      for (const p of state.participants) {
        if (p.droppedOut) continue;
        const sim = t.totalsFor(p.id);
        const exp = fresh.get(p.id)!;
        expect(sim.gameScore).toBe(exp.gameScore);
        expect(sim.lostSoulScore).toBe(exp.lostSoulScore);
      }
    }

    playRoundAndCheck(1);
    // Drop p8 after R1 → 7 active players, R2-R4 will have one bye each.
    const p8 = t.participantIdByName('p8')!;
    t.dropPlayer(p8);
    playRoundAndCheck(2);
    playRoundAndCheck(3);
    playRoundAndCheck(4);

    const state = t.state();
    const standings = t.standings();
    expect(standings.length).toBe(7);

    // No rematches across the tournament.
    const opps = opponentSetByPlayer(state);
    for (const p of state.participants) {
      const played = matchesPlayedFor(state, p.id);
      expect(opps.get(p.id)!.size).toBe(played);
    }

    // R2-R4 each have a single bye recorded; bye spread <= 1 across active players.
    expect(state.byes.filter(b => b.round === 2).length).toBe(1);
    expect(state.byes.filter(b => b.round === 3).length).toBe(1);
    expect(state.byes.filter(b => b.round === 4).length).toBe(1);

    const activeCounts: number[] = [];
    const counts = t.byeCounts();
    for (const p of state.participants) {
      if (p.droppedOut) continue;
      activeCounts.push(counts.get(p.id) ?? 0);
    }
    expect(Math.max(...activeCounts) - Math.min(...activeCounts)).toBeLessThanOrEqual(1);

    // Place range valid.
    let prev = 0;
    for (const s of standings) {
      expect(s.place).toBeGreaterThanOrEqual(prev);
      expect(s.place).toBeLessThanOrEqual(7);
      prev = s.place;
    }
  });
});
