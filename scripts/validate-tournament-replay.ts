/**
 * One-off validation: replay a completed tournament against the new pure
 * algorithm pipeline (lib/tournament/* via utils/tournament/stateAdapter)
 * and compare against the rankings the OLD code produced.
 *
 * Why this exists
 * ---------------
 * The refactor touched three things that *should* show up as differences when
 * we replay a real, completed tournament:
 *   1. Bye distribution rebalanced (not directly visible in final standings).
 *   2. Final standings now apply head-to-head before lost-soul-score for
 *      game-score ties.
 *   3. Match-result edits recompute totals from history (no double-count).
 *
 * The DB stores per-participant `match_points` and `differential` (game score
 * and lost-soul score in the new vocabulary). The `participants.place` column
 * is *not* reliably persisted, so we reconstruct the OLD ordering from
 * stored totals: `ORDER BY match_points DESC, differential DESC`. That's what
 * the old code displayed as the final standings.
 *
 * Then we compare:
 *   - per-player game score / lost-soul score    (must match)
 *   - per-player place (old reconstructed vs new computed)
 *
 * Differences classified:
 *   - exact            : same place
 *   - tied (h2h fix)   : same game score, place reordered, and the player has
 *                        a head-to-head opponent in the same game-score group
 *   - dropped          : excluded from new standings (expected)
 *   - totals mismatch  : per-player game/lss diverge — possible regression
 *   - unexpected       : place differs without explanation — possible regression
 *
 * Usage:  npx tsx scripts/validate-tournament-replay.ts <tournament-id>
 *
 * Exit codes:
 *   0  — no `unexpected` rows.
 *   1  — at least one row was unexpected.
 *   2  — bad usage / IO error.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { buildStateFromSupabase } from "../utils/tournament/stateAdapter";
import { computeFinalStandings } from "../lib/tournament/standings";
import { recomputeTotalsFromHistory } from "../lib/tournament/results";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

const tournamentId = process.argv[2];
if (!tournamentId) {
  console.error("Usage: npx tsx scripts/validate-tournament-replay.ts <tournament-id>");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type StoredParticipant = {
  id: string;
  name: string | null;
  place: number | null;
  match_points: number | null;
  differential: number | null;
  dropped_out: boolean | null;
};

function pad(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  return s + " ".repeat(w - s.length);
}
function padL(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  return " ".repeat(w - s.length) + s;
}
function fmtCell(v: number | null | undefined): string {
  return v == null ? "—" : String(v);
}

/**
 * Reconstruct the OLD final ranking from per-participant totals stored on
 * `participants`. The old code sorted by match_points DESC, then differential
 * DESC. Drops were *not* excluded by the old code's standings query (they
 * still got a place); the new code excludes them.
 *
 * Returns a Map participantId -> 1-indexed rank under the OLD rules.
 * If a participant has no stored totals, they are not given a rank here.
 */
function reconstructOldRanks(stored: StoredParticipant[]): Map<string, number> {
  const ranked = stored
    .filter(p => p.match_points !== null && p.differential !== null)
    .slice()
    .sort((a, b) => {
      if (a.match_points! !== b.match_points!) return b.match_points! - a.match_points!;
      return b.differential! - a.differential!;
    });
  const out = new Map<string, number>();
  // Standard competition ranking (1224): tied rows share the lower place.
  let i = 0;
  while (i < ranked.length) {
    let j = i;
    while (
      j < ranked.length &&
      ranked[j].match_points === ranked[i].match_points &&
      ranked[j].differential === ranked[i].differential
    ) j++;
    for (let k = i; k < j; k++) out.set(ranked[k].id, i + 1);
    i = j;
  }
  return out;
}

