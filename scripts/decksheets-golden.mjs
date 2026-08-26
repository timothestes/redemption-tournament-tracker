#!/usr/bin/env node
/**
 * Golden-output battery: POSTs identical request bodies to the local
 * Next.js /api/v1/* routes and the live Flask API (redemption-tournament-api),
 * downloads the resulting PDF/WebP artifacts side by side into OUT_DIR, and
 * diffs the JSON count payloads (AoD/M) against the spec tolerances.
 *
 * See docs/superpowers/specs/2026-08-23-api-fold-in-and-zero-pr-releases-design.md
 * §6 (Verification) for the battery this implements and the tolerances used.
 *
 * Usage:
 *   npm run dev   # in one terminal
 *   node scripts/decksheets-golden.mjs
 *
 * Env:
 *   FLASK_BASE   - overrides the Flask API base URL entirely. If unset, falls
 *                  back to $NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT, then to the
 *                  same-named key in .env.local, then to the deployed Flask
 *                  API as a last resort.
 *
 *                  NOTE: as of 2026-08, .env.local's *active*
 *                  NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT line points at
 *                  http://127.0.0.1:5000, which on macOS is squatted by
 *                  ControlCenter (AirPlay receiver), NOT a local Flask
 *                  server -- it answers every request with 403. Unless you
 *                  are actually running the Flask app locally on :5000, set
 *                  FLASK_BASE explicitly, e.g.:
 *                    FLASK_BASE=https://redemption-tournament-api.vercel.app \
 *                      node scripts/decksheets-golden.mjs
 *   LOCAL_BASE   - defaults to http://localhost:3000 (the `npm run dev` port).
 *   OUT_DIR      - defaults to <os tmpdir>/decksheets-golden.
 */
import fs from "fs";
import path from "path";
import os from "os";

function readEnvLocal(key) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  } catch { /* no .env.local -- fall through */ }
  return undefined;
}

