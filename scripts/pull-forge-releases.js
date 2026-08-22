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

const outPath = path.join(__dirname, 'data/forge-released.json');
const SYNCED_STATUSES = ['images_done', 'live_verified', 'decks_migrated'];

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

  const { data: releases, error: relErr } = await supabase
    .from('forge_public_releases')
    .select('id, set_code, official_set, status, card_count, created_at')
    .order('created_at', { ascending: true });
  if (relErr) {
    console.error(`❌ Could not read forge_public_releases: ${relErr.message}`);
    process.exit(1);
  }

  const synced = (releases ?? []).filter((r) => SYNCED_STATUSES.includes(r.status));
  const skipped = (releases ?? []).filter((r) => !SYNCED_STATUSES.includes(r.status));
  for (const r of skipped) {
    console.log(`⏭️  skipping ${r.set_code} (${r.id}) — status '${r.status}' (images not done)`);
  }

  const rows = [];
  for (const release of synced) {
    const { data: cards, error: cardErr } = await supabase
      .from('forge_public_release_cards')
      .select('*')
      .eq('release_id', release.id)
      .order('name', { ascending: true });
    if (cardErr) {
      console.error(`❌ Could not read release ${release.id}: ${cardErr.message}`);
      process.exit(1);
    }
    for (const c of cards ?? []) {
      rows.push({
        // CardData shape (parse-carddata.js appends these verbatim) …
        name: c.name,
        set: c.set_code,
        imgFile: c.img_file,
        officialSet: c.official_set,
        type: c.type,
        brigade: c.brigade,
        strength: c.strength,
        toughness: c.toughness,
        class: c.class,
        identifier: c.identifier,
        specialAbility: c.special_ability,
        rarity: c.rarity,
        reference: c.reference,
        alignment: c.alignment,
        legality: c.legality,
        // … plus tags for absorption tracking (stripped at codegen):
        releaseId: c.release_id,
        setCode: c.set_code,
      });
    }
    console.log(`📦 ${release.set_code} — ${cards?.length ?? 0} cards (${release.status})`);
  }

  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n');
  console.log(`✅ Wrote ${path.relative(process.cwd(), outPath)} with ${rows.length} rows`);

  execFileSync('node', [path.join(__dirname, 'parse-carddata.js')], { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