async function main() {
  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select("id, name, n_rounds, current_round, max_score, has_started, has_ended")
    .eq("id", tournamentId)
    .single();
  if (tErr || !tournament) {
    console.error(`Tournament not found: ${tournamentId}`, tErr);
    process.exit(2);
  }

  const { data: storedParts, error: pErr } = await supabase
    .from("participants")
    .select("id, name, place, match_points, differential, dropped_out")
    .eq("tournament_id", tournamentId);
  if (pErr || !storedParts) {
    console.error("Failed to fetch participants", pErr);
    process.exit(2);
  }
  const stored: Map<string, StoredParticipant> = new Map();
  for (const p of storedParts as StoredParticipant[]) stored.set(p.id, p);

  const oldRanks = reconstructOldRanks(storedParts as StoredParticipant[]);
  const haveStoredTotals = (storedParts as StoredParticipant[]).some(
    p => p.match_points !== null,
  );

  const state = await buildStateFromSupabase(supabase as any, tournamentId);
  if (!state) {
    console.error("buildStateFromSupabase returned null");
    process.exit(2);
  }

  const placements = computeFinalStandings(state);
  const placementById = new Map(placements.map(p => [p.participantId, p]));
  const totalsById = new Map(
    state.participants.map(p => [p.id, recomputeTotalsFromHistory(p.id, state)])
  );

  type Row = {
    id: string;
    name: string;
    droppedOut: boolean;
    oldPlace: number | null;
    storedPlaceColumn: number | null;
    computedPlace: number | null;
    storedGame: number | null;
    computedGame: number;
    storedDiff: number | null;
    computedDiff: number;
    status: "exact" | "tied_h2h" | "dropped_excluded" | "totals_mismatch" | "no_old_data" | "unexpected";
    note?: string;
  };

  function hasGameScorePeerWithH2H(pid: string, computedGame: number): boolean {
    for (const other of placements) {
      if (other.participantId === pid) continue;
      if (other.gameScore !== computedGame) continue;
      const played = state.matches.some(m => {
        if (!m.result) return false;
        return (
          (m.player1Id === pid && m.player2Id === other.participantId) ||
          (m.player1Id === other.participantId && m.player2Id === pid)
        );
      });
      if (played) return true;
    }
    return false;
  }

  const rows: Row[] = [];
  for (const p of state.participants) {
    const sp = stored.get(p.id);
    const totals = totalsById.get(p.id)!;
    const placed = placementById.get(p.id);

    const storedGame = sp?.match_points ?? null;
    const storedDiff = sp?.differential ?? null;
    const storedPlaceColumn = sp?.place ?? null;
    const oldPlace = oldRanks.get(p.id) ?? null;
    const computedPlace = placed?.place ?? null;
    const computedGame = totals.gameScore;
    const computedDiff = totals.lostSoulScore;

    let status: Row["status"];
    let note: string | undefined;

    const totalsAgree =
      (storedGame === null || storedGame === computedGame) &&
      (storedDiff === null || storedDiff === computedDiff);

    if (p.droppedOut) {
      if (computedPlace == null) {
        status = "dropped_excluded";
        note = "dropped — excluded from new standings (expected)";
      } else {
        status = "unexpected";
        note = "dropped player still has a computed place";
      }
    } else if (!totalsAgree) {
      status = "totals_mismatch";
      note = `stored totals (g=${fmtCell(storedGame)} d=${fmtCell(storedDiff)}) ≠ computed (g=${computedGame} d=${computedDiff})`;
    } else if (oldPlace == null) {
      status = "no_old_data";
      note = "no stored totals → no OLD ranking to compare against";
    } else if (oldPlace === computedPlace) {
      status = "exact";
    } else if (storedGame !== null && storedGame === computedGame) {
      // Place differs but game score matches → could be the H2H tiebreaker fix.
      const peerWithH2H = hasGameScorePeerWithH2H(p.id, computedGame);
      if (peerWithH2H) {
        status = "tied_h2h";
        note = "place reordered within game-score tie group (H2H tiebreaker)";
      } else {
        status = "unexpected";
        note = "place differs at same game score but no H2H peer found";
      }
    } else {
      status = "unexpected";
      note = `place differs and game scores ${fmtCell(storedGame)} vs ${computedGame} don't suggest H2H`;
    }

    rows.push({
      id: p.id,
      name: p.name || "(unnamed)",
      droppedOut: p.droppedOut,
      oldPlace,
      storedPlaceColumn,
      computedPlace,
      storedGame,
      computedGame,
      storedDiff,
      computedDiff,
      status,
      note,
    });
  }

  rows.sort((a, b) => {
    const ap = a.oldPlace ?? a.computedPlace ?? 999;
    const bp = b.oldPlace ?? b.computedPlace ?? 999;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });

  console.log();
  console.log(`Tournament: ${tournament.name}  (${tournament.id})`);
  console.log(`  rounds=${tournament.n_rounds}  current_round=${tournament.current_round}  max_score=${tournament.max_score}`);
  console.log(`  participants=${state.participants.length}  matches=${state.matches.length}  byes=${state.byes.length}`);
  console.log(`  has_started=${tournament.has_started}  has_ended=${tournament.has_ended}`);
  if (!haveStoredTotals) {
    console.log(`  WARN: no stored match_points/differential — falling back to totals-only check.`);
  }
  console.log();

  const NAME_W = 24;
  const NUM_W = 6;
  const STATUS_W = 22;

  const headerCells = [
    pad("name", NAME_W),
    padL("old#", NUM_W),
    padL("new#", NUM_W),
    padL("old-g", NUM_W),
    padL("new-g", NUM_W),
    padL("old-d", NUM_W),
    padL("new-d", NUM_W),
    pad("status", STATUS_W),
    "note",
  ];
  console.log(headerCells.join("  "));
  console.log("-".repeat(headerCells.join("  ").length + 30));

  const counts: Record<Row["status"], number> = {
    exact: 0, tied_h2h: 0, dropped_excluded: 0, totals_mismatch: 0, no_old_data: 0, unexpected: 0,
  };
  const statusGlyph: Record<Row["status"], string> = {
    exact: "[OK]    exact",
    tied_h2h: "[H2H]   tied (h2h fix)",
    dropped_excluded: "[DROP]  dropped",
    totals_mismatch: "[!!]    totals diverge",
    no_old_data: "[--]    no old ranking",
    unexpected: "[XX]    UNEXPECTED",
  };

  for (const r of rows) {
    counts[r.status]++;
    console.log(
      [
        pad(r.name, NAME_W),
        padL(fmtCell(r.oldPlace), NUM_W),
        padL(fmtCell(r.computedPlace), NUM_W),
        padL(fmtCell(r.storedGame), NUM_W),
        padL(String(r.computedGame), NUM_W),
        padL(fmtCell(r.storedDiff), NUM_W),
        padL(String(r.computedDiff), NUM_W),
        pad(statusGlyph[r.status], STATUS_W),
        r.note ?? "",
      ].join("  ")
    );
  }

  console.log();
  console.log("Summary:");
  console.log(`  exact match              : ${counts.exact}`);
  console.log(`  tied (H2H tiebreaker)    : ${counts.tied_h2h}`);
  console.log(`  dropped/excluded         : ${counts.dropped_excluded}`);
  console.log(`  no old ranking available : ${counts.no_old_data}`);
  console.log(`  totals mismatch          : ${counts.totals_mismatch}`);
  console.log(`  UNEXPECTED               : ${counts.unexpected}`);
  console.log();

  if (counts.totals_mismatch > 0) {
    console.log("WARN: per-player totals diverge from stored values — possible regression in scoring math.");
  }
  if (counts.unexpected > 0) {
    console.log("FAIL: at least one row could not be explained by the H2H fix or drop exclusion.");
    process.exit(1);
  } else {
    console.log("OK: all differences are explained by intentional behavior changes.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(2);
});
