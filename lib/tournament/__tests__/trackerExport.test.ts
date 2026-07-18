import { describe, it, expect } from 'vitest';
import {
  buildTrackerWriteMap,
  colLetter,
  roundStartCol,
} from '../trackerExport';
import type { Match, MatchOutcome, Participant, TournamentState } from '../types';

function p(id: string, name = id, droppedOut = false): Participant {
  return { id, name, joinedAt: '2026-01-01T00:00:00Z', droppedOut };
}

function match(
  round: number,
  p1: string,
  p2: string,
  opts: {
    order?: number;
    scores?: [number, number];
    tie?: boolean;
  } = {},
): Match {
  const { order = 1, scores, tie = false } = opts;
  let result;
  if (scores) {
    const [a, b] = scores;
    if (tie || a === b) {
      result = { p1Souls: a, p2Souls: b, p1Outcome: 'tie' as const, p2Outcome: 'tie' as const };
    } else if (a > b) {
      const full = a >= 5;
      const p1Outcome: MatchOutcome = full ? 'full_win' : 'partial_win';
      const p2Outcome: MatchOutcome = full ? 'full_loss' : 'partial_loss';
      result = { p1Souls: a, p2Souls: b, p1Outcome, p2Outcome };
    } else {
      const full = b >= 5;
      const p1Outcome: MatchOutcome = full ? 'full_loss' : 'partial_loss';
      const p2Outcome: MatchOutcome = full ? 'full_win' : 'partial_win';
      result = { p1Souls: a, p2Souls: b, p1Outcome, p2Outcome };
    }
  }
  return { id: `m${round}-${p1}-${p2}`, round, player1Id: p1, player2Id: p2, matchOrder: order, result };
}

function baseState(over: Partial<TournamentState> = {}): TournamentState {
  return {
    id: 't1', nRounds: 3, currentRound: 1, soulCap: 5,
    hasStarted: true, hasEnded: false,
    participants: [], matches: [], byes: [],
    startedRounds: [1],
    ...over,
  };
}

function cellMap(cells: { ref: string; value: string | number }[]) {
  return new Map(cells.map((c) => [c.ref, c.value]));
}

describe('colLetter / roundStartCol', () => {
  it('maps columns and round groups to the sheet layout', () => {
    expect(colLetter(1)).toBe('A');
    expect(colLetter(2)).toBe('B');
    expect(colLetter(26)).toBe('Z');
    expect(colLetter(27)).toBe('AA');
    expect(roundStartCol(1)).toBe(6); // F
    expect(colLetter(roundStartCol(1))).toBe('F');
    expect(colLetter(roundStartCol(10))).toBe('AY');
    expect(colLetter(roundStartCol(10) + 4)).toBe('BC');
  });
});

describe('blockers', () => {
  it('rejects a custom soul cap', () => {
    const r = buildTrackerWriteMap(baseState({ soulCap: 6, participants: [p('a'), p('b')] }));
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.errors[0]).toMatch(/5 or 7/);
  });

  it('rejects more than 10 rounds', () => {
    const r = buildTrackerWriteMap(baseState({ nRounds: 11, participants: [p('a'), p('b')] }));
    expect(r.ok).toBe(false);
  });

  it('rejects more than 200 rows', () => {
    const parts = Array.from({ length: 201 }, (_, i) => p(`p${i}`, `Player ${i}`));
    const r = buildTrackerWriteMap(baseState({ hasEnded: true, participants: parts }));
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.errors[0]).toMatch(/200/);
  });
});

describe('config cells', () => {
  it('writes type and round count', () => {
    const r = buildTrackerWriteMap(baseState({
      soulCap: 7, nRounds: 4, hasEnded: true,
      participants: [p('a'), p('b')],
    }));
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const cells = cellMap(r.map.cells);
    expect(cells.get('A14')).toBe(2);
    expect(cells.get('A28')).toBe(4);
  });
});

