import { describe, it, expect, afterEach } from 'vitest';
import { shopifyGraphQL, productSetUpsert } from './admin-write';
import type { ShopifyProductSetInput } from './productFromCard';

const INPUT: ShopifyProductSetInput = {
  title: 'Test Card (XX)', handle: 'test-card-xx', productType: 'Single',
  vendor: 'Your Turn Games', tags: ['Hero'], status: 'DRAFT',
  productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
  variants: [{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: '1.00', sku: 'XX-test' }],
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

afterEach(() => { delete process.env.SHOPIFY_WRITE_MOCK; });

describe('shopifyGraphQL', () => {
  it('POSTs query+variables with the access token header and returns data', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: any, init: any) => {
      captured = { url: String(url), init };
      return jsonResponse({ data: { ok: true }, extensions: { cost: { throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } } });
    }) as typeof fetch;
    const data = await shopifyGraphQL<{ ok: boolean }>('tok', 'query { x }', {}, fetchImpl);
    expect(data).toEqual({ ok: true });
    expect(captured!.url).toBe('https://your-turn-games.myshopify.com/admin/api/2026-07/graphql.json');
    expect((captured!.init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('tok');
  });

  it('retries on THROTTLED then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return jsonResponse({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 12, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 5, restoreRate: 50 } } } });
      return jsonResponse({ data: { ok: 1 } });
    }) as typeof fetch;
    const data = await shopifyGraphQL<{ ok: number }>('tok', 'q', {}, fetchImpl);
    expect(data).toEqual({ ok: 1 });
    expect(calls).toBe(2);
  }, 15000);

  it('retries on HTTP 429 honoring Retry-After', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return jsonResponse({}, 429, { 'Retry-After': '0.01' });
      return jsonResponse({ data: { ok: 1 } });
    }) as typeof fetch;
    await shopifyGraphQL('tok', 'q', {}, fetchImpl);
    expect(calls).toBe(2);
  });

  it('throws on non-throttle GraphQL errors', async () => {
    const fetchImpl = (async () => jsonResponse({ errors: [{ message: 'syntax error' }] })) as typeof fetch;
    await expect(shopifyGraphQL('tok', 'q', {}, fetchImpl)).rejects.toThrow(/syntax error/);
  });
});

describe('productSetUpsert', () => {
  it('parses product + variant ids and userErrors', async () => {
    const fetchImpl = (async () => jsonResponse({
      data: { productSet: { product: { id: 'gid://shopify/Product/1', handle: 'test-card-xx', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/2' }] } }, userErrors: [] } },
    })) as typeof fetch;
    const out = await productSetUpsert('tok', INPUT, undefined, fetchImpl);
    expect(out).toEqual({ productId: 'gid://shopify/Product/1', variantId: 'gid://shopify/ProductVariant/2', handle: 'test-card-xx', userErrors: [], mock: false });
  });

  it('returns userErrors without throwing', async () => {
    const fetchImpl = (async () => jsonResponse({
      data: { productSet: { product: null, userErrors: [{ field: ['input', 'title'], message: 'bad', code: 'INVALID' }] } },
    })) as typeof fetch;
    const out = await productSetUpsert('tok', INPUT, undefined, fetchImpl);
    expect(out.productId).toBeNull();
    expect(out.userErrors[0].code).toBe('INVALID');
  });

  it('mock mode fabricates ids and never calls fetch', async () => {
    process.env.SHOPIFY_WRITE_MOCK = '1';
    const fetchImpl = (async () => { throw new Error('should not fetch'); }) as typeof fetch;
    const out = await productSetUpsert('tok', INPUT, undefined, fetchImpl);
    expect(out.mock).toBe(true);
    expect(out.productId).toBe('gid://shopify/Product/mock-test-card-xx');
    expect(out.handle).toBe('test-card-xx');
  });
});
