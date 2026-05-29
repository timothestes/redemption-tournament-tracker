"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Crown } from "lucide-react";
import { createClient } from "../../utils/supabase/client";
import InfoHint, { MP_HINT, DIFF_HINT } from "./InfoHint";

interface Participant {
  id: string;
  name: string;
  match_points: number | null;
  differential: number | null;
  dropped_out: boolean;
}

interface MatchRow {
  id: string;
  round: number;
  player1_id: string;
  player2_id: string;
  player1_score: number | null;
  player2_score: number | null;
  winner_id: string | null;
  is_tie: boolean | null;
}

interface ByeRow {
  participant_id: string;
  round_number: number;
}

interface StandingsTableProps {
  tournamentId: string;
  participants: Participant[];
  tournamentEnded: boolean;
  /** Bumped by the page on data-changing events (drop player, End Round, repair)
   * so this component re-fetches matches/byes. Without it the standings only
   * refetch on tournamentId change. */
  matchesRefreshNonce?: number;
  /** The currently-in-progress round (1-indexed). Used to filter the W-L-T
   * display so byes pre-staged for the upcoming round (after End Round writes
   * the next round's pairings) don't count as wins before that round is
   * played. When undefined or 0, all byes are counted. */
  currentRound?: number | null;
}

interface StandingRow {
  participant: Participant;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  byes: number;
}

/**
 * Per-player W/L/T computed strictly from match + bye history.
 * - Byes count as wins (the algorithm awards 3 MP, same as a full win).
 * - Forfeit/no-show edge cases are conservatively treated as wins/losses
 *   based on stored winner_id + is_tie. We rely on the same denormalized
 *   columns the tracker writes when scoring a match.
 */
function computeRecord(
  participantId: string,
  matches: MatchRow[],
  byes: ByeRow[],
): { wins: number; losses: number; ties: number } {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const m of matches) {
    if (m.player1_id !== participantId && m.player2_id !== participantId) continue;
    if (m.player1_score === null || m.player2_score === null) continue;
    if (m.is_tie) {
      ties++;
      continue;
    }
    if (m.winner_id === participantId) {
      wins++;
    } else if (m.winner_id) {
      losses++;
    }
  }

  for (const b of byes) {
    if (b.participant_id === participantId) wins++;
  }

  return { wins, losses, ties };
}

/**
 * Direct head-to-head between two participants (across all matches in the
 * tournament, not just within a tier). Used as the final tiebreaker after MP
 * and differential: if A beat B head-to-head, A ranks above B.
 */
function directHeadToHead(
  aId: string,
  bId: string,
  matches: MatchRow[],
): number {
  let aWins = 0;
  let bWins = 0;
  for (const m of matches) {
    if (m.player1_score === null || m.player2_score === null) continue;
    if (m.is_tie) continue;
    const isAvsB =
      (m.player1_id === aId && m.player2_id === bId) ||
      (m.player1_id === bId && m.player2_id === aId);
    if (!isAvsB) continue;
    if (m.winner_id === aId) aWins++;
    else if (m.winner_id === bId) bWins++;
  }
  return aWins - bWins;
}

/**
 * Build sorted standings rows. Sort order:
 *   1. MP desc
 *   2. Differential desc
 *   3. Direct head-to-head (A beat B → A ranks higher)
 *
 * The Byes column shown in the UI reports how many byes each player has been
 * awarded in completed rounds (each counts as a win in the W-L-T record).
 *
 * `currentRound` (1-indexed, the round being played) gates which byes count
 * toward the W-L-T display: a bye for round N+1 is staged the moment End
 * Round N completes (createPairing inserts it), but it shouldn't show as
 * a "win" before round N+1 is played. Only byes for completed rounds
 * (round_number < currentRound) count. The MP/differential numbers are
 * sourced from the participant rows (recomputed server-side) and are
 * unaffected — only the displayed record is filtered here.
 *
 * Exported for unit testing.
 */
export function buildStandings(
  participants: Participant[],
  matches: MatchRow[],
  byes: ByeRow[],
  currentRound?: number | null,
  startedRounds?: number[] | null,
): StandingRow[] {
  // Active participants only — drop-outs are excluded from standings per
  // algorithm.md §"Determining Final Standings" step 1.
  const active = participants.filter((p) => !p.dropped_out);
  // A bye only counts once its round has actually started (Option C) — a round
  // staged by End Round but not yet started must not show the bye as a win or
  // award its points. This mirrors the server recompute exactly. Fall back to
  // the older current-round cutoff (then to "count all") for callsites/tests
  // that don't supply startedRounds.
  const playedByes = startedRounds
    ? byes.filter((b) => startedRounds.includes(b.round_number))
    : currentRound && currentRound > 0
      ? byes.filter((b) => b.round_number < currentRound)
      : byes;
  const sorted = [...active].sort((a, b) => {
    const mp = (b.match_points ?? 0) - (a.match_points ?? 0);
    if (mp !== 0) return mp;
    const diff = (b.differential ?? 0) - (a.differential ?? 0);
    if (diff !== 0) return diff;
    // Both tied on MP and differential — apply direct head-to-head.
    return directHeadToHead(b.id, a.id, matches);
  });
  return sorted.map((p, idx) => {
    const record = computeRecord(p.id, matches, playedByes);
    const byeCount = playedByes.filter((b) => b.participant_id === p.id).length;
    return {
      participant: p,
      rank: idx + 1,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      byes: byeCount,
    };
  });
}

