/**
 * Redemption Nationals History — Advanced Metrics engine.
 * Pure logic: no DOM, no React, no globals.
 * Ported faithfully from nationals-history-source.html lines 1609–2231.
 */

import type { NationalsData } from "./types";
import { parseKey } from "./format";

// ── Constants ─────────────────────────────────────────────────────────────────

const FULL_THRESH = 3;

// ── Public types ──────────────────────────────────────────────────────────────

export interface Col {
  id: string;
  label: string;
  nosort?: boolean;
  dflt?: boolean;
  dfltAsc?: boolean;
}

export interface MetricFilters {
  mode: string;
  /** Set containing "All" or specific internal format keys */
  formats: Set<string>;
  yearFrom: number;
  yearTo: number;
  /** When non-null, overrides yearFrom/yearTo */
  customYears: Set<number> | null;
  minApp: number;
  maxApp: number;
  minNats: number;
  maxNats: number;
  comparePlayer: string | null;
  rivalryMode: "wins" | "losses";
  vspTarget: string | null;
}

// ── Mode list (SRC:1609-1622) ─────────────────────────────────────────────────

export const AM_MODES: { id: string; label: string }[] = [
  { id: "winpct",     label: "Win % (2P)" },
  { id: "placement",  label: "Avg Placement" },
  { id: "percentile", label: "Field %" },
  { id: "podiums",    label: "Podium Finishes" },
  { id: "lsd",        label: "Soul Differential" },
  { id: "pts",        label: "Career Points" },
  { id: "multiwl",    label: "Multi Win %" },
  { id: "topcut",     label: "Top Cut" },
  { id: "rivalry",    label: "Rivalry" },
  { id: "unique",     label: "Unique Wins" },
  { id: "vsp",        label: "Record vs Player" },
];

// ── Column definitions (SRC:1956-2059) ────────────────────────────────────────

export const AM_COLS: Record<string, Col[]> = {
  winpct: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "W",        label: "W" },
    { id: "L",        label: "L" },
    { id: "D",        label: "D" },
    { id: "decisive", label: "W+L" },
    { id: "apps",     label: "Appearances" },
    { id: "nats",     label: "Nats" },
    { id: "pct",      label: "Win %",        dflt: true, dfltAsc: false },
  ],
  multiwl: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "W",        label: "W" },
    { id: "L",        label: "L" },
    { id: "D",        label: "D" },
    { id: "decisive", label: "W+L" },
    { id: "apps",     label: "Appearances",  dflt: false },
    { id: "nats",     label: "Nats" },
    { id: "pct",      label: "Win %",        dflt: true, dfltAsc: false },
    { id: "fmts",     label: "Formats" },
  ],
  placement: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "apps",     label: "Appearances" },
    { id: "nats",     label: "Nats" },
    { id: "best",     label: "Best" },
    { id: "worst",    label: "Worst" },
    { id: "avg",      label: "Avg Placement", dflt: true, dfltAsc: true },
  ],
  percentile: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "apps",     label: "Appearances" },
    { id: "nats",     label: "Nats" },
    { id: "best",     label: "Best" },
    { id: "worst",    label: "Worst" },
    { id: "avg",      label: "Avg Field %", dflt: true, dfltAsc: false },
  ],
  podiums: [
    { id: "_rank",     label: "#",           nosort: true },
    { id: "name",      label: "Player" },
    { id: "totalApps", label: "Appearances" },
    { id: "nats",      label: "Nats" },
    { id: "top3",      label: "Top 3",       dflt: true, dfltAsc: false },
    { id: "p1",        label: "1st" },
    { id: "p2",        label: "2nd" },
    { id: "p3",        label: "3rd" },
    { id: "podiumRate", label: "Podium %",   dflt: false, dfltAsc: false },
  ],
  lsd: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "apps",     label: "Appearances" },
    { id: "nats",     label: "Nats" },
    { id: "best",     label: "Best" },
    { id: "worst",    label: "Worst" },
    { id: "total",    label: "Total" },
    { id: "avg",      label: "Avg LSD",      dflt: true, dfltAsc: false },
  ],
  topcut: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "W",        label: "W" },
    { id: "L",        label: "L" },
    { id: "games",    label: "Games" },
    { id: "nats",     label: "Nats" },
    { id: "pct",      label: "Win %",        dflt: true, dfltAsc: false },
  ],
  rivalry: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "opponent", label: "Opponent" },
    { id: "W",        label: "W vs Opp",     dflt: false },
    { id: "L",        label: "L vs Opp" },
    { id: "D",        label: "D" },
    { id: "pct",      label: "Win %",        dflt: true, dfltAsc: false },
  ],
  unique: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "unique",   label: "Unique Opp Beaten", dflt: true, dfltAsc: false },
    { id: "W",        label: "Total Wins" },
    { id: "nats",     label: "Nats" },
  ],
  vsp: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "W",        label: "W vs Target",  dflt: false },
    { id: "L",        label: "L vs Target" },
    { id: "D",        label: "D" },
    { id: "games",    label: "Games" },
    { id: "pct",      label: "Win %",        dflt: true, dfltAsc: false },
  ],
  pts: [
    { id: "_rank",    label: "#",            nosort: true },
    { id: "name",     label: "Player" },
    { id: "total",    label: "Career Pts",   dflt: true, dfltAsc: false },
    { id: "apps",     label: "Appearances" },
    { id: "nats",     label: "Nats" },
    { id: "avg",      label: "Avg Pts/Nats", dflt: false, dfltAsc: false },
    { id: "best",     label: "Best Single",  dflt: false, dfltAsc: false },
  ],
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function amParseKey(k: string): { yr: number; fmt: string } {
  const u = k.indexOf("_");
  return { yr: parseInt(k.slice(0, u)), fmt: k.slice(u + 1) };
}

