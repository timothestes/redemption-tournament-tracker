#!/usr/bin/env node

/**
 * Sync catalog admin edits from Supabase into scripts/data/card-overrides.json,
 * then regenerate the card catalog (parse-carddata.js applies the overrides
 * LAST, winning over upstream and forge-released rows).
 *
 * Covers all three catalog tables: card_overrides, card_aliases and
 * card_image_versions. Every one of them is rewritten wholesale, so a table
 * this script forgets is a table the next pull silently deletes from the
 * overlay.
 *
 * Usage:
 *   node scripts/pull-card-overrides.js
 *   OR
 *   make pull-card-overrides
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

const outPath = path.join(__dirname, 'data/card-overrides.json');
// Far above any plausible curated alias count; see the read below.
const ALIAS_CEILING = 5000;

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

  const { data: overrideRows, error: ovErr } = await supabase
    .from('card_overrides')
    .select('card_name, set_code, fields, note')
    .order('card_name', { ascending: true });
  if (ovErr) {
    console.error(`❌ Could not read card_overrides: ${ovErr.message}`);
    process.exit(1);
  }

  const { data: aliasRows, error: aliasErr } = await supabase
    .from('card_aliases')
    .select('alias, card_name, set_code')
    .order('alias', { ascending: true })
    // PostgREST caps an unbounded select at 1000 rows with no error and no
    // count. This overlay is rewritten wholesale, so a silent truncation would
    // DELETE every alias past the cap on the next deploy. Ask for one more than
    // the ceiling and refuse to write rather than guess.
    .range(0, ALIAS_CEILING);
  if (aliasErr) {
    console.error(`❌ Could not read card_aliases: ${aliasErr.message}`);
    process.exit(1);
  }
  if ((aliasRows ?? []).length > ALIAS_CEILING) {
    console.error(
      `❌ card_aliases has more than ${ALIAS_CEILING} rows — this script would silently drop the rest. ` +
        `Paginate the read before pulling again.`
    );
    process.exit(1);
  }

  const { data: imageRows, error: imgErr } = await supabase
    .from('card_image_versions')
    .select('img_file, version')
    .order('img_file', { ascending: true });
  if (imgErr) {
    console.error(`❌ Could not read card_image_versions: ${imgErr.message}`);
    process.exit(1);
  }

  const overrides = (overrideRows ?? [])
    .map((r) => ({ name: r.card_name, set: r.set_code, fields: r.fields ?? {}, note: r.note ?? '' }))
    .sort((a, b) => `${a.name}|${a.set}`.localeCompare(`${b.name}|${b.set}`));

  const aliases = (aliasRows ?? [])
    .map((r) => ({ alias: r.alias, name: r.card_name, set: r.set_code }))
    .sort((a, b) => a.alias.localeCompare(b.alias));

  const imageVersions = {};
  for (const r of imageRows ?? []) imageVersions[r.img_file] = r.version;

  fs.writeFileSync(outPath, JSON.stringify({ overrides, aliases, imageVersions }, null, 2) + '\n');
  console.log(
    `✅ Wrote ${path.relative(process.cwd(), outPath)} — ${overrides.length} override(s), ` +
      `${aliases.length} alias(es), ${Object.keys(imageVersions).length} image version(s)`
  );

  execFileSync('node', [path.join(__dirname, 'parse-carddata.js')], { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