export default function StandingsTable({
  tournamentId,
  participants,
  tournamentEnded,
  matchesRefreshNonce,
  currentRound,
}: StandingsTableProps) {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [byes, setByes] = useState<ByeRow[]>([]);
  const [startedRounds, setStartedRounds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) return;
    const client = createClient();
    let cancelled = false;
    (async () => {
      const [matchesRes, byesRes, roundsRes] = await Promise.all([
        client
          .from("matches")
          .select(
            "id, round, player1_id, player2_id, player1_score, player2_score, winner_id, is_tie",
          )
          .eq("tournament_id", tournamentId),
        client
          .from("byes")
          .select("participant_id, round_number")
          .eq("tournament_id", tournamentId),
        // Started rounds gate which byes count — a bye only scores once its
        // round has actually started (Option C), matching the server recompute.
        client
          .from("rounds")
          .select("round_number, started_at")
          .eq("tournament_id", tournamentId),
      ]);
      if (cancelled) return;
      setMatches((matchesRes.data ?? []) as MatchRow[]);
      setByes((byesRes.data ?? []) as ByeRow[]);
      setStartedRounds(
        (roundsRes.data ?? [])
          .filter((r: any) => r.started_at != null)
          .map((r: any) => Number(r.round_number)),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, matchesRefreshNonce]);

  const rows: StandingRow[] = useMemo(
    () => buildStandings(participants, matches, byes, currentRound, startedRounds),
    [participants, matches, byes, currentRound, startedRounds],
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading standings…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active participants to rank yet.
      </p>
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <ul className="md:hidden space-y-2">
        {rows.map((row) => {
          const isWinner = tournamentEnded && row.rank === 1;
          return (
            <li
              key={row.participant.id}
              className={`rounded-lg border border-border bg-card p-3 ${
                isWinner ? "ring-1 ring-yellow-500/40 bg-yellow-500/5" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                      #{row.rank}
                    </span>
                    {isWinner && (
                      <Crown
                        className="w-4 h-4 text-orange-300 flex-shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="font-medium text-foreground truncate">
                      {row.participant.name}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <span>
                      <span className="text-muted-foreground/70">W-L-T</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.wins}-{row.losses}-{row.ties}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">MP</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.participant.match_points ?? 0}
                      </span>
                      <InfoHint text={MP_HINT} />
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">Diff</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.participant.differential ?? 0}
                      </span>
                      <InfoHint text={DIFF_HINT} />
                    </span>
                    <span title="Number of byes awarded in completed rounds (each counts as a win).">
                      <span className="text-muted-foreground/70">Byes</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.byes}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-full text-sm text-left text-muted-foreground border border-border rounded-lg overflow-hidden">
          {/*
            Sort-hierarchy convention: active sort columns (MP primary, Diff
            tiebreaker) read as `text-foreground` with a muted chevron;
            inactive headers stay muted with no chevron. Communicates active
            sort via header tint rather than a bright accent on the icon.
          */}
          <thead className="text-xs uppercase font-medium bg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-muted-foreground">
                Rank
              </th>
              <th scope="col" className="px-4 py-3 text-left text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Player
                </span>
              </th>
              <th scope="col" className="px-4 py-3 text-center text-muted-foreground">
                Record (W-L-T)
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center"
                aria-sort="descending"
              >
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  MP <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                  <InfoHint text={MP_HINT} />
                </span>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center"
                aria-sort="descending"
              >
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  Diff <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                  <InfoHint text={DIFF_HINT} />
                </span>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center text-muted-foreground"
                title="Number of byes awarded in completed rounds. Each bye counts as a win in the W-L-T record."
              >
                Byes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isWinner = tournamentEnded && row.rank === 1;
              return (
                <tr
                  key={row.participant.id}
                  className={`border-t border-border ${
                    isWinner ? "bg-yellow-500/5" : "hover:bg-muted/50"
                  }`}
                >
                  <td className="px-4 py-3 font-semibold text-foreground tabular-nums">
                    {row.rank}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <span className="inline-flex items-center gap-2">
                      {isWinner && (
                        <Crown
                          className="w-4 h-4 text-orange-300"
                          aria-hidden="true"
                        />
                      )}
                      {row.participant.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {row.wins}-{row.losses}-{row.ties}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-foreground">
                    {row.participant.match_points ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-foreground">
                    {row.participant.differential ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {row.byes}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
