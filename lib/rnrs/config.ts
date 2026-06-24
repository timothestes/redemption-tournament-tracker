import type { FormatKey, Level, SeasonKey } from "./types";

/**
 * Cloudflare Worker that proxies the published Google-Sheets CSVs (adds CORS
 * and a stable URL). Overridable via env so the data source can move later
 * without a code change; falls back to the community worker the prototype used.
 */
export const RNRS_PROXY =
  process.env.RNRS_PROXY_URL ?? "https://rnrs-proxy2.jhendrix6426.workers.dev";

/** Seasons, newest first (drives the season selector order). */
export const SEASONS: SeasonKey[] = ["2026", "2025", "2024", "2023"];

export const FORMATS: { key: FormatKey; label: string }[] = [
  { key: "type1", label: "Type 1 – 2 Player" },
  { key: "teams", label: "Type 1 Teams" },
  { key: "type2", label: "Type 2 – 2 Player" },
  { key: "closed", label: "Closed Deck" },
  { key: "draft", label: "Booster Draft" },
];

export const FORMAT_LABELS: Record<FormatKey, string> = FORMATS.reduce(
  (acc, f) => {
    acc[f.key] = f.label;
    return acc;
  },
  {} as Record<FormatKey, string>,
);

/** Short labels for tight spaces (mobile, breakdown lines). */
export const FORMAT_SHORT: Record<FormatKey, string> = {
  type1: "T1",
  teams: "T1 Teams",
  type2: "T2",
  closed: "Closed",
  draft: "Draft",
};

/** Published-sheet IDs per season per format (carried over from the RNRS
 *  community viewer). Adding a new season = add one entry here. */
export const SEASON_SHEETS: Record<SeasonKey, Record<FormatKey, string>> = {
  "2026": {
    type1: "2PACX-1vSa8W7dh2H4UNv5d5a4t6ntjeiE4hClteLSVgtoVI8j1LwsJIdR4lXvayFSt7ixZff-QcJmiF_FnIN5",
    teams: "2PACX-1vTrVjAXIfpeWwssgMU78DdbBh1GfVS9_1hPonWQh-aWRxvu_q1Cvw2UsN0Qch_gA9sHo7z0QgpPGNat",
    type2: "2PACX-1vT0t-D0-y_3G1ALKVKZbXTgjuTi2azoRayPcWNGm_9ZtQmsv6DHtRNYU-cB3c42KqhwdksaL4c63wHJ",
    closed: "2PACX-1vRQt_IEZGoYGZKUcJRphv4r3hFTg-W2KnTfVkPkxDuGBP8FFSbO4YCQRWdcoa_lkW04FGpE5UyYHXTQ",
    draft: "2PACX-1vQy6JZxBZhKpkRCj79-5WkgxvssnTBLU78HeqCDgGNqFsTuJzvzvAZfQoeQ751nQbdRFi47TO0NdQTC",
  },
  "2025": {
    type1: "2PACX-1vQRriGQenvoZoolnY4iaeRAPfwiHTE6MgDk9wPPCAs_x8PODMIbVk8gRhPHLqPDrJu0s8-N6yPB_jh1",
    teams: "2PACX-1vRKehFie-9rK5ebtlgcHB5FBLfxZdARizG7qovBZ4u7vurtu0EG0VKcIDBWwREi_IzqhXVb9ZQVusHR",
    type2: "2PACX-1vRnZA42ZzbmTJDEV-Wdemgo9vbndYEFf6txNDQQDsu4LW4LNbJ91AGP8XqBKnWGAu_qGLUjhdpd6mzo",
    closed: "2PACX-1vRF9SpZmgh2mMT3XuNaKy_R1Wuc8DSJYVezKc0-25rGvKhdvIDIhuWpQWu-er4HkoYOQmKS0VLiUpR8",
    draft: "2PACX-1vT9PSgLceT8kgx0nqG6bPqdNlp48WmhnoSPVGuVQZV1MsSvjIGjlm3WkoDyOF1R2iuPQTYwCGLYBKC6",
  },
  "2024": {
    type1: "2PACX-1vTuZEUrqq0gpk9nyZf_MZgBvos_mNxN4mDVKODvmCatDfsgE2NxD0wsDcddU_Z3emXZ-94L8CNItqi3",
    teams: "2PACX-1vTr2MxysTPY1TpKfXbC2n105OeS43Gf7ar6WKeFO83XKGrm6ocWUyje04HzqgsPD7vtWeQSrKVynMbI",
    type2: "2PACX-1vQBWIpOyIgYQ_LvfmtMrcG5Nq0CH7CZ11MlJvKvanIVfFG8z7bi93UddgYscPdyK1xwUuawWK_pCjvK",
    closed: "2PACX-1vTuks77N3DW10nh43941ZotS31fQV6RCUHBTkEZOHjkLY_SxR43Pjhrad6LVCPqBClKZ1H4qkZkKCC3",
    draft: "2PACX-1vSDfnSfRHFaPXFbwcuVb3tN8XRrEyEPhv4bE4xorcAGaw92fo4xSUDHe6Hq9yAij70kEcdS_H02CueY",
  },
  "2023": {
    type1: "2PACX-1vR9rNLdr4m7DcJ7h2RHR9XUu0HtJ19ba3QeEiDUU9Lh2JrptR05luuas0nl-VeFMUQhDlFcZfM4YNSP",
    teams: "2PACX-1vR-7zRVlyn8axlxdpFYSKdGdJ4VdZZMk8or97Oe8Q5VH-Pjr0r1B3Xob6gxsJScCw0jvvnkOnVAMzfZ",
    type2: "2PACX-1vQQuyaPvAYLBdu5QRuwMPvOiO3N39oCeJrgoBsRpfyPeJG9yuidfuQsLxxx_pwzWdbOGQrYzuUKQ1no",
    closed: "2PACX-1vRd32x7HofEct_AqijjQ_uw-edtDwO3jBr9iTeHBXR93-rj5152p4UR8md1NURw3m6-Ll4MIxXwUo8F",
    draft: "2PACX-1vRgwreIFsGpQFFgFtxGFWPrqYMmoURS4erQlOBdkCiZjsjh-n6jPY07P_aYhmTqGOqEj-73qEy61tEs",
  },
};