/** Returns the active year set. Mirrors amActiveYears() from source. */
function amActiveYears(filters: MetricFilters): Set<number> {
  if (filters.customYears) return filters.customYears;
  const s = new Set<number>();
  for (let y = filters.yearFrom; y <= filters.yearTo; y++) s.add(y);
  return s;
}

/**
 * Returns formats that have full standings (>FULL_THRESH entries), keyed by format.
 * Mirrors amGetFullYearsByFmt() from source.
 */
export function amGetFullYearsByFmt(seed: NationalsData): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  Object.entries(seed.results).forEach(([k, entries]) => {
    const { yr, fmt } = amParseKey(k);
    if (entries.length > FULL_THRESH) {
      if (!out[fmt]) out[fmt] = new Set();
      out[fmt].add(yr);
    }
  });
  return out;
}

/**
 * Resolves the active format set to internal keys (or null = all formats).
 * Mirrors amActiveFmtSet() from source.
 */
function amActiveFmtSet(seed: NationalsData, filters: MetricFilters): Set<string> | null {
  if (filters.formats.has("All") || filters.formats.size === 0) return null;
  // filters.formats may contain internal keys directly (Task 12 will pass internal keys)
  return new Set(filters.formats);
}

/**
 * Builds field size (distinct Round 1 participants, BYE excluded) keyed by
 * "<year>_<format>". Only includes keys with match data — older years and
 * multiplayer formats aren't tracked round-by-round, so they're absent here
 * rather than guessed from the (possibly drop-shrunk) standings count.
 */
function amBuildFieldSizeByKey(seed: NationalsData): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(seed.matches).forEach(([k, matches]) => {
    const names = new Set<string>();
    matches.forEach((m) => {
      if (m.round !== "Round 1") return;
      [m.playerA, m.playerB].forEach((p) => {
        if (p && p.toLowerCase() !== "bye") names.add(p);
      });
    });
    if (names.size > 0) out[k] = names.size;
  });
  return out;
}

/**
 * Builds per-player nats attendance (unique years appeared in any result).
 * Mirrors amBuildAttendance() from source (SRC:1715-1726).
 */
function amBuildAttendance(seed: NationalsData): Record<string, number> {
  const att: Record<string, Set<number>> = {};
  Object.entries(seed.results).forEach(([k, entries]) => {
    const { yr } = amParseKey(k);
    entries.forEach((e) => {
      const n = e.playerName;
      if (!n || n === "bye") return;
      if (!att[n]) att[n] = new Set();
      att[n].add(yr);
    });
  });
  const counts: Record<string, number> = {};
  Object.entries(att).forEach(([n, s]) => (counts[n] = s.size));
  return counts;
}

