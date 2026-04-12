/**
 * Quick test script for the tournament listings sync pipeline.
 * Run with: npx tsx scripts/test-sync-listings.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { fetchTournamentPageText } from '../lib/listings/fetch';
import { parseListingsWithLLM } from '../lib/listings/parse';
import { validateListing } from '../lib/listings/schema';

async function main() {
  console.log('=== Step 1: Fetch page text ===');
  const text = await fetchTournamentPageText();
  console.log(`Fetched ${text.length} chars`);
  console.log('First 500 chars:\n', text.slice(0, 500));
  console.log('---');

  console.log('\n=== Step 2: Parse with LLM ===');
  const listings = await parseListingsWithLLM(text);
  console.log(`Parsed ${listings.length} listings\n`);

  for (const listing of listings) {
    const errors = validateListing(listing);
    const status = errors.length === 0 ? '✓' : '✗';
    console.log(`${status} ${listing.title} | ${listing.start_date} | confidence: ${listing.confidence}`);
    if (listing.formats.length > 0) {
      console.log(`  Formats: ${listing.formats.map(f => `${f.format}${f.entry_fee ? ` (${f.entry_fee})` : ''}`).join(', ')}`);
    }
    if (errors.length > 0) {
      console.log(`  ERRORS: ${errors.join(', ')}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total: ${listings.length}`);
  console.log(`Valid: ${listings.filter(l => validateListing(l).length === 0).length}`);
  console.log(`Invalid: ${listings.filter(l => validateListing(l).length > 0).length}`);
}

main().catch(console.error);