describe('in-progress row order (pair adjacency)', () => {
  it('lays current-round pairings adjacent with the bye pair last', () => {
    const parts = [p('a', 'Ann'), p('b', 'Bob'), p('c', 'Cal'), p('d', 'Deb'), p('e', 'Eve')];
    const state = baseState({
      participants: parts,
      currentRound: 2,
      matches: [
        match(1, 'a', 'b', { scores: [5, 0] }),
        match(1, 'c', 'd', { order: 2, scores: [3, 1] }),
        // current round, unplayed
        match(2, 'c', 'a', { order: 1 }),
        match(2, 'b', 'd', { order: 2 }),
      ],
      byes: [{ participantId: 'e', round: 1 }, { participantId: 'e', round: 2 }],
      startedRounds: [1, 2],
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const cells = cellMap(r.map.cells);
    // Pairs adjacent: Cal/Ann rows 3-4, Bob/Deb rows 5-6, bye recipient Eve
    // row 7, literal Bye row 8.
    expect(cells.get('B3')).toBe('Cal');
    expect(cells.get('B4')).toBe('Ann');
    expect(cells.get('B5')).toBe('Bob');
    expect(cells.get('B6')).toBe('Deb');
    expect(cells.get('B7')).toBe('Eve');
    expect(cells.get('B8')).toBe('Bye');
    // Current-round opponents written, scores left empty for unplayed matches.
    expect(cells.get('K3')).toBe('Ann');
    expect(cells.get('K4')).toBe('Cal');
    expect(cells.get('N3')).toBeUndefined();
    expect(cells.get('O3')).toBeUndefined();
    // The Bye row mirrors the current round: recipient name, 0 / cap+4.
    expect(cells.get('K8')).toBe('Eve');
    expect(cells.get('N8')).toBe(0);
    expect(cells.get('O8')).toBe(9);
  });
});

describe('played matches and byes', () => {
  it('writes soul counts for played matches and the bye sentinel with decay', () => {
    const parts = [p('a', 'Ann'), p('b', 'Bob'), p('c', 'Cal')];
    const state = baseState({
      nRounds: 2, currentRound: 2, hasEnded: true,
      participants: parts,
      matches: [
        match(1, 'a', 'b', { scores: [5, 2] }),
        match(2, 'a', 'c', { scores: [1, 1] }),
      ],
      byes: [
        { participantId: 'c', round: 1 },
        { participantId: 'b', round: 2 },
      ],
      startedRounds: [1, 2],
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const cells = cellMap(r.map.cells);
    const rowOf = new Map<string, number>();
    for (const [ref, v] of cells) {
      const m = /^B(\d+)$/.exec(ref);
      if (m) rowOf.set(String(v), Number(m[1]));
    }
    const ann = rowOf.get('Ann')!;
    const bob = rowOf.get('Bob')!;
    const cal = rowOf.get('Cal')!;
    // Round 1: Ann 5-2 Bob, both perspectives.
    expect(cells.get(`F${ann}`)).toBe('Bob');
    expect(cells.get(`I${ann}`)).toBe(5);
    expect(cells.get(`J${ann}`)).toBe(2);
    expect(cells.get(`F${bob}`)).toBe('Ann');
    expect(cells.get(`I${bob}`)).toBe(2);
    expect(cells.get(`J${bob}`)).toBe(5);
    // Cal's first bye: opponent "Bye", sentinel -3 / 0.
    expect(cells.get(`F${cal}`)).toBe('Bye');
    expect(cells.get(`I${cal}`)).toBe(-3);
    expect(cells.get(`J${cal}`)).toBe(0);
    // Bob's first bye (round 2) also -3.
    expect(cells.get(`N${bob}`)).toBe(-3);
    // No literal Bye row on an ended tournament.
    expect([...cells.values()]).not.toContain(9);
    // Bye warning present.
    expect(r.map.warnings.some((w) => w.includes('Byes follow the tracker'))).toBe(true);
  });

  it('decays repeat byes (-3 then -2) and caps at 0', () => {
    const state = baseState({
      nRounds: 6, currentRound: 6, hasEnded: true,
      participants: [p('a', 'Ann'), p('b', 'Bob')],
      matches: [],
      byes: [1, 2, 3, 4, 5].map((round) => ({ participantId: 'a', round })),
      startedRounds: [1, 2, 3, 4, 5],
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const cells = cellMap(r.map.cells);
    const ann = [...cells].find(([ref, v]) => v === 'Ann' && ref.startsWith('B'))![0].slice(1);
    expect(cells.get(`I${ann}`)).toBe(-3);
    expect(cells.get(`N${ann}`)).toBe(-2);
    expect(cells.get(`S${ann}`)).toBe(-1);
    expect(cells.get(`X${ann}`)).toBe(0);
    expect(cells.get(`AC${ann}`)).toBe(0);
  });

  it('warns for a bye in a staged-but-not-started round', () => {
    const state = baseState({
      currentRound: 2,
      participants: [p('a', 'Ann'), p('b', 'Bob'), p('c', 'Cal')],
      matches: [match(1, 'a', 'b', { scores: [5, 0] }), match(2, 'a', 'c', { order: 1 })],
      byes: [{ participantId: 'c', round: 1 }, { participantId: 'b', round: 2 }],
      startedRounds: [1], // round 2 staged, not started
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.map.warnings.some((w) => w.includes('staged'))).toBe(true);
  });
});

describe('dropped players', () => {
  it('omits unpaired dropped players mid-tournament but keeps paired ones', () => {
    const state = baseState({
      currentRound: 2,
      participants: [p('a', 'Ann'), p('b', 'Bob'), p('c', 'Cal', true), p('d', 'Deb', true)],
      matches: [
        match(1, 'a', 'c', { scores: [5, 0] }),
        match(1, 'b', 'd', { order: 2, scores: [5, 1] }),
        // Deb dropped but is still paired into the current round.
        match(2, 'a', 'd', { order: 1 }),
        match(2, 'b', 'c', { order: 2 }),
      ],
    });
    // Cal is paired too here; drop Cal from round 2 to test omission.
    state.matches = state.matches.filter((m) => !(m.round === 2 && m.player2Id === 'c'));
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const cells = cellMap(r.map.cells);
    const names = [...cells.entries()].filter(([ref]) => /^B\d+$/.test(ref)).map(([, v]) => v);
    expect(names).toContain('Deb'); // paired dropper stays
    expect(names).not.toContain('Cal'); // unpaired dropper omitted
    expect(names).toContain('Ann');
    expect(names).toContain('Bob');
  });

  it('includes dropped players after the tournament ends', () => {
    const state = baseState({
      hasEnded: true, currentRound: 3,
      participants: [p('a', 'Ann'), p('b', 'Bob'), p('c', 'Cal', true)],
      matches: [match(1, 'a', 'b', { scores: [5, 0] }), match(1, 'c', 'a', { order: 2 })],
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const cells = cellMap(r.map.cells);
    const names = [...cells.entries()].filter(([ref]) => /^B\d+$/.test(ref)).map(([, v]) => v);
    expect(names).toContain('Cal');
  });
});

describe('name sanitation', () => {
  it('renames duplicates and Bye-named players, and uses the same string in opponent cells', () => {
    const state = baseState({
      hasEnded: true, nRounds: 1, currentRound: 1,
      participants: [p('a', 'Sam'), p('b', 'Sam'), p('c', 'bye'), p('d', 'Deb')],
      matches: [
        match(1, 'a', 'b', { scores: [5, 0] }),
        match(1, 'c', 'd', { order: 2, scores: [3, 1] }),
      ],
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const cells = cellMap(r.map.cells);
    const names = [...cells.entries()].filter(([ref]) => /^B\d+$/.test(ref)).map(([, v]) => v);
    expect(names).toContain('Sam');
    expect(names).toContain('Sam (2)');
    expect(names).toContain('bye (player)');
    // Opponent cells use the renamed strings.
    const oppValues = [...cells.entries()].filter(([ref]) => /^F\d+$/.test(ref)).map(([, v]) => v);
    expect(oppValues).toContain('Sam (2)');
    expect(oppValues).toContain('bye (player)');
    expect(r.map.warnings.some((w) => w.includes('Duplicate'))).toBe(true);
    expect(r.map.warnings.some((w) => w.includes('reserves the name Bye'))).toBe(true);
  });
});

describe('round-trip invariant check', () => {
  it('stays silent when tracker formulas reproduce app points', () => {
    const state = baseState({
      hasEnded: true, nRounds: 1, currentRound: 1,
      participants: [p('a', 'Ann'), p('b', 'Bob'), p('c', 'Cal'), p('d', 'Deb')],
      matches: [
        match(1, 'a', 'b', { scores: [5, 2] }), // full win / full loss
        match(1, 'c', 'd', { order: 2, scores: [4, 2] }), // partial win / partial loss
      ],
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.map.warnings.filter((w) => w.includes('awarded'))).toHaveLength(0);
  });

  it('flags a result whose points the tracker cannot reproduce', () => {
    const state = baseState({
      hasEnded: true, nRounds: 1, currentRound: 1,
      participants: [p('a', 'Ann'), p('b', 'Bob')],
      matches: [{
        id: 'm', round: 1, player1Id: 'a', player2Id: 'b', matchOrder: 1,
        // Forfeit-style result: outcomes say 0/3 points but the scores say tie.
        result: { p1Souls: 0, p2Souls: 0, p1Outcome: 'forfeit', p2Outcome: 'forfeit_opponent' },
      }],
    });
    const r = buildTrackerWriteMap(state);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.map.warnings.filter((w) => w.includes('awarded'))).toHaveLength(2);
  });
});

describe('round column visibility', () => {
  it('shows only the current round mid-tournament', () => {
    const r = buildTrackerWriteMap(baseState({
      currentRound: 2, nRounds: 4,
      participants: [p('a'), p('b')],
      matches: [match(2, 'a', 'b', { order: 1 })],
    }));
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const hidden = new Map(r.map.hiddenRounds.map((h) => [h.round, h.hidden]));
    expect(hidden.get(1)).toBe(true);
    expect(hidden.get(2)).toBe(false);
    expect(hidden.get(3)).toBe(true);
    expect(hidden.get(10)).toBe(true);
  });

  it('shows rounds 1..nRounds when ended', () => {
    const r = buildTrackerWriteMap(baseState({
      hasEnded: true, nRounds: 3, currentRound: 3,
      participants: [p('a'), p('b')],
    }));
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    const hidden = new Map(r.map.hiddenRounds.map((h) => [h.round, h.hidden]));
    expect(hidden.get(1)).toBe(false);
    expect(hidden.get(3)).toBe(false);
    expect(hidden.get(4)).toBe(true);
  });
});
