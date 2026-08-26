#!/usr/bin/env node

/**
 * Build-time catalog fetch (spec §5, zero-PR releases).
 *
 * Gate order:
 *   1. CATALOG_PREBUILD=0 → skip entirely (kill switch, the only supported
 *      fallback path). Committed scripts/data/forge-released.json is used.
 *   2. VERCEL set, or CATALOG_PREBUILD=1 → fetch: Supabase env must be
 *      present (missing/empty is exit 1, never a silent fallback), the
 *      overlay is re-fetched, and the monotonicity guard must pass before
 *      the overlay is written and the catalog regenerated.
 *   3. Anywhere else (local dev, worktrees, CI) → no-op, zero behavior
 *      change from the committed snapshot.
 *
 * Wired explicitly into the build command ("build": "node scripts/prebuild-catalog.js
 * && next build") rather than an npm `prebuild` lifecycle hook — pre-hooks
 * silently vanish under a Vercel Build Command override or a pnpm migration,
 * and silent is exactly what this step must never be.
 *
 * Usage:
 *   node scripts/prebuild-catalog.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const overlayPath = path.join(__dirname, 'data/forge-released.json');

function decideMode(env) {
  if (env.CATALOG_PREBUILD === '0') return 'skip';
  if (env.VERCEL || env.CATALOG_PREBUILD === '1') return 'fetch';
  return 'noop';
}

function missingReleasedKeys(committedRows, fetchedRows) {
  const fetchedKeys = new Set(fetchedRows.map((r) => `${r.name}|${r.set}`));
  return committedRows
    .map((r) => `${r.name}|${r.set}`)
    .filter((key) => !fetchedKeys.has(key));
}

async function main() {
  const mode = decideMode(process.env);

  if (
    process.env.CATALOG_PREBUILD !== undefined &&
    process.env.CATALOG_PREBUILD !== '0' &&
    process.env.CATALOG_PREBUILD !== '1'
  ) {
    console.warn(
      `⚠️  prebuild-catalog: CATALOG_PREBUILD=${JSON.stringify(process.env.CATALOG_PREBUILD)} is not "0" or "1" — ignoring it`
    );
  }

  if (mode === 'skip' || mode === 'noop') {
    console.log(`⏭️  prebuild-catalog: ${mode} — using committed scripts/data/forge-released.json`);
    process.exit(0);
  }

  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      '❌ prebuild-catalog: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — ' +
        'refusing to silently fall back to the committed snapshot (spec §5.2).'
    );
    process.exit(1);
  }

  const { createClient } = require('@supabase/supabase-js');
  const { fetchOverlayRows } = require('./lib/fetch-forge-overlay');
  const supabase = createClient(url, key);

  const { rows } = await fetchOverlayRows(supabase);

  const committedRows = JSON.parse(fs.readFileSync(overlayPath, 'utf-8'));
  const missing = missingReleasedKeys(committedRows, rows);
  if (missing.length > 0) {
    console.error(
      `❌ prebuild-catalog: monotonicity guard failed — fetched overlay is missing already-released ` +
        `card(s) present in the committed snapshot: ${missing.join(', ')}`
    );
    console.error(
      'If a release was intentionally aborted, refresh the committed snapshot (make pull-forge-releases ' +
        '+ commit) or set CATALOG_PREBUILD=0 to deploy the committed catalog.'
    );
    process.exit(1);
  }

  fs.writeFileSync(overlayPath, JSON.stringify(rows, null, 2) + '\n');
  console.log(`✅ prebuild-catalog: wrote ${path.relative(process.cwd(), overlayPath)} with ${rows.length} rows`);

  execFileSync('node', [path.join(__dirname, 'parse-carddata.js')], { stdio: 'inherit' });
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`❌ prebuild-catalog: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { decideMode, missingReleasedKeys };
