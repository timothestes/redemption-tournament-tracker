"use client";

import { useState, useMemo } from "react";
import { useSeed } from "../seed-context";
import { SectionTitle } from "../components/SectionTitle";
import { headToHead, playerProfile } from "@/lib/nationals/selectors";
import { amGetFullYearsByFmt } from "@/lib/nationals/metrics";
import type { PlayerProfile } from "@/lib/nationals/selectors";
import { cn } from "@/lib/utils";

// ── Typeahead ─────────────────────────────────────────────────────────────────

interface TypeaheadProps {
  label: string;
  value: string;
  onChange: (name: string) => void;
  allNames: string[];
  /** Exclude this name from suggestions (the other player) */
  exclude?: string;
  accentClass: string;
}

function Typeahead({ label, value, onChange, allNames, exclude, accentClass }: TypeaheadProps) {
  const [inputVal, setInputVal] = useState(value);
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    const q = inputVal.trim().toLowerCase();
    if (q.length < 2) return [];
    return allNames
      .filter((n) => n !== exclude && n.toLowerCase().includes(q))
      .slice(0, 10);
  }, [inputVal, allNames, exclude]);

  function pick(name: string) {
    setInputVal(name);
    onChange(name);
    setOpen(false);
  }

  return (
    <div className="relative flex-1 min-w-0">
      <label className={cn("block text-xs font-semibold uppercase tracking-wide mb-1", accentClass)}>
        {label}
      </label>
      <input
        type="text"
        value={inputVal}
        placeholder="Type a name…"
        autoComplete="off"
        onChange={(e) => {
          setInputVal(e.target.value);
          setOpen(true);
          // clear selection if user edits
          if (e.target.value !== value) onChange("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full px-3 py-2 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary transition"
      />
      {value && (
        <span className={cn("block mt-1 text-xs font-semibold", accentClass)}>
          ✓ {value}
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border border-border bg-card shadow-md overflow-hidden">
          {suggestions.map((n) => (
            <button
              key={n}
              type="button"
              onMouseDown={() => pick(n)}
              className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted/60 border-b border-border last:border-0 transition-colors"
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stat row helpers ──────────────────────────────────────────────────────────

type EdgeResult = "edge" | "loss" | "tie" | "none";

function computeEdge(
  aVal: number | null,
  bVal: number | null,
  lowerBetter = false
): { L: EdgeResult; R: EdgeResult } {
  if (aVal === null || bVal === null) return { L: "none", R: "none" };
  const aWins = lowerBetter ? aVal < bVal : aVal > bVal;
  const bWins = lowerBetter ? bVal < aVal : bVal > aVal;
  return {
    L: aWins ? "edge" : bWins ? "loss" : "tie",
    R: bWins ? "edge" : aWins ? "loss" : "tie",
  };
}

function StatCell({
  val,
  edge,
  display,
}: {
  val: number | null;
  edge: EdgeResult;
  display: string | null;
}) {
  if (val === null || display === null) {
    return (
      <td className="text-center px-4 py-2.5 text-muted-foreground text-sm">—</td>
    );
  }
  return (
    <td
      className={cn(
        "text-center px-4 py-2.5 text-sm transition-colors",
        edge === "edge" && "text-primary font-semibold bg-primary/5",
        edge === "loss" && "text-muted-foreground font-normal",
        edge === "tie" && "text-muted-foreground font-medium"
      )}
    >
      {display}
    </td>
  );
}

interface StatRowProps {
  label: string;
  aVal: number | null;
  bVal: number | null;
  lowerBetter?: boolean;
  fmt?: (v: number) => string;
}

function StatRow({ label, aVal, bVal, lowerBetter = false, fmt }: StatRowProps) {
  const edge = computeEdge(aVal, bVal, lowerBetter);
  const fmtVal = (v: number | null) => (v === null ? null : fmt ? fmt(v) : String(v));
  return (
    <tr className="border-b border-border last:border-0">
      <StatCell val={aVal} edge={edge.L} display={fmtVal(aVal)} />
      <td className="text-center px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground bg-muted/30 whitespace-nowrap">
        {label}
      </td>
      <StatCell val={bVal} edge={edge.R} display={fmtVal(bVal)} />
    </tr>
  );
}

// ── Stat table wrapper ────────────────────────────────────────────────────────

function StatTable({
  heading,
  playerL,
  playerR,
  children,
}: {
  heading: string;
  playerL: string;
  playerR: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
        {heading}
      </h3>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-center px-4 py-2 text-xs font-bold text-emerald-500 bg-emerald-500/5">
                {playerL}
              </th>
              <th className="text-center px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground bg-muted/30">
                STAT
              </th>
              <th className="text-center px-4 py-2 text-xs font-bold text-amber-400 bg-amber-400/5">
                {playerR}
              </th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── tapeGetStats — derives comparable stats from playerProfile ────────────────

interface TapeStats {
  natYrs: number;
  appearances: number;
  p1: number;
  podiums: number;
  avgPl: number | null;
  avgFieldPct: number | null; // 0–100
  winPct2: number | null; // 0–100
  W2: number;
  L2: number;
  D2: number;
  decisive2: number;
  mWinPct: number | null; // 0–100
  mW: number | null;
  mL: number | null;
  mD: number | null;
  avgLsd: number | null;
  bestLsd: number | null;
  byFmt: Record<string, { winPct: number | null; W: number; L: number }>;
  handle: string;
  initials: string;
}

function tapeGetStats(profile: PlayerProfile, fullByFmt: Record<string, Set<number>>): TapeStats {
  // nat years = unique years appeared
  const natYrs = new Set(profile.placements.map((p) => p.year)).size;

  const p1 = profile.championships;
  const p2 = profile.placements.filter((p) => p.placement === 2).length;
  const p3 = profile.placements.filter((p) => p.placement === 3).length;

  // Average placement — full-data years only (matches source "Avg Finish (full data)")
  const fullPls = profile.placements
    .filter((h) => h.placement && (fullByFmt[h.format] || new Set()).has(h.year))
    .map((h) => h.placement);
  const avgPl = fullPls.length
    ? fullPls.reduce((s, v) => s + v, 0) / fullPls.length
    : null;

  // Soul differential from notes
  const lsds: number[] = [];
  for (const h of profile.placements) {
    const m = (h.notes || "").match(/(-?\d+)\s*LSD/);
    if (m) lsds.push(parseInt(m[1], 10));
  }
  const avgLsd = lsds.length ? lsds.reduce((a, b) => a + b, 0) / lsds.length : null;
  const bestLsd = lsds.length ? Math.max(...lsds) : null;

  // 2P stats from matchStatsByFmt
  const W2 = profile.tp2Wins;
  const L2 = profile.tp2Losses;
  const D2 = profile.tp2Draws;
  const decisive2 = W2 + L2;
  const winPct2 = decisive2 > 0 ? (W2 / decisive2) * 100 : null;

  // Multiplayer
  const mW = profile.hasMulti ? profile.multiWins : null;
  const mL = profile.hasMulti ? profile.multiLosses : null;
  const mD = profile.hasMulti ? profile.multiDraws : null;
  const mDecisive = profile.hasMulti ? profile.multiWins + profile.multiLosses : 0;
  const mWinPct = mDecisive > 0 ? (profile.multiWins / mDecisive) * 100 : null;

  // Per-format win %
  const byFmt: Record<string, { winPct: number | null; W: number; L: number }> = {};
  for (const [fmt, rec] of Object.entries(profile.matchStatsByFmt)) {
    const d = rec.wins + rec.losses;
    byFmt[fmt] = { winPct: d > 0 ? (rec.wins / d) * 100 : null, W: rec.wins, L: rec.losses };
  }

  return {
    natYrs,
    appearances: profile.appearances,
    p1,
    podiums: p1 + p2 + p3,
    avgPl,
    avgFieldPct: profile.avgFieldPct,
    winPct2,
    W2,
    L2,
    D2,
    decisive2,
    mWinPct,
    mW,
    mL,
    mD,
    avgLsd,
    bestLsd,
    byFmt,
    handle: profile.handle,
    initials: profile.initials,
  };
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({
  initials,
  name,
  handle,
  accentClass,
  ringClass,
}: {
  initials: string;
  name: string;
  handle: string;
  accentClass: string;
  ringClass: string;
}) {
  return (
    <div className="text-center">
      <div
        className={cn(
          "w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-2 border-2",
          ringClass
        )}
      >
        <span className={accentClass}>{initials}</span>
      </div>
      <div className={cn("font-semibold text-sm leading-tight", accentClass)}>{name}</div>
      {handle && (
        <div className="text-xs text-muted-foreground mt-0.5">@{handle}</div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TaleOfTheTapeView() {
  const seed = useSeed();

  const [playerL, setPlayerL] = useState("");
  const [playerR, setPlayerR] = useState("");

  // All unique player names from results (same as tapeAllNames in source)
  const allNames = useMemo(() => {
    const names = new Set<string>();
    for (const entries of Object.values(seed.results)) {
      for (const e of entries) {
        if (e.playerName && e.playerName.toLowerCase() !== "bye") {
          names.add(e.playerName);
        }
      }
    }
    return Array.from(names).sort();
  }, [seed]);

  const ready = !!(playerL && playerR && playerL !== playerR);

  const h2h = useMemo(
    () => (ready ? headToHead(seed, playerL, playerR) : null),
    [seed, playerL, playerR, ready]
  );

  const fullByFmt = useMemo(() => amGetFullYearsByFmt(seed), [seed]);

  const statsL = useMemo(
    () => (ready ? tapeGetStats(playerProfile(seed, playerL), fullByFmt) : null),
    [seed, playerL, ready, fullByFmt]
  );

  const statsR = useMemo(
    () => (ready ? tapeGetStats(playerProfile(seed, playerR), fullByFmt) : null),
    [seed, playerR, ready, fullByFmt]
  );

  const sharedFmts = useMemo(() => {
    if (!statsL || !statsR) return [];
    return Object.keys(statsL.byFmt)
      .filter((f) => statsR!.byFmt[f])
      .sort();
  }, [statsL, statsR]);

  const hasMulti = ready && ((statsL?.mW ?? 0) > 0 || (statsR?.mW ?? 0) > 0);
  const hasLsd = ready && ((statsL?.bestLsd ?? null) !== null || (statsR?.bestLsd ?? null) !== null);

  const h2hTotal = h2h ? h2h.wins + h2h.losses + h2h.draws : 0;

  return (
    <div>
      <SectionTitle title="Tale of the Tape" sub="Head-to-head comparison" />

      {/* Player selection */}
      <div className="flex gap-4 mb-6 items-start">
        <Typeahead
          label="Player A"
          value={playerL}
          onChange={setPlayerL}
          allNames={allNames}
          exclude={playerR}
          accentClass="text-emerald-500"
        />
        <div className="flex-none pt-7 text-muted-foreground font-bold text-lg">vs</div>
        <Typeahead
          label="Player B"
          value={playerR}
          onChange={setPlayerR}
          allNames={allNames}
          exclude={playerL}
          accentClass="text-amber-400"
        />
      </div>

      {!ready && (
        <div className="py-12 text-center text-muted-foreground text-sm">
          Select two players to compare their careers head-to-head.
        </div>
      )}

      {ready && statsL && statsR && (
        <div>
          {/* Name header */}
          <div className="grid grid-cols-3 gap-4 items-center mb-6">
            <Avatar
              initials={statsL.initials}
              name={playerL}
              handle={statsL.handle}
              accentClass="text-emerald-500"
              ringClass="border-emerald-500 bg-emerald-500/10"
            />
            <div className="text-center text-muted-foreground font-bold text-2xl">vs</div>
            <Avatar
              initials={statsR.initials}
              name={playerR}
              handle={statsR.handle}
              accentClass="text-amber-400"
              ringClass="border-amber-400 bg-amber-400/10"
            />
          </div>

          {/* Head-to-head block */}
          {h2hTotal > 0 && (
            <div className="rounded-lg border border-border bg-card px-6 py-4 text-center mb-6">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
                Head to Head
              </div>
              <div className="flex justify-center items-center gap-6">
                <div>
                  <div
                    className={cn(
                      "text-3xl font-bold",
                      h2h!.wins > h2h!.losses ? "text-emerald-500" : "text-muted-foreground"
                    )}
                  >
                    {h2h!.wins}
                  </div>
                  <div className="text-xs text-muted-foreground">{playerL.split(" ")[0]}</div>
                </div>
                {h2h!.draws > 0 && (
                  <div>
                    <div className="text-xl font-semibold text-muted-foreground">{h2h!.draws}D</div>
                  </div>
                )}
                <div>
                  <div
                    className={cn(
                      "text-3xl font-bold",
                      h2h!.losses > h2h!.wins ? "text-amber-400" : "text-muted-foreground"
                    )}
                  >
                    {h2h!.losses}
                  </div>
                  <div className="text-xs text-muted-foreground">{playerR.split(" ")[0]}</div>
                </div>
              </div>
            </div>
          )}

          {/* Core stats */}
          <StatTable heading="Core Stats" playerL={playerL} playerR={playerR}>
            <StatRow label="Nats Attended" aVal={statsL.natYrs} bVal={statsR.natYrs} />
            <StatRow label="Appearances" aVal={statsL.appearances} bVal={statsR.appearances} />
            <StatRow label="Titles" aVal={statsL.p1} bVal={statsR.p1} />
            <StatRow label="Podiums (Top 3)" aVal={statsL.podiums} bVal={statsR.podiums} />
            <StatRow
              label="Avg Finish (full data)"
              aVal={statsL.avgPl}
              bVal={statsR.avgPl}
              lowerBetter
              fmt={(v) => v.toFixed(2)}
            />
            <StatRow
              label="Field %"
              aVal={statsL.avgFieldPct}
              bVal={statsR.avgFieldPct}
              fmt={(v) => v.toFixed(1) + "%"}
            />
          </StatTable>

          {/* 2P record */}
          <StatTable heading="2-Player & Teams" playerL={playerL} playerR={playerR}>
            <StatRow
              label="2P Win %"
              aVal={statsL.winPct2}
              bVal={statsR.winPct2}
              fmt={(v) => v.toFixed(1) + "%"}
            />
            <StatRow label="2P Wins" aVal={statsL.W2} bVal={statsR.W2} />
            <StatRow label="2P Losses" aVal={statsL.L2} bVal={statsR.L2} lowerBetter />
            <StatRow label="2P Draws" aVal={statsL.D2} bVal={statsR.D2} />
            <StatRow label="2P Games" aVal={statsL.decisive2} bVal={statsR.decisive2} />
          </StatTable>

          {/* Multiplayer */}
          {hasMulti && (
            <StatTable heading="Multiplayer" playerL={playerL} playerR={playerR}>
              <StatRow
                label="Multi Win %"
                aVal={statsL.mWinPct}
                bVal={statsR.mWinPct}
                fmt={(v) => v.toFixed(1) + "%"}
              />
              <StatRow label="Multi Wins" aVal={statsL.mW} bVal={statsR.mW} />
              <StatRow label="Multi Losses" aVal={statsL.mL} bVal={statsR.mL} lowerBetter />
              <StatRow label="Multi Draws" aVal={statsL.mD} bVal={statsR.mD} />
            </StatTable>
          )}

          {/* Soul differential */}
          {hasLsd && (
            <StatTable heading="Soul Differential" playerL={playerL} playerR={playerR}>
              <StatRow
                label="Avg LSD"
                aVal={statsL.avgLsd}
                bVal={statsR.avgLsd}
                fmt={(v) => (v >= 0 ? "+" : "") + v.toFixed(1)}
              />
              <StatRow
                label="Best LSD"
                aVal={statsL.bestLsd}
                bVal={statsR.bestLsd}
                fmt={(v) => (v >= 0 ? "+" : "") + String(v)}
              />
            </StatTable>
          )}

          {/* Per-format win % */}
          {sharedFmts.length > 0 && (
            <StatTable heading="Win % by Shared Format" playerL={playerL} playerR={playerR}>
              {sharedFmts.map((fmt) => (
                <StatRow
                  key={fmt}
                  label={fmt + " Win %"}
                  aVal={statsL.byFmt[fmt]?.winPct ?? null}
                  bVal={statsR.byFmt[fmt]?.winPct ?? null}
                  fmt={(v) => v.toFixed(1) + "%"}
                />
              ))}
            </StatTable>
          )}
        </div>
      )}
    </div>
  );
}