// ── round1 helper (SRC:2092) ──────────────────────────────────────────────────

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ── 10 pure builders ──────────────────────────────────────────────────────────

/** Win % (2P) — SRC:1739-1772 */
function buildWinPct(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const players: Record<string, { W: number; L: number; D: number; apps: Set<string> }> = {};
  const activeFmts = amActiveFmtSet(seed, filters);
  const minApp = filters.minApp;
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);

  Object.entries(seed.matches).forEach(([k, matches]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    if (!activeYrs.has(yr)) return;
    matches.forEach((m) => {
      [m.playerA, m.playerB].forEach((p) => {
        if (!p || p.toLowerCase() === "bye") return;
        if (!players[p]) players[p] = { W: 0, L: 0, D: 0, apps: new Set() };
        const won = m.winner === p;
        const lost = !!m.winner && m.winner !== p;
        if (won) players[p].W++;
        else if (lost) players[p].L++;
        else players[p].D++;
        players[p].apps.add(yr + "|" + fmt);
      });
    });
  });

  const MIN_GAMES = 5;
  return Object.entries(players)
    .map(([name, s]) => {
      const decisive = s.W + s.L;
      const pct = decisive > 0 ? s.W / decisive : 0;
      return { name, W: s.W, L: s.L, D: s.D, decisive, pct, apps: s.apps.size, nats: att[name] || 0 };
    })
    .filter(
      (r) =>
        r.decisive >= MIN_GAMES &&
        r.decisive <= filters.maxApp &&
        r.apps >= minApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

/** Multi Win % — SRC:1773-1811 */
function buildMultiWL(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  if (!seed.multiWL) return [];
  const players: Record<string, { W: number; L: number; D: number; apps: number; fmts: Set<string> }> = {};
  const activeFmts = amActiveFmtSet(seed, filters);
  const minApp = filters.minApp;
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);

  Object.entries(seed.multiWL).forEach(([pname, fmtData]) => {
    if (!fmtData || typeof fmtData !== "object") return;
    Object.entries(fmtData).forEach(([mfmt, wld]) => {
      if (activeFmts && !activeFmts.has(mfmt)) return;
      let hasActiveYear = false;
      Object.keys(seed.results).forEach((k) => {
        const { yr, fmt } = amParseKey(k);
        if (fmt !== mfmt) return;
        if (!activeYrs.has(yr)) return;
        if (seed.results[k].some((e) => e.playerName === pname)) hasActiveYear = true;
      });
      if (!hasActiveYear) return;
      if (!players[pname]) players[pname] = { W: 0, L: 0, D: 0, apps: 0, fmts: new Set() };
      players[pname].W += wld.W || 0;
      players[pname].L += wld.L || 0;
      players[pname].D += wld.D || 0;
      players[pname].apps++;
      players[pname].fmts.add(mfmt);
    });
  });

  const MIN_ROUNDS = 3;
  return Object.entries(players)
    .map(([name, s]) => {
      const decisive = s.W + s.L;
      const pct = decisive > 0 ? s.W / decisive : 0;
      return {
        name, W: s.W, L: s.L, D: s.D, decisive, pct,
        apps: s.apps, fmts: Array.from(s.fmts).sort().join(", "),
        nats: att[name] || 0,
      };
    })
    .filter((r) => r.W + r.L + r.D >= MIN_ROUNDS && r.nats >= minNats);
}

