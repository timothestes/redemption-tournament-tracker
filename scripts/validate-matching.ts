#!/usr/bin/env npx tsx
/**
 * A/B validation for the ability-text signal (spec §Matching tab).
 * Runs the pipeline dry-run twice — signal OFF, then ON — and prints
 * per-method counts plus a sample of card_keys whose outcome changed.
 * No thresholds ship without this report in the PR body.
 *
 * Usage: npx tsx scripts/validate-matching.ts
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env.local') });

type Result = { card_key: string; shopify_product_id: string | null; match_method: string; status: string; confidence: number };

function countBy(results: Result[], key: 'match_method' | 'status'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) out[r[key]] = (out[r[key]] ?? 0) + 1;
  return out;
}

function printCounts(label: string, counts: Record<string, number>) {
  console.log(`\n${label}`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(6)}`);
  }
}

async function main() {
  // Deferred import so dotenv runs before supabase-admin reads env
  const { runMatchingPipeline } = await import('../lib/pricing/matching');
  const { getSupabaseAdmin } = await import('../lib/pricing/supabase-admin');

  console.log('=== Run 1: ability-text signal DISABLED ===');
  const before = await runMatchingPipeline({ dryRun: true, abilityText: false });
  console.log('=== Run 2: ability-text signal ENABLED ===');
  const after = await runMatchingPipeline({ dryRun: true, abilityText: true });

  const beforeResults = (before.results ?? []) as Result[];
  const afterResults = (after.results ?? []) as Result[];

  printCounts('Per-method counts (signal OFF):', countBy(beforeResults, 'match_method'));
  printCounts('Per-method counts (signal ON): ', countBy(afterResults, 'match_method'));
  printCounts('Status counts (signal OFF):', countBy(beforeResults, 'status'));
  printCounts('Status counts (signal ON): ', countBy(afterResults, 'status'));

  const beforeByKey = new Map(beforeResults.map(r => [r.card_key, r]));
  const changed = afterResults.filter(r => {
    const b = beforeByKey.get(r.card_key);
    return b && (b.shopify_product_id !== r.shopify_product_id || b.status !== r.status || b.match_method !== r.match_method);
  });
  console.log(`\nChanged outcomes: ${changed.length}`);
  for (const r of changed.slice(0, 40)) {
    const b = beforeByKey.get(r.card_key)!;
    console.log(`  ${r.card_key}`);
    console.log(`    OFF: ${b.match_method}/${b.status} → ${b.shopify_product_id}  (${b.confidence})`);
    console.log(`    ON : ${r.match_method}/${r.status} → ${r.shopify_product_id}  (${r.confidence})`);
  }
  if (changed.length > 40) console.log(`  ... and ${changed.length - 40} more`);

  // Offline spot-check: every changed match should point at a product whose
  // handle exists in the store export (cheap sanity, skipped if CSV absent).
  const csvPath = join(__dirname, '..', 'tmp', 'products_export_1.csv');
  if (existsSync(csvPath) && changed.length > 0) {
    const handles = new Set(
      readFileSync(csvPath, 'utf-8').split('\n').slice(1)
        .map(line => line.split(',')[0]?.replace(/^"|"$/g, '').trim()).filter(Boolean)
    );
    const supabase = getSupabaseAdmin();
    const ids = changed.map(r => r.shopify_product_id).filter(Boolean).slice(0, 200);
    const { data } = await supabase.from('shopify_products').select('id, handle').in('id', ids);
    const handleById = new Map((data ?? []).map((p: any) => [p.id, p.handle]));
    let inCsv = 0, missing = 0;
    for (const r of changed.slice(0, 200)) {
      if (!r.shopify_product_id) continue;
      if (handles.has(handleById.get(r.shopify_product_id) ?? '')) inCsv++; else missing++;
    }
    console.log(`\nCSV spot-check (first 200 changed): ${inCsv} handles present in export, ${missing} not (new since export — expected small)`);
  }

  console.log('\nSummary deltas: matched %+d, needs_review %+d, unmatched %+d'
    .replace('%+d', fmt(after.matched - before.matched))
    .replace('%+d', fmt(after.needs_review - before.needs_review))
    .replace('%+d', fmt(after.unmatched - before.unmatched)));
  function fmt(n: number) { return (n >= 0 ? '+' : '') + n; }
}

main().catch(err => { console.error(err); process.exit(1); });
