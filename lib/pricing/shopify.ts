/** Shopify API utilities — OAuth token exchange and product fetching */

const SHOP_NAME = 'your-turn-games';
const API_VERSION = '2024-01';
const BASE_URL = `https://${SHOP_NAME}.myshopify.com/admin/api/${API_VERSION}`;

/**
 * Exchange client credentials for a short-lived Shopify access token.
 */
export async function getShopifyAccessToken(): Promise<string> {
  const clientId = process.env.SHOPFIY_CLIENT_ID; // typo matches actual Shopify app config
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPFIY_CLIENT_ID or SHOPIFY_CLIENT_SECRET env vars');
  }

  const url = `https://${SHOP_NAME}.myshopify.com/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify auth failed: ${res.status} — ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

interface ShopifyAPIProduct {
  id: number | string;
  title: string;
  handle: string;
  tags: string;
  product_type: string;
  variants: {
    id: number | string;
    title: string;
    price: string;
    sku: string;
    inventory_quantity: number;
  }[];
}

/**
 * Fetch all products from the Shopify Admin API with pagination.
 */
export async function fetchAllShopifyProducts(
  token: string,
  productType?: string
): Promise<ShopifyAPIProduct[]> {
  const headers = { 'X-Shopify-Access-Token': token };
  const allProducts: ShopifyAPIProduct[] = [];

  let url: string | null = `${BASE_URL}/products.json?limit=250${productType ? `&product_type=${encodeURIComponent(productType)}` : ''}`;

  while (url) {
    const res = await fetch(url, { headers });

    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error: ${res.status} — ${text}`);
    }

    const data = await res.json();
    const products = data.products || [];
    allProducts.push(...products);

    // Parse Link header for pagination
    url = null;
    const linkHeader = res.headers.get('Link') || '';
    if (linkHeader.includes('rel="next"')) {
      for (const part of linkHeader.split(',')) {
        if (part.includes('rel="next"')) {
          const match = part.match(/<([^>]+)>/);
          if (match) url = match[1];
          break;
        }
      }
    }

    // Small delay to respect rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  return allProducts;
}

/**
 * Fetch specific products by ID to check real-time inventory.
 * Returns a map of product ID → variant inventory data.
 */
export async function fetchProductInventory(
  token: string,
  productIds: string[]
): Promise<Map<string, { variantId: string; inventory: number; tracked: boolean }>> {
  const result = new Map<string, { variantId: string; inventory: number; tracked: boolean }>();
  if (productIds.length === 0) return result;

  const headers = { 'X-Shopify-Access-Token': token };

  // Shopify allows up to 250 IDs per request
  const batchSize = 250;
  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    const ids = batch.join(',');
    const url = `${BASE_URL}/products.json?ids=${ids}&fields=id,variants&limit=250`;

    const res = await fetch(url, { headers });

    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      i -= batchSize; // retry this batch
      continue;
    }

    if (!res.ok) continue; // skip batch on error, fall back to cached data

    const data = await res.json();
    for (const product of data.products || []) {
      const pid = String(product.id);
      // Use first variant (default/cheapest)
      const variant = product.variants?.[0];
      if (variant) {
        result.set(pid, {
          variantId: String(variant.id),
          inventory: variant.inventory_quantity ?? 0,
          tracked: variant.inventory_management === 'shopify',
        });
      }
    }
  }

  return result;
}
