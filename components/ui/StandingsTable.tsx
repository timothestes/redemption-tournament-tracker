"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Crown } from "lucide-react";
import { createClient } from "../../utils/supabase/client";

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
}

interface StandingRow {
  participant: Participant;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  tiebreaker: string;
  tiebreakerSort: number;
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
 * Head-to-head among players in the same match-points tier.
 * Returns (wins, losses, ties) restricted to opponents who share this
 * player's exact match_points total. Used as the post-MP/Diff tiebreaker
 * the official Redemption algorithm describes (algorithm.md §"Determining
 * Final Standings"). The tracker doesn't apply h2h to rank order, but
 * surfacing it here lets a host explain a tied placement at a glance.
 */
function computeHeadToHead(
  participant: Participant,
  participants: Participant[],
  matches: MatchRow[],
): { wins: number; losses: number; ties: number } {
  const samePts = new Set(
    participants
      .filter(
        (p) =>
          p.id !== participant.id &&
          (p.match_points ?? 0) === (participant.match_points ?? 0),
      )
      .map((p) => p.id),
  );

  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const m of matches) {
    if (m.player1_score === null || m.player2_score === null) continue;
    const isP1 = m.player1_id === participant.id;
    const isP2 = m.player2_id === participant.id;
    if (!isP1 && !isP2) continue;
    const oppId = isP1 ? m.player2_id : m.player1_id;
    if (!samePts.has(oppId)) continue;
    if (m.is_tie) {
      ties++;
      continue;
    }
    if (m.winner_id === participant.id) wins++;
    else if (m.winner_id) losses++;
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
 * The H2H column shown in the UI summarises performance against the entire
 * MP tier, which is good for explaining tied placements at a glance; but for
 * the *sort* tiebreaker we need the deterministic A-vs-B record so the
 * column the table renders agrees with the order the rows appear in.
 *
 * Exported for unit testing.
 */
export function buildStandings(
  participants: Participant[],
  matches: MatchRow[],
  byes: ByeRow[],
): StandingRow[] {
  // Active participants only — drop-outs are excluded from standings per
  // algorithm.md §"Determining Final Standings" step 1.
  const active = participants.filter((p) => !p.dropped_out);
  const sorted = [...active].sort((a, b) => {
    const mp = (b.match_points ?? 0) - (a.match_points ?? 0);
    if (mp !== 0) return mp;
    const diff = (b.differential ?? 0) - (a.differential ?? 0);
    if (diff !== 0) return diff;
    // Both tied on MP and differential — apply direct head-to-head.
    return directHeadToHead(b.id, a.id, matches);
  });
  return sorted.map((p, idx) => {
    const record = computeRecord(p.id, matches, byes);
    const h2h = computeHeadToHead(p, active, matches);
    const inTiedGroup = h2h.wins + h2h.losses + h2h.ties > 0;
    const tiebreaker = inTiedGroup
      ? `${h2h.wins}-${h2h.losses}${h2h.ties ? `-${h2h.ties}` : ""}`
      : "—";
    return {
      participant: p,
      rank: idx + 1,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      tiebreaker,
      tiebreakerSort: h2h.wins - h2h.losses,
    };
  });
}

export default function StandingsTable({
  tournamentId,
  participants,
  tournamentEnded,
  matchesRefreshNonce,
}: StandingsTableProps) {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [byes, setByes] = useState<ByeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) return;
    const client = createClient();
    let cancelled = false;
    (async () => {
      const [matchesRes, byesRes] = await Promise.all([
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
      ]);
      if (cancelled) return;
      setMatches((matchesRes.data ?? []) as MatchRow[]);
      setByes((byesRes.data ?? []) as ByeRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, matchesRefreshNonce]);

  const rows: StandingRow[] = useMemo(
    () => buildStandings(participants, matches, byes),
    [participants, matches, byes],
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
                    <span>
                      <span className="text-muted-foreground/70">MP</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.participant.match_points ?? 0}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground/70">Diff</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.participant.differential ?? 0}
                      </span>
                    </span>
                    <span title="Head-to-head record against players tied on match points (the algorithm's primary tiebreaker after match points and lost-soul score).">
                      <span className="text-muted-foreground/70">H2H</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.tiebreaker}
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
                title="Cumulative match points across all rounds. Primary sort key."
                aria-sort="descending"
              >
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  MP <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                </span>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center"
                title="Cumulative lost-soul-score differential. Tiebreaker after MP."
                aria-sort="descending"
              >
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  Diff <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                </span>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center text-muted-foreground"
                title="Head-to-head record against players tied on match points. The official Redemption algorithm applies head-to-head before falling back to lost-soul-score among tied players."
              >
                Tiebreaker (H2H)
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
                    {row.tiebreaker}
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
