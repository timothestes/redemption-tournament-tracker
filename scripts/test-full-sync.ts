/**
 * Test the full sync pipeline including DB writes.
 * Run with: npx tsx scripts/test-full-sync.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { syncTournamentListings } from '../lib/listings/sync';

async function main() {
  console.log('Running full sync pipeline...\n');
  const result = await syncTournamentListings();
  console.log('\n=== Sync Result ===');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
