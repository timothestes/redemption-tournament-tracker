// Cross-cutting invariant: participants.match_points and participants.differential
// MUST equal what you'd derive from (matches + byes) via the canonical
// recompute logic. Sprinkle assertParticipantTotalsConsistent() into tests
// after any mutation to catch a forgotten recompute call.
//
// The expected values are computed in TS using the same arithmetic as the
// recompute_participant_totals SQL function and the TS recomputeTotalsFromHistory
// helper. If those three implementations ever drift, this assertion will catch it.

import { expect } from "vitest";

type AdminClient = any; // service-role Supabase client used in tests

interface MatchRow {
  player1_id: string;
  player2_id: string;
  player1_score: number | null;
  player2_score: number | null;
}

interface ByeRow {
  participant_id: string;
}

interface ParticipantRow {
  id: string;
  name: string;
  match_points: number;
  differential: number;
}

function gameScoreFor(
  participantId: string,
  m: MatchRow,
  maxScore: number,
): number {
  if (m.player1_score === null || m.player2_score === null) return 0;
  const isP1 = m.player1_id === participantId;
  const isP2 = m.player2_id === participantId;
  if (!isP1 && !isP2) return 0;
  if (m.player1_score === m.player2_score) return 1.5;
  if (isP1 && m.player1_score === maxScore) return 3;
  if (isP2 && m.player2_score === maxScore) return 3;
  if (isP1 && m.player2_score === maxScore) return 0;
  if (isP2 && m.player1_score === maxScore) return 0;
  if (isP1 && m.player1_score > m.player2_score) return 2;
  if (isP1 && m.player1_score < m.player2_score) return 1;
  if (isP2 && m.player2_score > m.player1_score) return 2;
  if (isP2 && m.player2_score < m.player1_score) return 1;
  return 0;
}

function differentialFor(participantId: string, m: MatchRow): number {
  if (m.player1_score === null || m.player2_score === null) return 0;
  if (m.player1_id === participantId) return m.player1_score - m.player2_score;
  if (m.player2_id === participantId) return m.player2_score - m.player1_score;
  return 0;
}

export async function assertParticipantTotalsConsistent(
  admin: AdminClient,
  tournamentId: string,
  context = "",
): Promise<void> {
  const t = await admin
    .from("tournaments")
    .select("max_score")
    .eq("id", tournamentId)
    .single();
  if (!t.data) throw new Error(`assertParticipantTotalsConsistent: tournament ${tournamentId} not found`);
  const maxScore = t.data.max_score;

  const [participantsRes, matchesRes, byesRes] = await Promise.all([
    admin
      .from("participants")
      .select("id, name, match_points, differential")
      .eq("tournament_id", tournamentId),
    admin
      .from("matches")
      .select("player1_id, player2_id, player1_score, player2_score")
      .eq("tournament_id", tournamentId)
      .not("player1_score", "is", null)
      .not("player2_score", "is", null),
    admin
      .from("byes")
      .select("participant_id")
      .eq("tournament_id", tournamentId),
  ]);

  const participants = (participantsRes.data ?? []) as ParticipantRow[];
  const matches = (matchesRes.data ?? []) as MatchRow[];
  const byes = (byesRes.data ?? []) as ByeRow[];

  const byeCounts = new Map<string, number>();
  for (const b of byes) {
    byeCounts.set(b.participant_id, (byeCounts.get(b.participant_id) ?? 0) + 1);
  }

  const mismatches: string[] = [];
  for (const p of participants) {
    let mp = 0;
    let diff = 0;
    for (const m of matches) {
      mp += gameScoreFor(p.id, m, maxScore);
      diff += differentialFor(p.id, m);
    }
    mp += 3 * (byeCounts.get(p.id) ?? 0);

    const storedMp = Number(p.match_points);
    const storedDiff = Number(p.differential);
    if (storedMp !== mp || storedDiff !== diff) {
      mismatches.push(
        `  ${p.name} (${p.id}): stored MP=${storedMp} diff=${storedDiff}, derived MP=${mp} diff=${diff}`,
      );
    }
  }

  if (mismatches.length > 0) {
    const header = context
      ? `Invariant violation after ${context}:`
      : `Invariant violation:`;
    expect.fail(
      `${header}\n  participants.match_points / differential drifted from history.\n${mismatches.join("\n")}`,
    );
  }
}
