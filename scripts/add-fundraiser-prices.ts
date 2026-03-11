#!/usr/bin/env npx tsx
/**
 * Add approximate prices for Fundraiser cards based on bundle pricing.
 * These cards are sold via Cactus Game Design's fundraiser store, not YTG.
 * Prices are approximate per-card values derived from bundle prices.
 */

import { join } from 'path';
import { config } from 'dotenv';
config({ path: join(__dirname, '..', '.env.local') });

import { getSupabaseAdmin } from '../lib/pricing/supabase-admin';

// Card name → approximate per-card price (from bundle ÷ cards in bundle)
const FUNDRAISER_PRICES: Record<string, number> = {
  // ── F1 bundles ──
  // Hebrew & Greek Text Son of God (F1) $50 / 2 cards
  'Son of God [Fundraiser - Greek]': 25,
  'Son of God [Fundraiser - Hebrew]': 25,
  // Israel's Deliverance "Exodus Main Character" Alternate Art Set (F1) $20 / 2 cards
  'Moses, the Deliverer [Fundraiser]': 10,
  'Pharaoh, Ramses II [Fundraiser]': 10,
  // Israel's Deliverance "1st Samuel Main Character" Alternate Art Set (F1) $20 / 2 cards
  'David, Giant Slayer [Fundraiser]': 10,
  'Goliath, Fear Bringer [Fundraiser]': 10,
  // Alternate Border The Second Coming (F1) $25
  'The Second Coming [Fundraiser]': 25,
  // Alternate Border Three Woes (F1) $25
  'Three Woes [Fundraiser]': 25,
  // Alternate Border Shipwreck (F1) $20
  'Shipwreck [Fundraiser]': 20,
  // Foil Alternate Art "Baptism of Jesus" Son of God (F1) $50
  'Son of God [Fundraiser]': 50,
  // Foil Dominant Set (F1) $100 / 5 cards
  'Crowd\u2019s Choice [Fundraiser]': 20,
  'Harvest Time [Fundraiser]': 20,
  'Holy Grail [Fundraiser]': 20,
  'Michael, Dragon Slayer [Fundraiser]': 20,
  'Star of Bethlehem [Fundraiser]': 20,
  // Lost Soul Alternate Art Set (F1) $50 / 3 cards
  'Lost Soul "Distressed" [Zephaniah 1:17 - Fundraiser]': 17,
  'Lost Soul "Hopper" [II Chronicles 28:13 - Fundraiser]': 17,
  'Lost Soul "Wanderer" [Ezekiel 34:6 - Fundraiser]': 17,
  // Red Dragon standalone
  'Red Dragon [Fundraiser]': 20,

  // ── F2 bundles ──
  // Foil Alternate Art "Lion of Judah" Son of God (F2) $50
  'Son of God [Fundraiser Lion of Judah]': 50,
  // Foil Alternate Art Dominant Bundle (F2) $100 / 3 cards
  'Buckler [Fundraiser]': 33,
  'Burial [Fundraiser]': 33,
  'Mayhem [Fundraiser]': 33,
  // Alternate Art "Spiritual Warfare" Bundle (F2) $50 / 4 cards
  'War in Heaven [Fundraiser]': 13,
  'Gabriel, Sent by God [Fundraiser]': 13,
  'Prince of the Air [Fundraiser]': 13,
  // Alternate Art "Evil" Promo Bundle (F2) $50 / 3 cards
  'Emperor Nero [Fundraiser]': 17,
  'Haman [Fundraiser]': 17,
  'The Divining Damsel [Fundraiser]': 17,
  // Alternate Art "Good" Promo Bundle (F2) $50 / 3 cards
  "Boaz' Sandal [Fundraiser]": 17,
  'Daniel\u2019s Prayer [Fundraiser]': 17,
  'Storehouse [Fundraiser]': 17,
  // Alternate Art Lost Soul Bundle (F2) $50 / 3 cards
  'Lost Soul "Disoriented" [Deuteronomy 7:23 - Fundraiser]': 17,
  'Lost Soul "Grumbled" [Exodus 15:24 - Fundraiser]': 17,
  'Lost Soul "Shepherds" [I Samuel 25:7 - Fundraiser]': 17,
  // Meek Daniel Lost Soul Bundle (F2) $20 / 3 cards
  'Lost Soul (Daniel 9:5) [Fundraiser]': 7,
  'Lost Soul (Daniel 9:6) [Fundraiser]': 7,
  'Lost Soul (Daniel 9:7) [Fundraiser]': 7,

  // Serialized F2
  'The Second Coming [Fundraiser - Serialized]': 25,
  'Three Woes [Fundraiser - Serialized]': 25,
};

async function main() {
  const supabase = getSupabaseAdmin();

  // Get all Fund card mappings
  const { data: mappings, error } = await supabase
    .from('card_price_mappings')
    .select('card_key, card_name, set_code')
    .eq('set_code', 'Fund');

  if (error) throw error;
  console.log(`Found ${mappings?.length} Fund cards in DB`);

  const priceRows: any[] = [];
  const mappingUpdates: any[] = [];
  let matched = 0;

  for (const m of mappings || []) {
    const price = FUNDRAISER_PRICES[m.card_name];
    if (price !== undefined) {
      matched++;
      priceRows.push({
        card_key: m.card_key,
        price,
        shopify_handle: 'fundraiser',
        shopify_title: `${m.card_name} (Fundraiser ~$${price})`,
        updated_at: new Date().toISOString(),
      });
      mappingUpdates.push({
        card_key: m.card_key,
        card_name: m.card_name,
        set_code: m.set_code,
        shopify_product_id: null,
        confidence: 1.0,
        match_method: 'fundraiser_manual',
        status: 'manual' as const,
        updated_at: new Date().toISOString(),
      });
      console.log(`  ${m.card_name} → ~$${price}`);
    } else {
      console.log(`  SKIP ${m.card_name} (no price mapping)`);
    }
  }

  console.log(`\nMatched ${matched}/${mappings?.length} Fund cards`);

  if (priceRows.length > 0) {
    // Upsert card_prices
    const { error: priceError } = await supabase
      .from('card_prices')
      .upsert(priceRows, { onConflict: 'card_key' });
    if (priceError) console.error('Error upserting prices:', priceError.message);
    else console.log(`Wrote ${priceRows.length} prices to card_prices`);

    // Update mappings status to manual
    const { error: mapError } = await supabase
      .from('card_price_mappings')
      .upsert(mappingUpdates, { onConflict: 'card_key' });
    if (mapError) console.error('Error updating mappings:', mapError.message);
    else console.log(`Updated ${mappingUpdates.length} mappings to manual/fundraiser_manual`);
  }
}

main().catch(console.error);
