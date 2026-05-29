import { describe, it, expect } from "vitest";
import { buildStandings } from "../StandingsTable";

type Participant = {
  id: string;
  name: string;
  match_points: number | null;
  differential: number | null;
  dropped_out: boolean;
};

type MatchRow = {
  id: string;
  round: number;
  player1_id: string;
  player2_id: string;
  player1_score: number | null;
  player2_score: number | null;
  winner_id: string | null;
  is_tie: boolean | null;
};

type ByeRow = { participant_id: string; round_number: number };

// match_points/differential on the participant are now IGNORED by buildStandings
// (MP/DIFF are computed live from matches + byes). We still pass them to keep the
// Participant shape, but they should never drive the displayed numbers or sort.
function p(
  id: string,
  match_points = 0,
  differential = 0,
  dropped_out = false,
): Participant {
  return { id, name: id, match_points, differential, dropped_out };
}

const MAX = 5;

function fullWin(round: number, winner: string, loser: string): MatchRow {
  return {
    id: `${round}-${winner}-${loser}`,
    round,
    player1_id: winner,
    player2_id: loser,
    player1_score: MAX,
    player2_score: 0,
    winner_id: winner,
    is_tie: false,
  };
}

function match(
  round: number,
  p1: string,
  p2: string,
  s1: number | null,
  s2: number | null,
): MatchRow {
  const isTie = s1 !== null && s2 !== null && s1 === s2;
  let winner: string | null = null;
  if (s1 !== null && s2 !== null && !isTie) winner = s1 > s2 ? p1 : p2;
  return {
    id: `${round}-${p1}-${p2}`,
    round,
    player1_id: p1,
    player2_id: p2,
    player1_score: s1,
    player2_score: s2,
    winner_id: winner,
    is_tie: isTie,
  };
}

