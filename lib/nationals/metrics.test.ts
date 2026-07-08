import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import { AM_MODES, AM_COLS, computeMetric, sortRows } from "./metrics";
import type { MetricFilters } from "./metrics";

const data = seed as any;

const baseFilters: MetricFilters = {
  mode: "winpct",
  formats: new Set(["All"]),
  yearFrom: 2003,
  yearTo: 2025,
  customYears: null,
  minApp: 1,
  maxApp: Infinity,
  minNats: 1,
  maxNats: Infinity,
  comparePlayer: null,
  rivalryMode: "wins",
  vspTarget: null,
};

it("every mode returns columns and array rows without throwing", () => {
  for (const m of AM_MODES) {
    const out = computeMetric(data, { ...baseFilters, mode: m.id });
    expect(Array.isArray(out.rows)).toBe(true);
    expect(out.columns.length).toBeGreaterThan(0);
  }
});

it("winpct rows have a name and numeric win pct", () => {
  const out = computeMetric(data, { ...baseFilters, mode: "winpct" });
  expect(out.rows.every((r) => typeof r.name === "string")).toBe(true);
  expect(out.rows.every((r) => typeof r.pct === "number")).toBe(true);
});

it("AM_MODES has exactly 11 entries", () => {
  expect(AM_MODES.length).toBe(11);
});

it("AM_COLS has a key for every mode id", () => {
  for (const m of AM_MODES) {
    expect(AM_COLS[m.id]).toBeDefined();
    expect(AM_COLS[m.id].length).toBeGreaterThan(0);
  }
});

it("vsp returns empty array when vspTarget is null", () => {
  const out = computeMetric(data, { ...baseFilters, mode: "vsp", vspTarget: null });
  expect(out.rows).toHaveLength(0);
});

it("placement rows have avg best worst apps", () => {
  const out = computeMetric(data, { ...baseFilters, mode: "placement" });
  if (out.rows.length > 0) {
    const r = out.rows[0];
    expect(typeof r.avg).toBe("number");
    expect(typeof r.best).toBe("number");
    expect(typeof r.worst).toBe("number");
    expect(typeof r.apps).toBe("number");
  }
});

it("percentile rows are bounded 0-100 and worst<=avg<=best", () => {
  const out = computeMetric(data, { ...baseFilters, mode: "percentile" });
  expect(out.rows.length).toBeGreaterThan(0);
  for (const r of out.rows) {
    expect(r.best).toBeGreaterThanOrEqual(r.avg);
    expect(r.avg).toBeGreaterThanOrEqual(r.worst);
    expect(r.worst).toBeGreaterThanOrEqual(0);
    expect(r.best).toBeLessThanOrEqual(100);
  }
});

it("percentile scores a Round 1 field winner at 100 and last place at 0", () => {
  // 2025_T1 2-Player: field of 64 (see selectors.test.ts). Find the
  // recorded 1st place finisher and the recorded last place finisher.
  const key = "2025_T1 2-Player";
  const results = data.results[key];
  const winner = results.find((r: any) => r.placement === 1);
  const last = [...results].sort((a: any, b: any) => b.placement - a.placement)[0];

  const out = computeMetric(data, { ...baseFilters, mode: "percentile", minApp: 1 });
  const winnerRow = out.rows.find((r) => r.name === winner.playerName);
  expect(winnerRow?.best).toBe(100);

  const lastRow = out.rows.find((r) => r.name === last.playerName);
  expect(lastRow?.worst).toBeCloseTo(
    ((64 - last.placement) / (64 - 1)) * 100,
    5
  );
});

it("podiums rows have p1 p2 p3 top3 fields", () => {
  const out = computeMetric(data, { ...baseFilters, mode: "podiums" });
  if (out.rows.length > 0) {
    const r = out.rows[0];
    expect(typeof r.p1).toBe("number");
    expect(typeof r.p2).toBe("number");
    expect(typeof r.p3).toBe("number");
    expect(typeof r.top3).toBe("number");
    expect(r.p1 + r.p2 + r.p3).toBe(r.top3);
  }
});

it("row counts are finite for all modes", () => {
  for (const m of AM_MODES) {
    const out = computeMetric(data, { ...baseFilters, mode: m.id });
    expect(isFinite(out.rows.length)).toBe(true);
  }
});

it("sortRows orders by a numeric column", () => {
  const rows = [
    { name: "A", pct: 0.8 },
    { name: "B", pct: 0.5 },
    { name: "C", pct: 0.9 },
  ];
  const cols = AM_COLS["winpct"];
  const asc = sortRows(rows, cols, "pct", true);
  expect(asc[0].pct).toBe(0.5);
  const desc = sortRows(rows, cols, "pct", false);
  expect(desc[0].pct).toBe(0.9);
});

it("rivalry wins mode returns opponent field", () => {
  const out = computeMetric(data, { ...baseFilters, mode: "rivalry", rivalryMode: "wins" });
  if (out.rows.length > 0) {
    expect(typeof out.rows[0].opponent).toBe("string");
    expect(typeof out.rows[0].W).toBe("number");
  }
});
