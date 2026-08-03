import type { ShopifyProductSetInput } from './productFromCard';

const ENDPOINT = 'https://your-turn-games.myshopify.com/admin/api/2026-07/graphql.json';
const MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ProductSetOutcome {
  productId: string | null;
  variantId: string | null;
  handle: string | null;
  userErrors: { field: string[] | null; message: string; code: string | null }[];
  mock: boolean;
}

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface GraphQLResponseBody {
  data?: unknown;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: ThrottleStatus } };
}

export async function shopifyGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 2;
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify GraphQL request failed (${res.status}): ${text}`);
    }

    const body = (await res.json()) as GraphQLResponseBody;

    if (body.errors && body.errors.length > 0) {
      const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        const cost = body.extensions?.cost;
        const requestedQueryCost = cost?.requestedQueryCost;
        const currentlyAvailable = cost?.throttleStatus?.currentlyAvailable;
        const restoreRate = cost?.throttleStatus?.restoreRate;
        let waitMs = 2000;
        if (
          typeof requestedQueryCost === 'number' &&
          typeof currentlyAvailable === 'number' &&
          typeof restoreRate === 'number' &&
          restoreRate > 0
        ) {
          waitMs = Math.max(1000, ((requestedQueryCost - currentlyAvailable) / restoreRate) * 1000);
        }
        await sleep(waitMs);
        continue;
      }
      throw new Error(body.errors.map((e) => e.message).join('; '));
    }

    const throttleStatus = body.extensions?.cost?.throttleStatus;
    if (throttleStatus && throttleStatus.currentlyAvailable < 100 && throttleStatus.restoreRate > 0) {
      const waitMs = ((100 - throttleStatus.currentlyAvailable) / throttleStatus.restoreRate) * 1000;
      await sleep(waitMs);
    }

    return body.data as T;
  }

  throw new Error(`Shopify GraphQL request failed after ${MAX_ATTEMPTS} attempts (rate limited)`);
}

const PRODUCT_SET_MUTATION = `
mutation productSetUpsert($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(synchronous: true, identifier: $identifier, input: $input) {
    product { id handle variants(first: 1) { nodes { id } } }
    userErrors { field message code }
  }
}
`;

interface ProductSetData {
  productSet: {
    product: { id: string; handle: string; variants: { nodes: { id: string }[] } } | null;
    userErrors: { field: string[] | null; message: string; code: string | null }[];
  };
}

export async function productSetUpsert(
  token: string,
  input: ShopifyProductSetInput,
  identifier?: { id: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProductSetOutcome> {
  if (process.env.SHOPIFY_WRITE_MOCK === '1') {
    return {
      productId: `gid://shopify/Product/mock-${input.handle}`,
      variantId: `gid://shopify/ProductVariant/mock-${input.handle}`,
      handle: input.handle,
      userErrors: [],
      mock: true,
    };
  }

  const data = await shopifyGraphQL<ProductSetData>(
    token,
    PRODUCT_SET_MUTATION,
    { input, identifier },
    fetchImpl,
  );

  const product = data.productSet.product;
  return {
    productId: product?.id ?? null,
    variantId: product?.variants.nodes[0]?.id ?? null,
    handle: product?.handle ?? null,
    userErrors: data.productSet.userErrors,
    mock: false,
  };
}