export const LEVELS: Level[] = [
  "local",
  "district",
  "state",
  "regional",
  "national",
];

export const LEVEL_LABELS: Record<Level, string> = {
  local: "Local",
  district: "District",
  state: "State",
  regional: "Regional",
  national: "Nationals",
};

/** Point awards by placement [1st, 2nd, 3rd] for each level. */
export const LEVEL_PTS: Record<Level, number[]> = {
  local: [2, 1],
  district: [10, 5, 2],
  state: [25, 12, 6],
  regional: [35, 17, 8],
  national: [45, 22, 11],
};

/** Max number of wins that count toward the total — applied PER FORMAT. */
export const LEVEL_CAPS: Record<Level, number> = {
  local: 5,
  district: 2,
  state: 1,
  regional: 1,
  national: 1,
};

export const REGIONS: Record<string, string[]> = {
  Northwestern: ["WA", "OR", "ID", "MT", "WY", "AK"],
  Southwestern: ["CA", "NV", "UT", "AZ", "HI"],
  "North Central": ["ND", "SD", "NE", "KS", "MN", "IA", "CO", "MO"],
  Midwest: ["WI", "MI", "IL", "IN", "OH"],
  "South Central": ["OK", "TX", "AR", "LA", "NM"],
  "East Central": ["KY", "WV", "VA", "TN", "NC"],
  Southeastern: ["FL", "SC", "GA", "AL", "MS"],
  Northeastern: [
    "ME", "VT", "NH", "MA", "RI", "CT", "NY", "NJ", "PA", "DE", "MD",
  ],
};

export const REGION_NAMES = Object.keys(REGIONS);

export const STATE_TO_REGION: Record<string, string> = Object.entries(
  REGIONS,
).reduce(
  (acc, [region, states]) => {
    for (const s of states) acc[s] = region;
    return acc;
  },
  {} as Record<string, string>,
);