/** Avg Placement — SRC:1812-1843 */
function buildPlacement(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const activeFmts = amActiveFmtSet(seed, filters);
  const minApp = filters.minApp;
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);
  const fullByFmt = amGetFullYearsByFmt(seed);
  const players: Record<string, Record<string, number>> = {};

  Object.entries(seed.results).forEach(([k, entries]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    const fmtFullYrs = fullByFmt[fmt] || new Set<number>();
    if (!fmtFullYrs.has(yr)) return;
    if (!activeYrs.has(yr)) return;
    if (entries.length <= FULL_THRESH) return;
    entries.forEach((e) => {
      if (!e.playerName || e.playerName.toLowerCase() === "bye" || !e.placement) return;
      if (!players[e.playerName]) players[e.playerName] = {};
      const key2 = fmt + "|" + yr;
      if (!players[e.playerName][key2] || e.placement < players[e.playerName][key2])
        players[e.playerName][key2] = e.placement;
    });
  });

  return Object.entries(players)
    .map(([name, seen]) => {
      const pls = Object.values(seen);
      const avg = pls.reduce((s, p) => s + p, 0) / pls.length;
      const best = Math.min(...pls);
      const worst = Math.max(...pls);
      return { name, avg, best, worst, apps: pls.length, nats: att[name] || 0 };
    })
    .filter(
      (r) =>
        r.apps >= minApp &&
        r.apps <= filters.maxApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

/**
 * Field % — how a placement compares to the size of the field it was
 * placed in. 100% = beat the entire field (won), 0% = last place. Only
 * counts year+formats with known Round 1 field size (see
 * amBuildFieldSizeByKey) and a field of >1, since the source data is the
 * community-requested addition to Career History (fieldSize on
 * CareerHistoryEntry in selectors.ts) generalized across all players.
 */
function buildPercentile(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const activeFmts = amActiveFmtSet(seed, filters);
  const minApp = filters.minApp;
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);
  const fieldByKey = amBuildFieldSizeByKey(seed);
  const players: Record<string, number[]> = {};

  Object.entries(seed.results).forEach(([k, entries]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    if (!activeYrs.has(yr)) return;
    const fieldSize = fieldByKey[k];
    if (!fieldSize || fieldSize <= 1) return;
    // One row per player per key, mirroring playerProfile's results.find (first
    // row), so Field % here agrees with the profile's Field % — some keys carry
    // a duplicate standings row for the same player.
    const seen = new Set<string>();
    entries.forEach((e) => {
      if (!e.playerName || e.playerName.toLowerCase() === "bye") return;
      if (seen.has(e.playerName)) return;
      seen.add(e.playerName);
      if (!e.placement) return;
      // Clamp: a handful of rows have a placement one past the Round 1 field,
      // which would otherwise put a "last place" finish slightly below 0%.
      const raw = ((fieldSize - e.placement) / (fieldSize - 1)) * 100;
      const pct = Math.max(0, Math.min(100, raw));
      if (!players[e.playerName]) players[e.playerName] = [];
      players[e.playerName].push(pct);
    });
  });

  return Object.entries(players)
    .map(([name, pcts]) => {
      const avg = pcts.reduce((s, p) => s + p, 0) / pcts.length;
      const best = Math.max(...pcts);
      const worst = Math.min(...pcts);
      return { name, avg, best, worst, apps: pcts.length, nats: att[name] || 0 };
    })
    .filter(
      (r) =>
        r.apps >= minApp &&
        r.apps <= filters.maxApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

/** Podium Finishes — SRC:1844-1880 */
function buildPodiums(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const activeFmts = amActiveFmtSet(seed, filters);
  const minApp = filters.minApp;
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const players: Record<string, { p1: number; p2: number; p3: number; top3: number; apps: Set<string>; stubApps: Set<string> }> = {};

  Object.entries(seed.results).forEach(([k, entries]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    const dedup = new Set<string>();
    entries.forEach((e) => {
      if (!e.playerName || e.playerName.toLowerCase() === "bye") return;
      if (!players[e.playerName])
        players[e.playerName] = { p1: 0, p2: 0, p3: 0, top3: 0, apps: new Set(), stubApps: new Set() };
      const appKey = e.playerName + "|" + fmt + "|" + yr;
      const isStub = entries.length <= FULL_THRESH;
      if (!dedup.has(appKey)) {
        dedup.add(appKey);
        if (isStub) players[e.playerName].stubApps.add(fmt + "|" + yr);
        else players[e.playerName].apps.add(fmt + "|" + yr);
      }
      if (e.placement === 1) players[e.playerName].p1++;
      else if (e.placement === 2) players[e.playerName].p2++;
      else if (e.placement === 3) players[e.playerName].p3++;
      if (e.placement <= 3) players[e.playerName].top3++;
    });
  });

  return Object.entries(players)
    .map(([name, s]) => {
      const totalApps = s.apps.size + s.stubApps.size;
      const podiumRate = totalApps > 0 ? s.top3 / totalApps : 0;
      return { name, p1: s.p1, p2: s.p2, p3: s.p3, top3: s.top3, apps: s.apps.size, stubApps: s.stubApps.size, totalApps, podiumRate, nats: att[name] || 0 };
    })
    .filter(
      (r) =>
        r.totalApps >= minApp &&
        r.totalApps <= filters.maxApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

/** Soul Differential — SRC:1881-1916 */
function buildLSD(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const activeFmts = amActiveFmtSet(seed, filters);
  const minApp = filters.minApp;
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);
  const fullByFmt = amGetFullYearsByFmt(seed);
  const players: Record<string, { lsds: number[]; apps: Set<string> }> = {};

  Object.entries(seed.results).forEach(([k, entries]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    const fmtFullYrs = fullByFmt[fmt] || new Set<number>();
    if (!fmtFullYrs.has(yr)) return;
    if (!activeYrs.has(yr)) return;
    if (entries.length <= FULL_THRESH) return;
    const seen = new Set<string>();
    entries.forEach((e) => {
      if (!e.playerName || e.playerName.toLowerCase() === "bye") return;
      const m = e.notes && e.notes.match(/(-?\d+)\s*LSD/);
      if (!m) return;
      const key2 = fmt + "|" + yr + "|" + e.playerName;
      if (seen.has(key2)) return;
      seen.add(key2);
      const lsd = parseInt(m[1]);
      if (!players[e.playerName]) players[e.playerName] = { lsds: [], apps: new Set() };
      players[e.playerName].lsds.push(lsd);
      players[e.playerName].apps.add(fmt + "|" + yr);
    });
  });

  return Object.entries(players)
    .map(([name, s]) => {
      const avg = s.lsds.reduce((a, b) => a + b, 0) / s.lsds.length;
      const best = Math.max(...s.lsds);
      const worst = Math.min(...s.lsds);
      const total = s.lsds.reduce((a, b) => a + b, 0);
      return { name, avg, best, worst, total, apps: s.lsds.length, nats: att[name] || 0 };
    })
    .filter(
      (r) =>
        r.apps >= minApp &&
        r.apps <= filters.maxApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

/** Top Cut — SRC:1917-1945 */
function buildTopCut(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const players: Record<string, { W: number; L: number }> = {};
  const activeFmts = amActiveFmtSet(seed, filters);
  const minApp = filters.minApp;
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);

  Object.entries(seed.matches).forEach(([k, matches]) => {
    const { yr, fmt } = amParseKey(k);
    if (!matches.some((m) => m.topCut)) return;
    if (activeFmts && !activeFmts.has(fmt)) return;
    if (!activeYrs.has(yr)) return;
    matches
      .filter((m) => m.topCut)
      .forEach((m) => {
        [m.playerA, m.playerB].forEach((p) => {
          if (!p || p.toLowerCase() === "bye") return;
          if (!players[p]) players[p] = { W: 0, L: 0 };
          if (m.winner === p) players[p].W++;
          else if (m.winner && m.winner !== p) players[p].L++;
        });
      });
  });

  return Object.entries(players)
    .map(([name, s]) => {
      const g = s.W + s.L;
      const pct = g > 0 ? s.W / g : 0;
      return { name, W: s.W, L: s.L, games: g, pct, nats: att[name] || 0 };
    })
    .filter(
      (r) =>
        r.games >= minApp &&
        r.games <= filters.maxApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

/** Career Points — SRC:2060-2091 */
function buildPts(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const activeFmts = amActiveFmtSet(seed, filters);
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);
  const players: Record<string, { total: number; apps: number; nats: Set<number>; best: number }> = {};

  Object.entries(seed.results).forEach(([k, results]) => {
    const u = k.indexOf("_");
    const yr = parseInt(k.slice(0, u));
    const fmt = k.slice(u + 1);
    if (activeFmts && !activeFmts.has(fmt)) return;
    if (!activeYrs.has(yr)) return;
    if (results.length <= FULL_THRESH) return;
    results.forEach((e) => {
      const name = e.playerName;
      if (!name || name.toLowerCase() === "bye") return;
      const m = e.notes && e.notes.match(/([\d.]+)pts/);
      if (!m) return;
      const pts = parseFloat(m[1]);
      if (!players[name]) players[name] = { total: 0, apps: 0, nats: new Set(), best: 0 };
      players[name].total += pts;
      players[name].apps++;
      players[name].nats.add(yr);
      if (pts > players[name].best) players[name].best = pts;
    });
  });

  const minApp = filters.minApp;
  return Object.entries(players)
    .map(([name, s]) => {
      const nats = s.nats.size;
      return { name, total: round1(s.total), apps: s.apps, nats, avg: round1(s.total / nats), best: round1(s.best) };
    })
    .filter(
      (r) =>
        r.nats >= minNats &&
        r.nats <= filters.maxNats &&
        r.apps >= minApp &&
        r.apps <= filters.maxApp
    );
}

/** Rivalry — SRC:2096-2138 */
function buildRivalry(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const activeFmts = amActiveFmtSet(seed, filters);
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);
  const playerOpp: Record<string, Record<string, { W: number; L: number; D: number }>> = {};

  Object.entries(seed.matches).forEach(([k, matches]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    if (!activeYrs.has(yr)) return;
    matches.forEach((m) => {
      (
        [
          ["playerA", "playerB"],
          ["playerB", "playerA"],
        ] as [keyof typeof m, keyof typeof m][]
      ).forEach(([me, them]) => {
        const p = m[me] as string;
        const o = m[them] as string;
        if (!p || !o || o.toLowerCase() === "bye") return;
        if (!playerOpp[p]) playerOpp[p] = {};
        if (!playerOpp[p][o]) playerOpp[p][o] = { W: 0, L: 0, D: 0 };
        const won = m.winner === p;
        const lost = !!m.winner && m.winner !== p;
        if (won) playerOpp[p][o].W++;
        else if (lost) playerOpp[p][o].L++;
        else playerOpp[p][o].D++;
      });
    });
  });

  const isWins = filters.rivalryMode === "wins";
  const minGames = Math.max(1, filters.minApp);

  return Object.entries(playerOpp)
    .map(([name, opps]) => {
      let best: string | null = null;
      let bestVal = 0;
      Object.entries(opps).forEach(([opp, s]) => {
        const val = isWins ? s.W : s.L;
        if (
          val > bestVal ||
          (val === bestVal &&
            best &&
            (isWins ? s.L < opps[best].L : s.W < opps[best].W))
        ) {
          bestVal = val;
          best = opp;
        }
      });
      if (!best || bestVal < minGames) return null;
      const s = opps[best];
      const dec = s.W + s.L;
      const pct = dec > 0 ? s.W / dec : null;
      return { name, opponent: best, W: s.W, L: s.L, D: s.D, pct, nats: att[name] || 0 };
    })
    .filter(
      (r): r is NonNullable<typeof r> =>
        r !== null &&
        (att[r.name] || 0) >= minNats &&
        (att[r.name] || 0) <= filters.maxNats
    );
}

/** Unique Wins — SRC:2139-2164 */
function buildUnique(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  const activeFmts = amActiveFmtSet(seed, filters);
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);
  const players: Record<string, { unique: Set<string>; W: number }> = {};

  Object.entries(seed.matches).forEach(([k, matches]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    if (!activeYrs.has(yr)) return;
    matches.forEach((m) => {
      if (!m.winner || m.winner.toLowerCase() === "bye") return;
      const loser = m.playerA === m.winner ? m.playerB : m.playerA;
      if (!loser || loser.toLowerCase() === "bye") return;
      if (!players[m.winner]) players[m.winner] = { unique: new Set(), W: 0 };
      players[m.winner].unique.add(loser);
      players[m.winner].W++;
    });
  });

  const minApp = filters.minApp;
  return Object.entries(players)
    .map(([name, s]) => ({ name, unique: s.unique.size, W: s.W, nats: att[name] || 0 }))
    .filter(
      (r) =>
        r.unique >= minApp &&
        r.unique <= filters.maxApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

/** Record vs Player — SRC:2165-2195 */
function buildVsp(seed: NationalsData, filters: MetricFilters): Record<string, any>[] {
  if (!filters.vspTarget) return [];
  const activeFmts = amActiveFmtSet(seed, filters);
  const att = amBuildAttendance(seed);
  const minNats = filters.minNats;
  const activeYrs = amActiveYears(filters);
  const players: Record<string, { W: number; L: number; D: number }> = {};

  Object.entries(seed.matches).forEach(([k, matches]) => {
    const { yr, fmt } = amParseKey(k);
    if (activeFmts && !activeFmts.has(fmt)) return;
    if (!activeYrs.has(yr)) return;
    matches
      .filter((m) => m.playerA === filters.vspTarget || m.playerB === filters.vspTarget)
      .forEach((m) => {
        const opp = m.playerA === filters.vspTarget ? m.playerB : m.playerA;
        if (!opp || opp.toLowerCase() === "bye") return;
        if (!players[opp]) players[opp] = { W: 0, L: 0, D: 0 };
        const oppWon = m.winner === opp;
        const oppLost = !!m.winner && m.winner !== opp;
        if (oppWon) players[opp].W++;
        else if (oppLost) players[opp].L++;
        else players[opp].D++;
      });
  });

  const minApp = filters.minApp;
  return Object.entries(players)
    .map(([name, s]) => {
      const dec = s.W + s.L;
      const pct = dec > 0 ? s.W / dec : null;
      return { name, W: s.W, L: s.L, D: s.D, games: dec + s.D, pct, nats: att[name] || 0 };
    })
    .filter(
      (r) =>
        r.games >= minApp &&
        r.games <= filters.maxApp &&
        r.nats >= minNats &&
        r.nats <= filters.maxNats
    );
}

// ── Sort (SRC:2210-2231) ──────────────────────────────────────────────────────

/**
 * Sorts rows by a column id. Mirrors amSortData() from source.
 * col="" triggers default sort from AM_COLS[mode].
 */
export function sortRows(
  rows: Record<string, any>[],
  cols: Col[],
  col: string,
  asc: boolean
): Record<string, any>[] {
  if (!col || !rows.length) return rows;
  return [...rows].sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return asc ? cmp : -cmp;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Dispatch + sort. Returns columns and sorted rows for the given mode.
 * Mirrors amBuildData() + amSortData() + comparePlayer pin from source.
 */
export function computeMetric(
  seed: NationalsData,
  filters: MetricFilters
): { columns: Col[]; rows: Record<string, any>[] } {
  const mode = filters.mode;

  let raw: Record<string, any>[];
  if (mode === "winpct")    raw = buildWinPct(seed, filters);
  else if (mode === "placement") raw = buildPlacement(seed, filters);
  else if (mode === "percentile") raw = buildPercentile(seed, filters);
  else if (mode === "podiums")   raw = buildPodiums(seed, filters);
  else if (mode === "lsd")       raw = buildLSD(seed, filters);
  else if (mode === "multiwl")   raw = buildMultiWL(seed, filters);
  else if (mode === "topcut")    raw = buildTopCut(seed, filters);
  else if (mode === "rivalry")   raw = buildRivalry(seed, filters);
  else if (mode === "unique")    raw = buildUnique(seed, filters);
  else if (mode === "vsp")       raw = buildVsp(seed, filters);
  else if (mode === "pts")       raw = buildPts(seed, filters);
  else raw = [];

  const cols = AM_COLS[mode] ?? [];

  // Determine default sort
  let sortCol: string;
  let sortAsc: boolean;
  if (mode === "rivalry") {
    sortCol = filters.rivalryMode === "wins" ? "W" : "L";
    sortAsc = false;
  } else {
    const dflt = cols.find((c) => c.dflt);
    sortCol = dflt?.id ?? "";
    sortAsc = !!(dflt?.dfltAsc);
  }

  let rows = sortRows(raw, cols, sortCol, sortAsc);

  // Pin comparePlayer to top (mirrors amRender pin logic)
  if (filters.comparePlayer) {
    const idx = rows.findIndex((r) => r.name === filters.comparePlayer);
    if (idx > 0) {
      const [row] = rows.splice(idx, 1);
      rows = [row, ...rows];
    }
  }

  return { columns: cols, rows };
}
