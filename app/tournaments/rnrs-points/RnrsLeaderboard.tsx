"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import {
  FORMAT_SHORT,
  LEVELS,
  LEVEL_CAPS,
  LEVEL_LABELS,
} from "@/lib/rnrs/config";
import { placeLabel } from "@/lib/rnrs/scoring";
import type {
  LeaderboardRow,
  LevelContribution,
} from "@/lib/rnrs/scoring";
import type { FormatKey, Level, SeasonKey } from "@/lib/rnrs/types";

export type SortKey = "total" | "name" | "region" | "home_state" | Level;

interface Props {
  rows: LeaderboardRow[];
  season: SeasonKey | "all";
  format: FormatKey | "all";
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  onPlayerClick: (name: string) => void;
}

const COL_COUNT = 10; // rank, player, region, 5 levels, total, chevron

function capTitle(c: LevelContribution): string {
  const cap = LEVEL_CAPS[c.level];
  return `${LEVEL_LABELS[c.level]}: earned ${c.raw}, capped to ${c.counted} — only the best ${cap} ${cap === 1 ? "win" : "wins"} per format count.`;
}

/** A single level's points in a leaderboard cell: counted value, plus a struck
 *  raw value + amber "cap" tag when a cap reduced it. */
function PointsCell({ c }: { c: LevelContribution }) {
  if (c.counted === 0 && c.raw === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (!c.capped) {
    return <span className="tabular-nums text-foreground">{c.counted}</span>;
  }
  const title = capTitle(c);
  return (
    <span
      className="inline-flex items-baseline justify-center gap-1 tabular-nums"
      title={title}
    >
      <span className="font-medium text-foreground">{c.counted}</span>
      <span className="text-xs text-muted-foreground line-through" aria-hidden="true">
        {c.raw}
      </span>
      <span
        className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500"
        aria-hidden="true"
      >
        cap
      </span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** One win value in the expanded breakdown, with its placement label; muted +
 *  struck when it was dropped by the cap. */
function WinChip({
  val,
  level,
  dropped,
}: {
  val: number;
  level: Level;
  dropped: boolean;
}) {
  const place = placeLabel(val, level);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
        dropped ? "bg-muted/40" : "bg-muted"
      }`}
    >
      {place && (
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          {place}
        </span>
      )}
      <span
        className={`tabular-nums ${
          dropped ? "text-muted-foreground line-through" : "text-foreground"
        }`}
      >
        {val}
      </span>
    </span>
  );
}

/** Per-level placing breakdown shown when a row is expanded. Reconciles raw vs
 *  counted so the math is explicit. */
function Breakdown({
  row,
  season,
  format,
}: {
  row: LeaderboardRow;
  season: SeasonKey | "all";
  format: FormatKey | "all";
}) {
  const showPrefix = format === "all" || season === "all";
  const blocks = LEVELS.filter((l) => row.levels[l].perFormat.length > 0);

  if (blocks.length === 0) {
    return <p className="text-xs text-muted-foreground">No scored results.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {blocks.map((level) => {
        const c = row.levels[level];
        return (
          <div
            key={level}
            className="min-w-[180px] flex-1 rounded-md border border-border bg-background/60 px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {LEVEL_LABELS[level]}
                <span className="ml-1 font-normal text-muted-foreground">
                  (best {LEVEL_CAPS[level]}/format)
                </span>
              </span>
              <span className="text-xs tabular-nums">
                {c.capped ? (
                  <>
                    <span className="font-semibold text-foreground">
                      {c.counted}
                    </span>{" "}
                    <span className="text-muted-foreground line-through">
                      {c.raw}
                    </span>{" "}
                    <span className="font-semibold uppercase text-amber-600 dark:text-amber-500">
                      cap
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Counted </span>
                    <span className="font-semibold text-foreground">
                      {c.counted}
                    </span>
                  </>
                )}
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {c.perFormat.map((pf, idx) => {
                const prefix = [
                  season === "all" ? pf.season : null,
                  format === "all" ? FORMAT_SHORT[pf.formatKey] : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center gap-1 text-xs"
                  >
                    {showPrefix && prefix && (
                      <span className="mr-0.5 text-muted-foreground">
                        {prefix}
                      </span>
                    )}
                    {pf.valsDesc.map((v, i) => (
                      <WinChip
                        key={i}
                        val={v}
                        level={level}
                        dropped={i >= pf.cap}
                      />
                    ))}
                    {pf.capped && (
                      <span className="text-amber-600 dark:text-amber-500 tabular-nums">
                        → {pf.counted}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const active = sortKey === col;
  const justify =
    align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`inline-flex w-full items-center gap-1 ${justify} ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {active ? (
        sortDir === "asc" ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
      )}
    </button>
  );
}

function rankClass(i: number): string {
  if (i === 0) return "text-amber-500";
  if (i === 1) return "text-muted-foreground";
  if (i === 2) return "text-amber-700 dark:text-amber-600";
  return "text-muted-foreground";
}

export default function RnrsLeaderboard({
  rows,
  season,
  format,
  sortKey,
  sortDir,
  onSort,
  onPlayerClick,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No players match the current filters.
      </div>
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row, i) => {
          const isOpen = expanded.has(row.name);
          return (
            <li
              key={row.name}
              className="rounded-lg border border-border bg-card"
            >
              <div className="flex items-start gap-3 p-3">
                <span
                  className={`pt-0.5 text-sm font-bold tabular-nums ${rankClass(i)}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onPlayerClick(row.name)}
                      className="truncate text-left font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {row.displayName}
                    </button>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base font-bold tabular-nums text-primary">
                        {row.total}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(row.name)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Hide breakdown" : "Show breakdown"}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[row.state, row.region].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {LEVELS.map((level) => {
                      const c = row.levels[level];
                      if (c.counted === 0 && c.raw === 0) return null;
                      return (
                        <span key={level} className="inline-flex items-center gap-1">
                          <span className="text-muted-foreground/70">
                            {LEVEL_LABELS[level]}
                          </span>
                          <PointsCell c={c} />
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-border p-3">
                  <Breakdown row={row} season={season} format={format} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-muted text-xs font-medium uppercase">
            <tr>
              <th scope="col" className="px-3 py-3 text-left text-muted-foreground">
                #
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                <SortHeader label="Player" col="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                <SortHeader label="Region" col="region" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </th>
              {LEVELS.map((level) => (
                <th key={level} scope="col" className="px-3 py-3 text-center">
                  <SortHeader
                    label={LEVEL_LABELS[level]}
                    col={level}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    align="center"
                  />
                </th>
              ))}
              <th scope="col" className="px-3 py-3 text-right">
                <SortHeader label="Total" col="total" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              </th>
              <th scope="col" className="w-8 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isOpen = expanded.has(row.name);
              return (
                <Fragment key={row.name}>
                  <tr
                    onClick={() => toggle(row.name)}
                    className={`cursor-pointer border-t border-border ${
                      isOpen ? "bg-muted/50" : "hover:bg-muted/50"
                    }`}
                  >
                    <td className={`px-3 py-3 font-bold tabular-nums ${rankClass(i)}`}>
                      {i + 1}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayerClick(row.name);
                        }}
                        className="text-left font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {row.displayName}
                      </button>
                      {row.state && (
                        <div className="text-xs text-muted-foreground">
                          {row.state}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {row.region || "—"}
                    </td>
                    {LEVELS.map((level) => (
                      <td key={level} className="px-3 py-3 text-center">
                        <PointsCell c={row.levels[level]} />
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right text-base font-bold tabular-nums text-primary">
                      {row.total}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(row.name);
                        }}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Hide breakdown" : "Show breakdown"}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-border bg-muted/30">
                      <td colSpan={COL_COUNT} className="px-3 py-3 pl-12">
                        <Breakdown row={row} season={season} format={format} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
