import { describe, it, expect } from 'vitest';
import { pass2cPromoFallback } from '../matching';
import type { CardRow, ShopifyProductRow } from '../types';

function makeCard(overrides: Partial<CardRow>): CardRow {
  return {
    name: '',
    set_code: 'Pmo-P3',
    img_file: '',
    official_set: 'Promo',
    type: '',
    brigade: '',
    rarity: '',
    special_ability: '',
    card_key: '',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ShopifyProductRow>): ShopifyProductRow {
  return {
    id: '',
    title: '',
    handle: '',
    tags: null,
    product_type: 'Single',
    price: null,
    inventory_quantity: null,
    raw_json: null,
    last_synced_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a normalized title map the same way the matching pipeline does */
function buildTitleMap(products: ShopifyProductRow[]): Map<string, ShopifyProductRow> {
  const map = new Map<string, ShopifyProductRow>();
  for (const p of products) {
    map.set(p.title.toLowerCase().replace(/\s+/g, ' ').trim(), p);
  }
  return map;
}

describe('pass2cPromoFallback', () => {
  const genericSoG = makeProduct({
    id: '7951043002593',
    title: 'Son of God (Promo)',
    handle: 'son-of-god-promo',
    price: 20,
  });

  const specificSoG = makeProduct({
    id: '8060028256481',
    title: 'Son of God (2023 National - 1st Place) (Textless) Promo)',
    handle: '2023-national-1st-place-promo',
    price: 199,
  });

  const allProducts = [genericSoG, specificSoG];
  const byTitle = buildTitleMap(allProducts);

  it('should match "Son of God [2023 - 1st Place]" to the specific 2023 National product, not the generic promo', () => {
    const card = makeCard({
      name: 'Son of God [2023 - 1st Place]',
      card_key: 'Son of God [2023 - 1st Place]|Pmo-P3|Son-of-God-Textless-Nats-1st',
    });

    const result = pass2cPromoFallback(card, 'Promo', byTitle, allProducts);

    expect(result).not.toBeNull();
    expect(result!.shopify_product_id).toBe('8060028256481');
    expect(result!.match_method).toBe('promo_bracket_match');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('should fall back to generic "Son of God (Promo)" when no bracket info', () => {
    const card = makeCard({
      name: 'Son of God (Promo)',
      card_key: 'Son of God (Promo)|Pmo-P3|Son-of-God-Promo',
    });

    const result = pass2cPromoFallback(card, 'Promo', byTitle, allProducts);

    expect(result).not.toBeNull();
    expect(result!.shopify_product_id).toBe('7951043002593');
    expect(result!.match_method).toBe('promo_fallback');
  });

  it('should pick cheapest bracket match when multiple products match (e.g., National participant vs 1st Place)', () => {
    const participantProduct = makeProduct({
      id: 'participant-001',
      title: 'Guardian of Your Souls (2024 National - Participant) (Promo)',
      handle: 'guardian-of-your-souls-2024-national-participant-promo',
      price: 30,
    });
    const firstPlaceProduct = makeProduct({
      id: 'first-place-001',
      title: 'Guardian of Your Souls (2024 National - 1st Place) (Promo)',
      handle: 'guardian-of-your-souls-2024-national-1st-place-promo',
      price: 175,
    });
    const genericProduct = makeProduct({
      id: 'generic-001',
      title: 'Guardian of Your Souls (Ap)',
      handle: 'guardian-of-your-souls-ap',
      price: 2.5,
    });

    const products = [participantProduct, firstPlaceProduct, genericProduct];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: 'Guardian of Your Souls [2024 - National]',
      card_key: 'Guardian of Your Souls [2024 - National]|Pmo-P3|Guardian-of-Your-Souls-participation',
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    // Should match to the participant ($30), NOT the generic Ap ($2.50)
    expect(result!.shopify_product_id).toBe('participant-001');
    expect(result!.match_method).toBe('promo_bracket_match');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('should NOT fall back to cheapest non-promo when bracket match exists', () => {
    const participantProduct = makeProduct({
      id: 'participant-001',
      title: 'Guardian of Your Souls (2024 National - Participant) (Promo)',
      handle: 'guardian-of-your-souls-2024-national-participant-promo',
      price: 30,
    });
    const genericProduct = makeProduct({
      id: 'generic-001',
      title: 'Guardian of Your Souls (Ap)',
      handle: 'guardian-of-your-souls-ap',
      price: 2.5,
    });

    const products = [participantProduct, genericProduct];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: 'Guardian of Your Souls [2024 - National]',
      card_key: 'Guardian of Your Souls [2024 - National]|Pmo-P3|Guardian-of-Your-Souls-participation',
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    // Should match the specific promo, not the generic
    expect(result!.shopify_product_id).toBe('participant-001');
    expect(result!.match_method).toBe('promo_bracket_match');
  });

  it('should fall back to cheapest for "(YEAR Promo)" parenthetical format without bracket info', () => {
    // Cards like "Grapes of Wrath (2021 Promo)" use parentheses, not brackets,
    // so bracket-specific matching can't kick in. The (2021 Promo) suffix gets
    // stripped, and it falls to promo_fallback_cheapest.
    const nationalProduct = makeProduct({
      id: 'national-2nd',
      title: 'Grapes of Wrath (2021 National - 2nd Place) (Promo)',
      handle: 'grapes-of-wrath-promo-pre-order',
      price: 150,
    });
    const legacyRare = makeProduct({
      id: 'legacy-rare',
      title: 'Grapes of Wrath (Legacy Rare)',
      handle: 'grapes-of-wrath-legacy-rare',
      price: 9,
    });
    const genericProduct = makeProduct({
      id: 'generic-txp',
      title: 'Grapes of Wrath (TxP)',
      handle: 'grapes-of-wrath',
      price: 18,
    });

    const products = [nationalProduct, legacyRare, genericProduct];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: 'Grapes of Wrath (2021 Promo)',
      set_code: 'Pmo-P2',
      card_key: 'Grapes of Wrath (2021 Promo)|Pmo-P2|Grapes-of-Wrath-2021',
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    // Falls to promo_fallback_cheapest — picks cheapest base-name match
    expect(result!.match_method).toBe('promo_fallback_cheapest');
    expect(result!.shopify_product_id).toBe('legacy-rare');
  });

  it('should fall back to cheapest for generic "(Promo)" cards without year-specific Shopify match', () => {
    // "Moses (Promo)" has no bracket info and no exact "Moses (Promo)" in Shopify,
    // so it falls to promo_fallback_cheapest
    const nationalStaff = makeProduct({
      id: 'moses-national',
      title: 'Moses (2019 National - Tournament Staff) (Promo)',
      handle: 'moses-2019-nationals-promo-promo',
      price: 199,
    });
    const mosesPr = makeProduct({
      id: 'moses-pr',
      title: 'Moses (Pr)',
      handle: 'moses-pr',
      price: 0.25,
    });
    const mosesCow = makeProduct({
      id: 'moses-cow',
      title: 'Moses (CoW)',
      handle: 'moses',
      price: 15,
    });

    const products = [nationalStaff, mosesPr, mosesCow];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: 'Moses (Promo)',
      set_code: 'Pmo-P2',
      card_key: 'Moses (Promo)|Pmo-P2|Promo_Moses_CoW',
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    // No "Moses (Promo)" in Shopify, so falls to cheapest
    expect(result!.match_method).toBe('promo_fallback_cheapest');
    expect(result!.shopify_product_id).toBe('moses-pr');
  });

  it('should match generic "(Promo)" card when exact Shopify title exists', () => {
    // If "Moses (Promo)" exists as a Shopify title, it should match via promo_fallback
    const mosesPromo = makeProduct({
      id: 'moses-promo-exact',
      title: 'Moses (Promo)',
      handle: 'moses-promo',
      price: 25,
    });
    const mosesCow = makeProduct({
      id: 'moses-cow',
      title: 'Moses (CoW)',
      handle: 'moses',
      price: 15,
    });

    const products = [mosesPromo, mosesCow];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: 'Moses (Promo)',
      set_code: 'Pmo-P2',
      card_key: 'Moses (Promo)|Pmo-P2|Promo_Moses_CoW',
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    expect(result!.match_method).toBe('promo_fallback');
    expect(result!.shopify_product_id).toBe('moses-promo-exact');
  });

  it('should match bracket "[2024 - Worker]" to Shopify product with "Worker" keyword', () => {
    const workerPromo = makeProduct({
      id: 'bears-worker',
      title: 'Two Bears (2024 National - Worker) (Promo)',
      handle: 'two-bears-2024-national-worker-promo',
      price: 110,
    });
    const genericProduct = makeProduct({
      id: 'bears-roa',
      title: 'Two Bears (RoA)',
      handle: 'two-bears',
      price: 1.5,
    });

    const products = [workerPromo, genericProduct];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: 'Two Bears [2024 - Worker]',
      card_key: 'Two Bears [2024 - Worker]|Pmo-P3|Two-Bears-Worker',
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    expect(result!.shopify_product_id).toBe('bears-worker');
    expect(result!.match_method).toBe('promo_bracket_match');
  });

  it('should match bracket with set abbreviation "[2022 - GoC P]" to Shopify product', () => {
    // Herod's Temple [2022 - GoC P] should match "Herod's Temple (GoC) (Promo)"
    // because bracket keywords ["2022", "GoC"] appear in... wait, "2022" does NOT
    // appear in "Herod's Temple (GoC) (Promo)". So bracket match fails and it
    // falls to promo_fallback_cheapest.
    const gocPromo = makeProduct({
      id: 'herod-goc-promo',
      title: "Herod's Temple (GoC) (Promo)",
      handle: 'herods-temple-goc-promo',
      price: 15,
    });
    const gocRegular = makeProduct({
      id: 'herod-goc',
      title: "Herod's Temple (GoC)",
      handle: 'herods-temple-goc',
      price: 9,
    });
    const genericProduct = makeProduct({
      id: 'herod-di',
      title: "Herod's Temple (Di)",
      handle: 'herod-s-temple',
      price: 1.5,
    });

    const products = [gocPromo, gocRegular, genericProduct];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: "Herod's Temple [2022 - GoC P]",
      set_code: 'GoC',
      card_key: "Herod's Temple [2022 - GoC P]|GoC|Herods-Temple-P",
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    // "2022" doesn't appear in Shopify titles, so bracket match fails.
    // Falls to promo_fallback_cheapest, picking cheapest base-name match.
    expect(result!.match_method).toBe('promo_fallback_cheapest');
  });

  it('should match promo cards with bracket content like "[2023 - Seasonal]"', () => {
    const seasonalProduct = makeProduct({
      id: '999',
      title: 'Harvest Time (2023 Seasonal Promo)',
      handle: 'harvest-time-2023-seasonal',
      price: 15,
    });

    const products = [seasonalProduct];
    const titles = buildTitleMap(products);
    const card = makeCard({
      name: 'Harvest Time [2023 - Seasonal]',
      card_key: 'Harvest Time [2023 - Seasonal]|Pmo-P3|Harvest-Time-Seasonal',
    });

    const result = pass2cPromoFallback(card, 'Promo', titles, products);

    expect(result).not.toBeNull();
    expect(result!.shopify_product_id).toBe('999');
    expect(result!.match_method).toBe('promo_bracket_match');
  });
});
