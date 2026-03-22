/** Types for the card price matching system */

export interface CardRow {
  name: string;
  set_code: string;
  img_file: string;
  official_set: string;
  type: string;
  brigade: string;
  rarity: string;
  special_ability: string;
  card_key: string; // "name|set_code|img_file"
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  tags: string;
  product_type: string;
  variants: {
    id?: string;
    price: string;
    inventory_quantity: number;
    title?: string;
    sku?: string;
  }[];
}

export interface ShopifyProductRow {
  id: string;
  title: string;
  handle: string;
  tags: string | null;
  product_type: string | null;
  price: number | null;
  inventory_quantity: number | null;
  raw_json: ShopifyProduct | null;
  last_synced_at: string;
}

export interface SetAlias {
  id: number;
  carddata_code: string;
  shopify_abbrev: string;
  notes: string | null;
}

export interface CardPriceMapping {
  id: number;
  card_key: string;
  card_name: string;
  set_code: string;
  shopify_product_id: string | null;
  confidence: number | null;
  match_method: string | null;
  status: 'auto_matched' | 'manual' | 'unmatched' | 'no_price_exists' | 'needs_review';
  claude_reasoning: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardPrice {
  card_key: string;
  price: number;
  shopify_handle: string;
  shopify_title: string;
  updated_at: string;
}

export interface MatchResult {
  card_key: string;
  card_name: string;
  set_code: string;
  shopify_product_id: string | null;
  confidence: number;
  match_method: string;
  status: CardPriceMapping['status'];
}

export interface MatchingSummary {
  total: number;
  matched: number;
  needs_review: number;
  no_price_exists: number;
  unmatched: number;
  unmatchedCards?: MatchResult[];
  noPriceCards?: MatchResult[];
}

export interface PricesResponse {
  updated_at: string;
  prices: Record<string, {
    price: number;
    shopify_handle: string;
    shopify_title: string;
  }>;
}
