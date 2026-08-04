import { describe, it, expect, vi, beforeEach } from 'vitest';

const { shopifyGraphQLMock } = vi.hoisted(() => ({ shopifyGraphQLMock: vi.fn() }));

vi.mock('./admin-write', () => ({ shopifyGraphQL: shopifyGraphQLMock }));
vi.mock('@/lib/pricing/shopify', () => ({ getShopifyAccessToken: vi.fn(async () => 'tok') }));

import { runAliasedMutations, type AliasedMutation } from './aliasBatch';

function call(n: number): AliasedMutation {
  return {
    alias: `m${n}`,
    mutation: `tagsAdd(id: "gid://shopify/Product/${n}", tags: ["X"])`,
    selection: '{ userErrors { field message } }',
  };
}

// Builds a success payload for every alias found in the submitted document.
function echoAliases(query: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const alias of query.match(/\bm\d+(?=:)/g) ?? []) data[alias] = { userErrors: [] };
  return data;
}

beforeEach(() => {
  shopifyGraphQLMock.mockReset();
});

describe('runAliasedMutations', () => {
  it('returns [] for empty input without calling Shopify', async () => {
    const out = await runAliasedMutations([]);
    expect(out).toEqual([]);
    expect(shopifyGraphQLMock).not.toHaveBeenCalled();
  });

  it('chunks calls at batchSize into separate documents, preserving order', async () => {
    shopifyGraphQLMock.mockImplementation(async (_token: string, query: string) => echoAliases(query));
    const calls = Array.from({ length: 5 }, (_, i) => call(i));

    const out = await runAliasedMutations(calls, { batchSize: 2 });

    expect(shopifyGraphQLMock).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(shopifyGraphQLMock.mock.calls[0][0]).toBe('tok');
    const firstDoc = shopifyGraphQLMock.mock.calls[0][1] as string;
    expect(firstDoc).toContain('m0: tagsAdd(id: "gid://shopify/Product/0", tags: ["X"]) { userErrors { field message } }');
    expect(firstDoc).toContain('m1: tagsAdd');
    expect(firstDoc).not.toContain('m2:');
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.alias)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('maps per-alias userErrors from each payload and returns the payload as data', async () => {
    shopifyGraphQLMock.mockResolvedValue({
      m0: { userErrors: [] },
      m1: { userErrors: [{ field: ['tags'], message: 'too many tags' }] },
    });

    const out = await runAliasedMutations([call(0), call(1)]);

    expect(out[0].userErrors).toEqual([]);
    expect(out[0].data).toEqual({ userErrors: [] });
    expect(out[1].userErrors).toEqual([{ field: ['tags'], message: 'too many tags' }]);
    expect(out[1].data).toEqual({ userErrors: [{ field: ['tags'], message: 'too many tags' }] });
  });

  it('a missing alias in the response yields data: null with no userErrors', async () => {
    shopifyGraphQLMock.mockResolvedValue({ m0: { userErrors: [] } });
    const out = await runAliasedMutations([call(0), call(1)]);
    expect(out[1]).toEqual({ alias: 'm1', data: null, userErrors: [] });
  });

  it('a rejected chunk produces synthetic userErrors for only that chunk, other chunks unaffected', async () => {
    shopifyGraphQLMock
      .mockResolvedValueOnce({ m0: { userErrors: [] }, m1: { userErrors: [] } })
      .mockRejectedValueOnce(new Error('MAX_COST_EXCEEDED'))
      .mockResolvedValueOnce({ m4: { userErrors: [] } });
    const calls = Array.from({ length: 5 }, (_, i) => call(i));

    const out = await runAliasedMutations(calls, { batchSize: 2 });

    expect(out).toHaveLength(5); // one AliasedResult per input, always
    expect(out[0].userErrors).toEqual([]);
    expect(out[1].userErrors).toEqual([]);
    expect(out[2].data).toBeNull();
    expect(out[2].userErrors).toHaveLength(1);
    expect(out[2].userErrors[0].message).toMatch(/MAX_COST_EXCEEDED/);
    expect(out[3].data).toBeNull();
    expect(out[3].userErrors[0].message).toMatch(/MAX_COST_EXCEEDED/);
    expect(out[4].userErrors).toEqual([]);
  });
});
