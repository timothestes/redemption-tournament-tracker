#!/usr/bin/env node

/**
 * Sync forge-released card rows from Supabase into scripts/data/forge-released.json,
 * then regenerate the card catalog (parse-carddata.js merges the overlay after the
 * upstream rows).
 *
 * Usage:
 *   node scripts/pull-forge-releases.js
 *   OR
 *   make pull-forge-releases
 *
 * Only releases with status images_done | live_verified | decks_migrated sync —
 * a 'staged' release's rows would ship catalog entries whose images 404 forever
 * (the daily blob cron can only backfill from upstream, never from the Forge).
 * Staged releases are printed and skipped.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Worktree caveat: .env.local is gitignored and does not follow `git worktree add`
 * — run from the main checkout or copy the file first.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const { createClient } = require('@supabase/supabase-js');
const { fetchOverlayRows } = require('./lib/fetch-forge-overlay');

const outPath = path.join(__dirname, 'data/forge-released.json');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      '❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. ' +
        'Run from the main checkout (worktrees do not carry .env.local).'
    );
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { rows } = await fetchOverlayRows(supabase);

  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n');
  console.log(`✅ Wrote ${path.relative(process.cwd(), outPath)} with ${rows.length} rows`);

  execFileSync('node', [path.join(__dirname, 'parse-carddata.js')], { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
