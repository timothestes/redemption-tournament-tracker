// lib/tournament/trackerExport.ts
//
// Pure builder for the "Export to Excel" feature: maps a TournamentState onto
// the entry cells of the community "Redemption CCG Tournament Score Tracker
// 2.6" spreadsheet (sheet '2-Player (1)'). No I/O — the OOXML patching lives
// in trackerXlsmPatch.ts and the client orchestration in
// utils/tournament/exportTracker.ts.
//
// Cell layout facts (verified against the tracker's VBA and sheet):
// - Player rows are Excel rows 3..202 (200 rows max).
// - Names go in column B. Column C is a hidden =IF(B="","",1) helper; A25
//   (rounds complete), A31 (player count), A34 (souls-to-win) are formulas —
//   the only writable config cells are A14 (1=Type 1, 2=Type 2) and A28
//   (number of rounds).
// - Round K (1..10) occupies 1-based columns 6+5(K-1)..10+5(K-1):
//   Opponent Name, Round Score (formula), Round LS Differential (formula),
//   Player Score, Opponent Score.
// - Byes use the macro's sentinel scheme (scoreBye): the recipient gets
//   PlayerScore = -4 + (byes received so far), clamped <= 0, OpponentScore 0
//   (the round-score formula turns -3 into 3 points via ABS); the literal
//   "Bye" row mirrors with 0 / soulCap+4. Bye detection is keyed on the exact
//   string "Bye" in opponent cells.

import type { Participant, TournamentState } from "./types";
import { computeFinalStandings } from "./standings";
import { recomputeTotalsFromHistory } from "./results";
import { gameScoreFor } from "./scoring";

export const TRACKER_MAX_ROUNDS = 10;
export const TRACKER_MAX_ROWS = 200;
export const TRACKER_FIRST_ROW = 3;
export const TRACKER_SHEET_NAME = "2-Player (1)";

export interface TrackerCellWrite {
  /** A1-style ref, e.g. "B3", "AY202". */
  ref: string;
  value: string | number;
}

export interface TrackerWriteMap {
  cells: TrackerCellWrite[];
  /** Hidden flag per round group 1..10 (5 columns each). */
  hiddenRounds: { round: number; hidden: boolean }[];
  warnings: string[];
}

export type TrackerExportBuild =
  | { ok: true; map: TrackerWriteMap }
  | { ok: false; errors: string[] };

/** 1-based column number → Excel letters (1 → A, 27 → AA). */
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** First (1-based) column of round K's 5-column group. */
export function roundStartCol(round: number): number {
  return 6 + 5 * (round - 1);
}

interface RowPlan {
  /** null for the literal "Bye" row. */
  participantId: string | null;
  name: string;
}

/**
 * Deduplicate/sanitize participant names for the tracker. The macros key
 * pairing history and bye detection on exact strings, so every name must be
 * unique and none may collide with the reserved "Bye" (the sheet formula
 * compares case-insensitively).
 */
function buildNameMap(
  participants: Participant[],
  warnings: string[],
): Map<string, string> {
  const used = new Set<string>(["bye"]);
  const map = new Map<string, string>();
  for (const p of participants) {
    let name = (p.name || "").trim() || "Unnamed";
    if (name.toLowerCase() === "bye") {
      name = `${name} (player)`;
      warnings.push(
        `"${p.name}" was renamed to "${name}" — the tracker reserves the name Bye.`,
      );
    }
    if (used.has(name.toLowerCase())) {
      let i = 2;
      while (used.has(`${name} (${i})`.toLowerCase())) i++;
      const renamed = `${name} (${i})`;
      warnings.push(
        `Duplicate participant name "${name}" exported as "${renamed}" — the tracker tells players apart by name.`,
      );
      name = renamed;
    }
    used.add(name.toLowerCase());
    map.set(p.id, name);
  }
  return map;
}

/** Points the tracker's round-score formula will compute from written scores. */
function trackerPointsFor(own: number, opp: number, soulCap: number): number {
  const diff = own - opp;
  if (diff === 0) return 1.5;
  if (diff > 0) return own >= soulCap ? 3 : 2;
  return opp < soulCap ? 1 : 0;
}

/**
 * Build the full cell-write map for one tournament. Returns blockers instead
 * of a map when the tournament can't be represented in the tracker at all.
 */