describe("StandingsTable buildStandings", () => {
  it("ranks A above B when live MP and differential tie and A beat B head-to-head", () => {
    // Exact tie at 3 MP / 0 diff for both, with p06 winning the head-to-head:
    //   r1: p06 beats p12  → p06 3MP/+5, p12 0MP/-5
    //   r2: p12 beats p99  → p12 3MP/+5  (p12 total 3MP/0)
    //   r2: p99 beats p06? no — give p06 a full loss to net 0 diff:
    //   r2: p06 loses to p99 → p06 0MP/-5 (p06 total 3MP/0)
    const rows = buildStandings(
      [p("p12"), p("p06"), p("p99")],
      [
        fullWin(1, "p06", "p12"), // p06: 3MP/+5 ; p12: 0MP/-5
        fullWin(2, "p99", "p06"), // p06: 0MP/-5 -> p06 total 3MP/0
        fullWin(3, "p12", "p99"), // p12: 3MP/+5 -> p12 total 3MP/0
      ],
      [],
      null,
      null,
      MAX,
    );
    const p06 = rows.find((r) => r.participant.id === "p06")!;
    const p12 = rows.find((r) => r.participant.id === "p12")!;
    expect(p06.mp).toBe(3);
    expect(p12.mp).toBe(3);
    expect(p06.diff).toBe(0);
    expect(p12.diff).toBe(0);
    expect(p06.rank).toBeLessThan(p12.rank);
  });

  it("uses live MP as the primary sort and live differential second", () => {
    // mid: 1 full win (3MP/+5). high: 1 full win (3MP) but smaller diff.
    // low: tie only (1.5MP). Order by MP then diff: high/mid (3MP) before low.
    const participants: Participant[] = [p("low"), p("high"), p("mid")];
    const matches: MatchRow[] = [
      match(1, "high", "x", 5, 3), // high: 3MP/+2 (full win, opp not at cap=full win since high=5)
      match(1, "mid", "y", 5, 0), // mid: 3MP/+5
      match(1, "low", "z", 2, 2), // low: 1.5MP/0
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    // mid (3MP/+5) > high (3MP/+2) > low (1.5MP/0)
    expect(rows.map((r) => r.participant.id)).toEqual(["mid", "high", "low"]);
  });

  it("excludes dropped participants from standings", () => {
    const participants: Participant[] = [
      p("A"),
      p("B", 0, 0, /* dropped */ true),
      p("C"),
    ];
    const matches: MatchRow[] = [
      fullWin(1, "A", "C"), // A: 3MP/+5, C: 0/-5
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    expect(rows.map((r) => r.participant.id)).toEqual(["A", "C"]);
  });

  it("leaves order stable when there is no head-to-head between tied players", () => {
    // Both win the same way over different opponents → identical live totals,
    // no direct match → comparator returns 0 → stable order.
    const participants: Participant[] = [p("first"), p("second")];
    const matches: MatchRow[] = [
      fullWin(1, "first", "x"),
      fullWin(1, "second", "y"),
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    expect(rows.map((r) => r.participant.id)).toEqual(["first", "second"]);
  });

  it("computes live MP/DIFF that agree with the W-L-T record mid-round", () => {
    // The core fix: mid-round, a 2-0-0 player must show MP/DIFF reflecting both
    // wins, not stale stored values. Stored props are intentionally wrong here.
    const participants: Participant[] = [
      p("winner", /* stale */ 0, /* stale */ 0),
      p("loserA"),
      p("loserB"),
    ];
    const matches: MatchRow[] = [
      fullWin(1, "winner", "loserA"), // 3MP/+5
      fullWin(2, "winner", "loserB"), // 3MP/+5
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const w = rows.find((r) => r.participant.id === "winner")!;
    expect(`${w.wins}-${w.losses}-${w.ties}`).toBe("2-0-0");
    expect(w.mp).toBe(6); // live, not the stale stored 0
    expect(w.diff).toBe(10);
  });

  it("scores a tie as 1.5 MP / 0 DIFF for both players", () => {
    const participants: Participant[] = [p("a"), p("b")];
    const matches: MatchRow[] = [match(1, "a", "b", 3, 3)];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const a = rows.find((r) => r.participant.id === "a")!;
    const b = rows.find((r) => r.participant.id === "b")!;
    expect(a.mp).toBe(1.5);
    expect(a.diff).toBe(0);
    expect(b.mp).toBe(1.5);
    expect(b.diff).toBe(0);
  });

  it("scores a partial win 2 MP / partial loss 1 MP with real differential", () => {
    // Neither reaches max_score (5): 4 vs 2 → ahead is partial win.
    const participants: Participant[] = [p("ahead"), p("behind")];
    const matches: MatchRow[] = [match(1, "ahead", "behind", 4, 2)];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const ahead = rows.find((r) => r.participant.id === "ahead")!;
    const behind = rows.find((r) => r.participant.id === "behind")!;
    expect(ahead.mp).toBe(2);
    expect(ahead.diff).toBe(2);
    expect(behind.mp).toBe(1);
    expect(behind.diff).toBe(-2);
  });

  it("ignores pre-staged next-round matches with NULL scores", () => {
    const participants: Participant[] = [p("a"), p("b")];
    const matches: MatchRow[] = [
      fullWin(1, "a", "b"), // a: 3MP/+5
      match(2, "a", "b", null, null), // staged R2 pairing, no scores yet
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const a = rows.find((r) => r.participant.id === "a")!;
    expect(a.mp).toBe(3);
    expect(a.diff).toBe(5);
  });

  it("W-L-T and live MP exclude byes pre-staged for the upcoming round", () => {
    // Bob lost R1 to Alice and has a bye staged for R2 (round not started).
    // The bye must NOT add +3 MP or a win until R2 starts.
    const participants: Participant[] = [p("alice"), p("bob")];
    const matches: MatchRow[] = [fullWin(1, "alice", "bob")];
    const byes: ByeRow[] = [{ participant_id: "bob", round_number: 2 }];
    // startedRounds = [1] only; R2's bye is gated out.
    const rows = buildStandings(participants, matches, byes, null, [1], MAX);
    const bob = rows.find((r) => r.participant.id === "bob")!;
    expect(`${bob.wins}-${bob.losses}-${bob.ties}`).toBe("0-1-0");
    expect(bob.mp).toBe(0); // bye did NOT add +3
    expect(bob.byes).toBe(0);
  });

  it("adds +3 MP for a bye once its round has started", () => {
    const participants: Participant[] = [p("alice"), p("bob")];
    const matches: MatchRow[] = [fullWin(1, "alice", "bob")];
    const byes: ByeRow[] = [{ participant_id: "bob", round_number: 2 }];
    // R2 now started → bye counts.
    const rows = buildStandings(participants, matches, byes, null, [1, 2], MAX);
    const bob = rows.find((r) => r.participant.id === "bob")!;
    expect(`${bob.wins}-${bob.losses}-${bob.ties}`).toBe("1-1-0");
    expect(bob.mp).toBe(3); // bye added +3
    expect(bob.diff).toBe(-5); // bye contributes 0 diff; R1 loss is -5
    expect(bob.byes).toBe(1);
  });

  it("counts all byes when tournament has ended (currentRound null, no startedRounds)", () => {
    const participants: Participant[] = [p("solo")];
    const byes: ByeRow[] = [
      { participant_id: "solo", round_number: 1 },
      { participant_id: "solo", round_number: 2 },
      { participant_id: "solo", round_number: 3 },
    ];
    const rows = buildStandings(participants, [], byes, null, null, MAX);
    expect(rows[0].wins).toBe(3);
    expect(rows[0].mp).toBe(9); // 3 byes × 3 MP
  });
});
