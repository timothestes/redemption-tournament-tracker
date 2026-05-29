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

function p(
  id: string,
  match_points: number,
  differential: number,
  dropped_out = false,
): Participant {
  return { id, name: id, match_points, differential, dropped_out };
}

function fullWin(round: number, winner: string, loser: string): MatchRow {
  return {
    id: `${round}-${winner}-${loser}`,
    round,
    player1_id: winner,
    player2_id: loser,
    player1_score: 5,
    player2_score: 0,
    winner_id: winner,
    is_tie: false,
  };
}

describe("StandingsTable buildStandings", () => {
  it("ranks A above B when MP and differential tie and A beat B head-to-head", () => {
    // Bug #9 from the E2E run: P06 and P12 both at 12 MP / +8 diff, but P06
    // beat P12 head-to-head. P06 must rank higher than P12.
    const participants: Participant[] = [
      p("p12", 12, 8),
      p("p06", 12, 8),
      p("p99", 9, 4),
    ];
    const matches: MatchRow[] = [fullWin(2, "p06", "p12")];
    const rows = buildStandings(participants, matches, []);
    expect(rows.map((r) => r.participant.id)).toEqual(["p06", "p12", "p99"]);
    expect(rows.find((r) => r.participant.id === "p06")?.rank).toBe(1);
    expect(rows.find((r) => r.participant.id === "p12")?.rank).toBe(2);
  });

  it("still uses MP as the primary sort and differential second", () => {
    const participants: Participant[] = [
      p("low", 9, 99),
      p("high", 12, -3),
      p("mid", 12, 0),
    ];
    const rows = buildStandings(participants, [], []);
    expect(rows.map((r) => r.participant.id)).toEqual(["mid", "high", "low"]);
  });

  it("excludes dropped participants from standings", () => {
    const participants: Participant[] = [
      p("A", 6, 5),
      p("B", 12, 10, /* dropped */ true),
      p("C", 3, 2),
    ];
    const rows = buildStandings(participants, [], []);
    expect(rows.map((r) => r.participant.id)).toEqual(["A", "C"]);
  });

  it("leaves order stable when there is no head-to-head between tied players", () => {
    // No direct match between the two tied players → comparator returns 0 → stable order.
    const participants: Participant[] = [
      p("first", 6, 5),
      p("second", 6, 5),
    ];
    const rows = buildStandings(participants, [], []);
    expect(rows.map((r) => r.participant.id)).toEqual(["first", "second"]);
  });

  it("W-L-T excludes byes pre-staged for the upcoming round (bug #2)", () => {
    // Bob played R1 (lost to Alice) and has a bye row for R2 that End Round R1
    // just inserted. Standings should show 0-1-0 for Bob, not 1-1-0, until R2
    // is actually played.
    const participants: Participant[] = [
      p("alice", 3, 5),
      p("bob", 0, -5),
    ];
    const matches: MatchRow[] = [fullWin(1, "alice", "bob")];
    const byes: ByeRow[] = [{ participant_id: "bob", round_number: 2 }];
    // current_round = 2 → R1 byes (none here) count, R2 byes (bob's) don't.
    const rows = buildStandings(participants, matches, byes, 2);
    const bob = rows.find((r) => r.participant.id === "bob")!;
    expect(`${bob.wins}-${bob.losses}-${bob.ties}`).toBe("0-1-0");
  });

  it("W-L-T includes byes for completed rounds", () => {
    // After R2 is played, current_round becomes 3, so the R2 bye now counts.
    const participants: Participant[] = [
      p("alice", 6, 5),
      p("bob", 3, -5),
    ];
    const matches: MatchRow[] = [fullWin(1, "alice", "bob")];
    const byes: ByeRow[] = [{ participant_id: "bob", round_number: 2 }];
    const rows = buildStandings(participants, matches, byes, 3);
    const bob = rows.find((r) => r.participant.id === "bob")!;
    expect(`${bob.wins}-${bob.losses}-${bob.ties}`).toBe("1-1-0");
  });

  it("counts all byes when tournament has ended (currentRound null)", () => {
    // End-of-tournament view: every bye is in a completed round; no filter
    // should apply.
    const participants: Participant[] = [p("solo", 9, 0)];
    const byes: ByeRow[] = [
      { participant_id: "solo", round_number: 1 },
      { participant_id: "solo", round_number: 2 },
      { participant_id: "solo", round_number: 3 },
    ];
    const rows = buildStandings(participants, [], byes, null);
    expect(rows[0].wins).toBe(3);
  });
});
