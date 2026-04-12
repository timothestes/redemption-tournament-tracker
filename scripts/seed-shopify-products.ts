/**
 * Seed the shopify_products table from the existing ytg_products.json file.
 * Run once to bootstrap: npx tsx scripts/seed-shopify-products.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// Load env from .env.local
config({ path: join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RawProduct {
  id: string | number;
  title: string;
  handle: string;
  tags: string;
  product_type: string;
  variants: {
    price: string;
    inventory_quantity: number;
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
}

async function main() {
  const filePath = join(__dirname, 'output', 'ytg_products.json');
  console.log(`Reading ${filePath}...`);
  const raw: RawProduct[] = JSON.parse(readFileSync(filePath, 'utf-8'));
  console.log(`Loaded ${raw.length} products`);

  // Filter to singles only
  const singles = raw.filter(p => p.product_type === 'Single');
  console.log(`${singles.length} singles to upsert`);

  const rows = singles.map(p => {
    const price = Math.min(...p.variants.map(v => parseFloat(v.price)));
    const inventory = p.variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);
    return {
      id: String(p.id),
      title: p.title,
      handle: p.handle,
      tags: p.tags || null,
      product_type: p.product_type,
      price,
      inventory_quantity: inventory,
      raw_json: p,
      last_synced_at: new Date().toISOString(),
    };
  });

  // Upsert in batches
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('shopify_products')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`Batch ${i / batchSize + 1} error:`, error.message);
    } else {
      inserted += batch.length;
      console.log(`Upserted ${inserted}/${rows.length}`);
    }
  }

  console.log(`Done! Seeded ${inserted} Shopify products.`);
}

main().catch(console.error);
