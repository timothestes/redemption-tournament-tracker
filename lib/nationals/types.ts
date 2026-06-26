/** Redemption Nationals History — shared types. */

// ── Tournament ──────────────────────────────────────────────────────────────

export interface FantasyPickBreakdown {
  format: string;
  pts: number;
}

export interface FantasyPlayer {
  name: string;
  pts: number;
  breakdown: FantasyPickBreakdown[];
  draftPick: number;
}

export interface FantasyTeam {
  gm: string;
  pts: number;
  players: FantasyPlayer[];
}

export interface FantasyDraft {
  year: number;
  teams: FantasyTeam[];
}

export interface Tournament {
  id: string;
  year: number;
  location: string;
  dates: string;
  venue: string;
  attendance: number | null;
  formats: string[];
  notes: string;
  fantasyDraft?: FantasyDraft;
  topCut?: number | null;
  topCutFormats?: string[];
}

// ── Player ──────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  handle: string;
  region: string;
  notes: string;
}

// ── Result (standings entry for a format+year) ──────────────────────────────

export interface ResultEntry {
  id: string;
  playerName: string;
  placement: number;
  deck: string;
  record: string;
  notes: string;
}

/** Key: "<year>_<format>", value: player-name → ResultEntry */
export type ResultsMap = Record<string, Record<string, ResultEntry>>;

// ── Match ────────────────────────────────────────────────────────────────────

export interface MatchEntry {
  id: string;
  round: string;
  table: number | null;
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
  winner: string;
  notes: string;
}

/** Key: "<year>_<format>", value: array of matches */
export type MatchesMap = Record<string, MatchEntry[]>;

// ── Root data shape ──────────────────────────────────────────────────────────

export interface NationalsData {
  tournaments: Tournament[];
  players: Player[];
  results: ResultsMap;
  matches: MatchesMap;
}
