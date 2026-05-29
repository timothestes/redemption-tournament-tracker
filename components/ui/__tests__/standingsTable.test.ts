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
});
