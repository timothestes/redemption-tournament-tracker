/**
 * Batched aliased GraphQL mutations against the Shopify Admin API.
 *
 * Chunks calls ≤batchSize per document (default 40 — the single-document
 * cost cap is 1,000 points at ~10/mutation) and sends each chunk through
 * shopifyGraphQL, inheriting its THROTTLED/429 retry behavior. Per-alias
 * userErrors are mapped back onto each call. A thrown transport or
 * MAX_COST_EXCEEDED error rejects only that chunk's calls, returned as
 * synthetic userErrors — callers ALWAYS get exactly one AliasedResult per
 * input mutation, in input order.
 *
 * Mock/dry-run (SHOPIFY_WRITE_MOCK) is deliberately NOT handled here:
 * callers (WS-1 tag sync, WS-2 SKU backfill) own what a mocked apply looks
 * like and must short-circuit before calling this.
 */

import { shopifyGraphQL } from './admin-write';
import { getShopifyAccessToken } from '@/lib/pricing/shopify';

export interface AliasedMutation {
  alias: string;              // unique per call site, e.g. "m0", "m1"
  mutation: string;           // field with args, e.g. `tagsAdd(id: "gid://...", tags: ["X"])`
  selection: string;          // e.g. `{ userErrors { field message } }`
}

export interface AliasedResult {
  alias: string;
  data: unknown | null;       // the alias's payload, null on absent
  userErrors: { field?: string[] | null; message: string }[];
}

const DEFAULT_BATCH_SIZE = 40;

export async function runAliasedMutations(
  calls: AliasedMutation[],
  opts?: { batchSize?: number },
): Promise<AliasedResult[]> {
  if (calls.length === 0) return [];

  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const token = await getShopifyAccessToken();
  const results: AliasedResult[] = [];

  for (let i = 0; i < calls.length; i += batchSize) {
    const chunk = calls.slice(i, i + batchSize);
    const document = `mutation {\n${chunk
      .map((c) => `${c.alias}: ${c.mutation} ${c.selection}`)
      .join('\n')}\n}`;

    try {
      const data = await shopifyGraphQL<Record<string, unknown>>(token, document, {});
      for (const c of chunk) {
        const payload = (data ? data[c.alias] : null) as
          | { userErrors?: { field?: string[] | null; message: string }[] }
          | null
          | undefined;
        results.push({
          alias: c.alias,
          data: payload ?? null,
          userErrors: payload && Array.isArray(payload.userErrors) ? payload.userErrors : [],
        });
      }
    } catch (err) {
      // Whole-document failure (transport error, MAX_COST_EXCEEDED, retry
      // exhaustion). Only THIS chunk's calls fail; later chunks still run.
      const message = err instanceof Error ? err.message : 'Unknown error';
      for (const c of chunk) {
        results.push({
          alias: c.alias,
          data: null,
          userErrors: [{ message: `Batch request failed: ${message}` }],
        });
      }
    }
  }

  return results;
}
