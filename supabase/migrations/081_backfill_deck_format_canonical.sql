-- Deploy runbook (apply AFTER code conversion in Tasks 1-8):
-- 1. Merge Tasks 1-8 and deploy to Vercel
-- 2. Apply this migration via Supabase MCP
-- 3. Run: npx tsx scripts/backfill-deck-legality.ts --all
--    (--all flag re-checks all decks to refresh is_legal/deckcheck_issues
--     which contain rule IDs that may have been retired in format transitions)

-- Canonicalize decks.format (spec §7). MUST deploy AFTER all code conversion
-- (canonical 'T2' does not match legacy .includes('type 2') checks).
-- NULL rows are intentionally left NULL: read-time normalizeFormat buckets
-- them as Limited; they may predate format selection entirely.
update decks set format = 'Limited'   where format in ('Type 1', 'T1');
update decks set format = 'T2'        where format = 'Type 2';
update decks set format = 'Unlimited' where format = 'Classic';
update decks set format = 'Paragon'   where format ilike '%paragon%' and format <> 'Paragon';