export function buildTrackerWriteMap(state: TournamentState): TrackerExportBuild {
  const errors: string[] = [];
  if (state.soulCap !== 5 && state.soulCap !== 7) {
    errors.push(
      `The tracker only supports 5 or 7 lost souls to win (this tournament uses ${state.soulCap}).`,
    );
  }
  if (state.nRounds > TRACKER_MAX_ROUNDS) {
    errors.push(
      `The tracker supports at most ${TRACKER_MAX_ROUNDS} rounds (this tournament has ${state.nRounds}).`,
    );
  }

  const warnings: string[] = [];
  const inProgress = !state.hasEnded;
  const currentRound = state.currentRound || 0;
  const byId = new Map(state.participants.map((p) => [p.id, p]));
  const nameMap = buildNameMap(state.participants, warnings);

  const currentMatches = inProgress
    ? state.matches
        .filter((m) => m.round === currentRound)
        .sort((a, b) => a.matchOrder - b.matchOrder)
    : [];
  const currentBye = inProgress
    ? state.byes.find((b) => b.round === currentRound)
    : undefined;

  // ---- Row order ---------------------------------------------------------
  const rows: RowPlan[] = [];
  const placed = new Set<string>();
  const push = (id: string) => {
    if (placed.has(id) || !byId.has(id)) return;
    placed.add(id);
    rows.push({ participantId: id, name: nameMap.get(id)! });
  };

  if (inProgress && currentMatches.length > 0) {
    // The macros assume the in-progress round's pairings are row-adjacent
    // (rows 3-4, 5-6, ...) and that a bye recipient sits right above the
    // literal "Bye" row.
    for (const m of currentMatches) {
      push(m.player1Id);
      push(m.player2Id);
    }
    if (currentBye) push(currentBye.participantId);
    // Any active participant somehow outside the current round goes after the
    // paired block so it can't shift pair parity.
    const leftovers = state.participants.filter(
      (p) => !p.droppedOut && !placed.has(p.id),
    );
    if (currentBye) {
      // Bye row must directly follow its recipient.
      rows.push({ participantId: null, name: "Bye" });
    }
    for (const p of leftovers) push(p.id);
    // Dropped players stay out unless the current round still pairs them
    // (already placed above) — the macro would otherwise re-pair them.
  } else {
    // Ended (or nothing paired yet): standings order. Dropped players are
    // included only post-end — mid-tournament the macro would re-pair them.
    const placements = computeFinalStandings(state);
    for (const pl of placements) push(pl.participantId);
    if (!inProgress) {
      const dropped = state.participants
        .filter((p) => p.droppedOut && !placed.has(p.id))
        .map((p) => ({ p, t: recomputeTotalsFromHistory(p.id, state) }))
        .sort(
          (a, b) =>
            b.t.gameScore - a.t.gameScore ||
            b.t.lostSoulScore - a.t.lostSoulScore,
        );
      for (const { p } of dropped) push(p.id);
    }
  }

  if (rows.length > TRACKER_MAX_ROWS) {
    errors.push(
      `The tracker sheet holds ${TRACKER_MAX_ROWS} player rows (this export needs ${rows.length}).`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.participantId) rowOf.set(r.participantId, TRACKER_FIRST_ROW + i);
  });

  // ---- Cells -------------------------------------------------------------
  const cells: TrackerCellWrite[] = [
    { ref: "A14", value: state.soulCap === 7 ? 2 : 1 },
    { ref: "A28", value: state.nRounds },
  ];
  rows.forEach((r, i) => {
    cells.push({ ref: `B${TRACKER_FIRST_ROW + i}`, value: r.name });
  });

  const cap = state.soulCap;
  const capped = (n: number) => Math.min(Math.max(n, 0), cap);
  const mismatches: string[] = [];

  for (const m of state.matches) {
    if (m.round < 1 || m.round > TRACKER_MAX_ROUNDS) continue;
    const start = roundStartCol(m.round);
    const oppCol = colLetter(start);
    const pCol = colLetter(start + 3);
    const oCol = colLetter(start + 4);
    const sides = [
      { selfId: m.player1Id, otherId: m.player2Id },
      { selfId: m.player2Id, otherId: m.player1Id },
    ];
    for (const side of sides) {
      const row = rowOf.get(side.selfId);
      if (!row) continue; // omitted (unpaired dropped player)
      const oppName = nameMap.get(side.otherId);
      if (oppName) cells.push({ ref: `${oppCol}${row}`, value: oppName });
      if (!m.result) continue; // unplayed: leave both score cells empty
      const own =
        side.selfId === m.player1Id ? m.result.p1Souls : m.result.p2Souls;
      const opp =
        side.selfId === m.player1Id ? m.result.p2Souls : m.result.p1Souls;
      cells.push({ ref: `${pCol}${row}`, value: capped(own) });
      cells.push({ ref: `${oCol}${row}`, value: capped(opp) });

      const outcome =
        side.selfId === m.player1Id ? m.result.p1Outcome : m.result.p2Outcome;
      const appPts = gameScoreFor(outcome);
      const excelPts = trackerPointsFor(capped(own), capped(opp), cap);
      if (appPts !== excelPts) {
        const selfName = nameMap.get(side.selfId) ?? side.selfId;
        mismatches.push(
          `Round ${m.round}, ${selfName} vs ${oppName ?? "?"}: the app awarded ${appPts} points but the tracker will compute ${excelPts} from the scores ${capped(own)}-${capped(opp)}.`,
        );
      }
    }
  }

  // Byes: sentinel scheme per recipient, decaying with repeat byes.
  const byesByParticipant = new Map<string, number[]>();
  for (const b of state.byes) {
    const list = byesByParticipant.get(b.participantId) ?? [];
    list.push(b.round);
    byesByParticipant.set(b.participantId, list);
  }
  let hasByes = false;
  let stagedBye = false;
  for (const [pid, roundsList] of byesByParticipant) {
    const row = rowOf.get(pid);
    if (!row) continue;
    roundsList.sort((a, b) => a - b);
    roundsList.forEach((round, idx) => {
      if (round < 1 || round > TRACKER_MAX_ROUNDS) return;
      hasByes = true;
      const start = roundStartCol(round);
      cells.push({ ref: `${colLetter(start)}${row}`, value: "Bye" });
      // -4 + number of byes received through this round, clamped <= 0:
      // first bye -3 (3 pts via ABS), second -2, ... fifth+ 0.
      cells.push({
        ref: `${colLetter(start + 3)}${row}`,
        value: Math.min(-4 + (idx + 1), 0),
      });
      cells.push({ ref: `${colLetter(start + 4)}${row}`, value: 0 });
      if (state.startedRounds && !state.startedRounds.includes(round)) {
        stagedBye = true;
      }
    });
  }

  // The literal "Bye" row mirrors the current round only.
  if (inProgress && currentBye) {
    const byeRowIdx = rows.findIndex((r) => r.participantId === null);
    if (byeRowIdx >= 0) {
      const row = TRACKER_FIRST_ROW + byeRowIdx;
      const start = roundStartCol(currentRound);
      const recipient = nameMap.get(currentBye.participantId);
      if (recipient) {
        cells.push({ ref: `${colLetter(start)}${row}`, value: recipient });
      }
      cells.push({ ref: `${colLetter(start + 3)}${row}`, value: 0 });
      cells.push({ ref: `${colLetter(start + 4)}${row}`, value: cap + 4 });
    }
  }

  // ---- Warnings ----------------------------------------------------------
  if (hasByes) {
    warnings.push(
      "Byes follow the tracker's own rules in Excel: a first bye scores 3 points but -" +
        "3 lost-soul differential, and repeat byes decay (2, 1, 0 points). The app awards a flat 3 points / 0 differential, so those totals will differ.",
    );
  }
  if (stagedBye) {
    warnings.push(
      "A bye in a staged-but-not-started round doesn't score in the app yet, but Excel will count it immediately.",
    );
  }
  warnings.push(...mismatches);

  // ---- Round column visibility ------------------------------------------
  const hiddenRounds: { round: number; hidden: boolean }[] = [];
  for (let k = 1; k <= TRACKER_MAX_ROUNDS; k++) {
    const hidden = state.hasEnded
      ? k > state.nRounds
      : k !== Math.max(currentRound, 1);
    hiddenRounds.push({ round: k, hidden });
  }

  return { ok: true, map: { cells, hiddenRounds, warnings } };
}
