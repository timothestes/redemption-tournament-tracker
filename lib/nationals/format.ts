/** Redemption Nationals History — pure format utilities (no DOM, no globals). */

// ── Format class ─────────────────────────────────────────────────────────────

/** Returns a CSS class token for a given format string. */
export function fmtClass(f: string): string {
  if (!f) return "fmt-default";
  const s = f.trim().toLowerCase();
  if (s.includes("t1") || s.includes("type 1")) return "fmt-T1";
  if (s.includes("t2") || s.includes("type 2")) return "fmt-T2";
  if (s.includes("sealed")) return "fmt-Sealed";
  if (s.includes("booster")) return "fmt-Booster";
  if (s.includes("team")) return "fmt-Teams";
  if (s.includes("type a")) return "fmt-TypeA";
  return "fmt-default";
}

// ── Placement badge class ─────────────────────────────────────────────────────

/** Returns a CSS class token for a placement number (1–3 get medal classes). */
export function placeBadgeClass(p: number): string {
  if (p === 1) return "place-1";
  if (p === 2) return "place-2";
  if (p === 3) return "place-3";
  return "place-n";
}

// ── State abbreviation ────────────────────────────────────────────────────────

/** Extracts trailing 2-letter state code from "City, ST" strings. */
export function stateAbbr(loc: string): string | null {
  if (!loc) return null;
  const m = loc.match(/,\s*([A-Z]{2})\s*$/);
  return m ? m[1] : null;
}

// ── FIPS lookup for D3 state rendering ───────────────────────────────────────

export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18",
  IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25",
  MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32",
  NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47",
  TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55",
  WY: "56",
};

// ── Array shuffle (Fisher-Yates) ──────────────────────────────────────────────

/** Returns a new shuffled copy of the array. */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Key helpers ───────────────────────────────────────────────────────────────

/**
 * Parses a result/match key into year and format.
 * Splits on the FIRST underscore so formats like "Booster_Draft" are preserved.
 */
export function parseKey(k: string): { year: number; format: string } {
  const i = k.indexOf("_");
  return { year: +k.slice(0, i), format: k.slice(i + 1) };
}

/** Builds a result/match key from year and format. */
export function buildKey(year: number, format: string): string {
  return `${year}_${format}`;
}

// ── Ordinal helper ────────────────────────────────────────────────────────────

/** Returns an ordinal string: 1 → "1st", 2 → "2nd", 3 → "3rd", else "nth". */
export function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