const FLASK_BASE = (
  process.env.FLASK_BASE ||
  process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT ||
  readEnvLocal("NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT") ||
  "https://redemption-tournament-api.vercel.app"
).replace(/\/$/, "");
const LOCAL_BASE = (process.env.LOCAL_BASE || "http://localhost:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), "decksheets-golden");
const FIXTURES_DIR = path.join(process.cwd(), "lib/decksheets/__tests__/fixtures/decks");

fs.mkdirSync(OUT_DIR, { recursive: true });

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

/** Joins [qty, name] pairs into "qty\tname" lines (avoids hand-typed tabs). */
function lines(entries) {
  return entries.map(([qty, name]) => `${qty}\t${name}`).join("\n");
}

// ---------------------------------------------------------------------------
// Battery decks. Reuses the committed fixtures in lib/decksheets/__tests__/
// fixtures/decks/ wherever possible; anything the committed fixtures don't
// cover (a reserve-carrying T1 deck, a second overflowing T2 section, Lost
// Soul nicknames) is appended here from real, catalog-verified card names --
// the committed battery decks themselves are never modified, since
// counts.json's Monte Carlo baselines are pinned to their exact contents.
// ---------------------------------------------------------------------------

// (a) T1 with a reserve. t1_multi_brigade.txt intentionally has no reserve
// section (it's also the counts.json parity fixture), so the reserve is
// appended here.
const CASE_A_RESERVE = lines([
  [1, "Ahimelech, Chief Priest"],
  [1, "Ahimelech, Priest at Nob"],
  [1, "Ahimelek the Hittite"],
  [1, "Ahitub, the High Priest"],
  [1, "Amariah the High Priest"],
  [1, "Amariah, the High Priest (Roots)"],
  [1, "Amasai the Raider"],
  [1, "Amminadab, the Generous / Amminadab, the Gracious (LoC)"], // exercises cleanCardName's "/" branch
]);
const CASE_A_DECKLIST = `${readFixture("t1_multi_brigade.txt")}\nReserve:\n${CASE_A_RESERVE}\n`;

// (b) T2 overflowing >=2 sections: t2_overflow.txt already overflows Misc
// (8 unique vs T2's limit of 6); the padding below adds a second overflowing
// section (15 unique Artifact/Covenant/Curse-type cards vs T2's combined
// limit of 13) plus filler across Dominant/Hero/GE/Evil Character/EE/Lost
// Soul/Fortress so the deck clears the 40-card strict-mode floor. A 12-card
// reserve exercises the Reserve box; true reserve *overflow* (>20 printed
// lines) is unreachable through either backend's own enforceLimits gate (T2
// reserve is hard-capped at 20 in both strict and bypass mode, and the v2
// template's Reserve box has exactly 20 lines) -- see task-12-report.md.
const CASE_B_PADDING = lines([
  [1, "A New Beginning (FoM)"], [1, "Angel of God [2023 - National]"],
  [2, "Aaron (Di)"], [2, "Aaron (G)"], [2, "Aaron (Pa)"], [2, "Aaron (Pi)"],
  [2, "Aaron, God's Mediator"], [2, "Aaron, Moses' Brother (1st Print - L)"],
  [2, "Aaron, Moses' Brother [L]"], [2, "Aaron, Peacemaker"], [2, "Abdon"],
  [2, "Abed-nego (Azariah) (PoC)"],
  [2, "A Child is Born"], [2, "A Mighty Blow"], [2, "A New Beginning"],
  [2, 'Lost Soul "6/*" [Deuteronomy 32:15]'],
  [2, 'Lost Soul "Accusers" [Ezra 4:6]'],
  [2, 'Lost Soul "Aimless" [Exodus 14:3]'],
  [2, 'Lost Soul "Awake" [Ephesians 5:14 - TPC]'],
  [2, 'Lost Soul "Behold" [I Samuel 30:3 - L]'],
  [2, "Abaddon the Destroyer (L)"], [2, "Abaddon the Destroyer (UL)"],
  [2, "Abaddon, the Destroyer (RoJ AB)"], [2, "Abaddon, the Destroyer (RoJ)"],
  [2, "Abihu ( C)"], [2, "Abihu (L)"], [2, "Abihu (Pi)"], [2, "Abihu (UL)"],
  [2, "Abihu, the Disobedient"], [2, "Abijah, son of Samuel"],
  [2, "A Look Back"], [2, "Aaron and Miriam's Dissent"], [2, "Abandonment (EC)"],
  // Artifact section (combined w/ Covenant + Curse, T2 limit 13) -- 15 uniques => overflow by 2
  [1, "Aaron's Staff (CoW AB)"], [1, "Aaron's Staff (CoW)"], [1, "Altar of Ahaz"],
  [1, "Altar of Burnt Offering"], [1, "Altar of Burnt Offering (1st Print - L)"],
  [1, "Altar of Burnt Offering [L]"], [1, "Altar of Dagon"], [1, "Altar of Dagon (FoM)"],
  [1, "Altar of Incense (E)"], [1, "Altar of Incense (Pi)"],
  [1, "Ark of the Covenant (Ki)"], [1, "Ark of the Covenant (RoJ AB)"],
  [1, "Ark of the Covenant (RoJ)"], [1, "Ark of the Covenant (Wa)"],
  [1, "Ark of the Covenant [2024 - Winner]"],
  [1, "Alexandrian Ship"], [1, "Areopagus"], [1, "Assyrian Camp"],
]);
const CASE_B_RESERVE = lines([
  [1, "Abraham (CoW AB)"], [1, "Abraham (CoW)"], [1, "Abram, the Blameless (Roots)"],
  [1, "Abram's Army"], [1, "Abram/Abraham"], [1, "Achaicus"],
  [1, "Achim, the Compiler / Achim, the Talmid (LoC)"], [1, "Adam"],
  [1, "Adam (FoM)"], [1, "Adam, the Exile / Adam (Man) (LoC)"],
  [1, "Adino (Ki)"], [1, "Adino (L)"],
]);
const CASE_B_DECKLIST = `${CASE_B_PADDING}\n${readFixture("t2_overflow.txt")}\nReserve:\n${CASE_B_RESERVE}\n`;

// (c) Lost Soul nicknames: exercises clean_card_name's quoted-nickname +
// bracketed-verse path (`Lost Soul "Nickname" [Reference]` -> "Nickname
// [Reference]") on the deck-check sheet.
const CASE_C_DECKLIST = lines([
  [2, "Angel at Shur (Promo)"], [2, "Angel at Shur (Roots)"], [2, "Angel at Shur (Wa)"],
  [2, "Angel at the Tomb (Pi)"], [2, "Angel at the Tomb (Wa)"],
  [2, "Angel from the Altar (RoJ AB)"], [2, "Angel from the Altar (RoJ)"],
  [2, "Angel from the Sun (RoJ AB)"], [2, "Angel from the Sun (RoJ)"],
  [2, "Angel in the Path (Pi)"], [2, "Angel in the Path (Roots)"], [2, "Angel in the Path (Wa)"],
  [2, "Assyrian Forces (LoC)"], [2, "Assyrian Invaders"], [2, "Assyrian Laborers"],
  [2, "Assyrian Officer (LoC)"], [2, "Assyrian Siege Army"], [2, "Assyrian Siege Army (Roots)"],
  [2, "Assyrian Survivor"], [2, "Assyrian Survivor (Roots)"],
  [1, "Abraham's Servant to Ur (LoC)"], [1, "Acts of Uzziah"],
  [1, "Adino's Spear (Ki)"], [1, "Adino's Spear (Wa)"], [1, "Alabaster Jar"],
  [1, 'Lost Soul "Accusers" [Ezra 4:6]'], [1, 'Lost Soul "Aimless" [Exodus 14:3]'],
  [1, 'Lost Soul "Awake" [Ephesians 5:14 - TPC]'], [1, 'Lost Soul "Behold" [I Samuel 30:3 - L]'],
  [1, 'Lost Soul "Blind" [Job 29:15]'], [1, 'Lost Soul "Chaff" [Psalm 1:4 - RR2]'],
  [1, 'Lost Soul "Fool" [Ecclesiastes 10:3 - RoA]'], [1, 'Lost Soul "Wanderer" [Ezekiel 34:6 - RR]'],
  [1, 'Lost Soul "Humble" [James 4:6 / Proverbs 3:34 - RoJ]'],
]);

// (d) t1_multi_brigade.txt plus one name that resolves on neither backend --
// both must silently skip the line (console warning only), not error.
const CASE_D_DECKLIST = `${readFixture("t1_multi_brigade.txt")}\n1\tNot A Real Card (XYZ)\n`;

// (e) tiny_8.txt on aod-count: the <9-card all-zero path.
const CASE_E_DECKLIST = readFixture("tiny_8.txt");

const CASES = [
  {
    name: "a-t1-reserve-legal",
    endpoint: "generate-decklist",
    ext: "pdf",
    body: {
      decklist: CASE_A_DECKLIST, decklist_type: "type_1", name: "Golden Case A",
      event: "Golden Battery", show_alignment: true, m_count: true, aod_count: true, is_legal: true,
    },
  },
  {
    name: "a-t1-reserve-legal",
    endpoint: "generate-decklist-image",
    ext: "webp",
    body: {
      decklist: CASE_A_DECKLIST, decklist_type: "type_1", n_card_columns: 10,
      m_count: true, aod_count: true, is_legal: true,
    },
  },
  {
    name: "b-t2-overflow-illegal",
    endpoint: "generate-decklist",
    ext: "pdf",
    body: {
      decklist: CASE_B_DECKLIST, decklist_type: "type_2", name: "", event: "",
      show_alignment: false, m_count: false, aod_count: false, is_legal: false,
    },
  },
  {
    name: "b-t2-overflow-illegal",
    endpoint: "generate-decklist-image",
    ext: "webp",
    body: {
      decklist: CASE_B_DECKLIST, decklist_type: "type_2", n_card_columns: 10,
      m_count: false, aod_count: false, is_legal: false,
    },
  },
  {
    name: "c-lost-soul-nicknames",
    endpoint: "generate-decklist",
    ext: "pdf",
    body: {
      decklist: CASE_C_DECKLIST, decklist_type: "type_1", name: "Golden Case C",
      event: "Nicknames", show_alignment: false, m_count: false, aod_count: false, is_legal: null,
    },
  },
  {
    name: "d-unresolvable-name",
    endpoint: "generate-decklist",
    ext: "pdf",
    body: {
      decklist: CASE_D_DECKLIST, decklist_type: "type_1", name: "Golden Case D",
      event: "Unresolvable", show_alignment: false, m_count: false, aod_count: false, is_legal: null,
    },
  },
  {
    name: "d-unresolvable-name",
    endpoint: "aod-count",
    ext: "json",
    body: { decklist: CASE_D_DECKLIST, decklist_type: "type_1", include_breakdown: true },
  },
  {
    name: "e-tiny-8",
    endpoint: "aod-count",
    ext: "json",
    body: { decklist: CASE_E_DECKLIST, decklist_type: "type_1", include_breakdown: true },
  },
];

async function postJson(base, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response */ }
  return { status: res.status, json, text };
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

const AOD_TOLERANCE = 0.15; // spec §6: +/-0.15 for m/aod/soul counts
const WHIFF_TOLERANCE_PP = 2; // spec §6: +/-2 percentage points for whiff

function compareBreakdown(ts, py) {
  const rows = [];
  for (const key of ["aod_count", "soul_aod_count"]) {
    if (ts?.[key] === undefined || py?.[key] === undefined) continue;
    const diff = Math.abs(ts[key] - py[key]);
    rows.push({ key, ts: ts[key], py: py[key], diff, tolerance: AOD_TOLERANCE, ok: diff <= AOD_TOLERANCE });
  }
  if (ts?.whiff_percentage !== undefined && py?.whiff_percentage !== undefined) {
    const diff = Math.abs(ts.whiff_percentage - py.whiff_percentage);
    rows.push({
      key: "whiff_percentage", ts: ts.whiff_percentage, py: py.whiff_percentage,
      diff, tolerance: WHIFF_TOLERANCE_PP, ok: diff <= WHIFF_TOLERANCE_PP,
    });
  }
  return rows;
}

async function runCase(c) {
  console.log(`\n=== ${c.name} :: POST /${c.endpoint} ===`);
  const [tsRes, pyRes] = await Promise.all([
    postJson(LOCAL_BASE, `/api/v1/${c.endpoint}`, c.body),
    postJson(FLASK_BASE, `/v1/${c.endpoint}`, c.body),
  ]);

  console.log(`  local (TS): HTTP ${tsRes.status} ${tsRes.json?.message ?? tsRes.text.slice(0, 200)}`);
  console.log(`  flask (Py): HTTP ${pyRes.status} ${pyRes.json?.message ?? pyRes.text.slice(0, 200)}`);

  if (c.ext === "json") {
    const rows = compareBreakdown(tsRes.json?.data, pyRes.json?.data);
    if (rows.length === 0) {
      console.log("  WARNING: no comparable fields in either response", tsRes.json, pyRes.json);
    }
    for (const r of rows) {
      console.log(
        `  ${r.key.padEnd(18)} ts=${r.ts}  py=${r.py}  diff=${r.diff.toFixed(3)}  ` +
        `(tolerance ${r.tolerance})  ${r.ok ? "OK" : "FAIL"}`
      );
    }
    return;
  }

  if (tsRes.status >= 300 || !tsRes.json?.data?.downloadUrl) {
    console.log("  TS side did not return a downloadUrl -- skipping download:", tsRes.json ?? tsRes.text);
  } else {
    const dest = path.join(OUT_DIR, `${c.name}-ts.${c.ext}`);
    const size = await download(tsRes.json.data.downloadUrl, dest);
    console.log(`  downloaded TS artifact -> ${dest} (${size} bytes)`);
  }
  if (pyRes.status >= 300 || !pyRes.json?.data?.downloadUrl) {
    console.log("  PY side did not return a downloadUrl -- skipping download:", pyRes.json ?? pyRes.text);
  } else {
    const dest = path.join(OUT_DIR, `${c.name}-py.${c.ext}`);
    const size = await download(pyRes.json.data.downloadUrl, dest);
    console.log(`  downloaded PY artifact -> ${dest} (${size} bytes)`);
  }
}

console.log(`FLASK_BASE = ${FLASK_BASE}`);
console.log(`LOCAL_BASE = ${LOCAL_BASE}`);
console.log(`OUT_DIR    = ${OUT_DIR}`);

for (const c of CASES) {
  await runCase(c);
}

console.log(`\nDone. Artifacts in ${OUT_DIR}`);
