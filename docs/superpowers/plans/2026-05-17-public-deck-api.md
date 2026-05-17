# Public Deck API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-05-17-public-deck-api-design.md`](../specs/2026-05-17-public-deck-api-design.md)

**Goal:** Ship a v1 read-only public HTTP API at `/api/v1/decks` exposing community deck data, gated by user-generated API keys, rate-limited via Upstash, cached via `unstable_cache` + Vercel edge CDN.

**Architecture:** Next.js 15 App Router Route Handlers backed by the **anon** Supabase client (existing RLS enforces `is_public = true`). New `lib/api/` module hosts auth, rate-limit, cache, error, and CORS helpers — all consumed by the two route handlers. API keys are stored in a new `api_keys` table; users manage their own keys at `/account/api-keys`. Invalidation hooks added to existing deck-mutation actions in `app/decklist/actions.ts`.

**Tech Stack:** Next.js 15.2, TypeScript, Supabase (Postgres + Auth + RLS), `@supabase/ssr`, `@upstash/ratelimit`, `@upstash/redis`, Vitest.

**Conventions:**
- TDD where there is meaningful logic to test (libraries). For route handlers, write focused mocked tests; manual `curl` validation is called out explicitly.
- All new tests live in `__tests__` folders next to the module under test (matches existing project pattern, e.g. `lib/tournament/__tests__/`).
- Commit after each task completes. Use the existing commit-message style (no Conventional Commit prefix required — match recent commits like `Add maybeboard`).

---

## File Structure

**Files created:**
- `supabase/migrations/030_create_api_keys.sql` — `api_keys` table + RLS policies.
- `lib/api/errors.ts` — error envelope helpers and HTTP status mapping.
- `lib/api/cors.ts` — CORS header helpers; one place that mutates a `Response` to add the public-API CORS headers.
- `lib/api/auth.ts` — bearer-token parsing, SHA-256 hashing, key verification against Supabase, opportunistic `last_used_at` update via `after`.
- `lib/api/rateLimit.ts` — Upstash sliding-window limits (per-key minute + day; per-IP minute for the 401 path). Vercel-verified IP extraction.
- `lib/api/cache.ts` — `unstable_cache`-wrapped data loaders for list and detail; type definitions for the response shapes.
- `lib/api/__tests__/errors.test.ts`, `auth.test.ts`, `rateLimit.test.ts`, `cache.test.ts` — unit tests.
- `app/api/v1/decks/route.ts` — `GET` list + `OPTIONS` handlers.
- `app/api/v1/decks/[id]/route.ts` — `GET` detail + `OPTIONS` handlers.
- `app/api/v1/__tests__/decks-route.test.ts`, `deck-detail-route.test.ts` — route-handler tests (Supabase + rate-limit + cache mocked).
- `app/account/api-keys/page.tsx` — server component listing keys.
- `app/account/api-keys/client.tsx` — client component for create/revoke modals + table.
- `app/account/api-keys/actions.ts` — server actions: `createApiKeyAction`, `revokeApiKeyAction`.
- `docs/api/v1.md` — consumer-facing reference.

**Files modified:**
- `app/decklist/actions.ts` — add `revalidateTag` calls to `toggleDeckPublicAction`, deck-edit, deck-delete, and `replace_deck_cards`-callsites.
- `package.json` — add `@upstash/ratelimit`, `@upstash/redis` dependencies.
- `.env.local.example` (or `README.md` env section, whichever the repo uses) — document `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

---

## Task 0: Prerequisites — Upstash provisioning + dependencies

**Files:**
- Modify: `package.json`
- Reference: Vercel Marketplace → Upstash integration

- [ ] **Step 1: Provision Upstash Redis via Vercel Marketplace**

Visit the Vercel dashboard for this project → Storage → Marketplace → Upstash → Redis. Create a new Redis database, region matching the primary Vercel region (e.g. `iad1`). Connect to this project so the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars are auto-injected into Vercel deployments.

For local dev, copy those values into `.env.local`:
```
UPSTASH_REDIS_REST_URL=https://<endpoint>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

(Verify in the Vercel project settings → Environment Variables that both keys are present in Development/Preview/Production.)

- [ ] **Step 2: Install Upstash client packages**

```bash
npm install @upstash/ratelimit @upstash/redis
```

Verify `package.json` `dependencies` now includes both. Versions don't need to be pinned beyond what npm resolves.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add Upstash dependencies for public API rate limiting"
```

---

## Task 1: `api_keys` migration

**Files:**
- Create: `supabase/migrations/030_create_api_keys.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Public API keys for the read-only /api/v1/decks endpoint.
-- Keys: 'rtt_' + base64url(crypto.randomBytes(32)). Stored as sha256 hash only.

CREATE TABLE api_keys (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,           -- first 8 chars of the random portion (after rtt_)
  key_hash      TEXT NOT NULL UNIQUE,    -- sha-256 of the full key
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own api keys" ON api_keys
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own api keys" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own api keys" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);
-- No DELETE policy — revocation is a soft-delete via UPDATE (revoked_at = NOW()).
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with the SQL above. (If working locally with the Supabase CLI, run `supabase db push` instead.)

Verify with `list_tables` that `api_keys` appears and its columns match.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/030_create_api_keys.sql
git commit -m "Add api_keys table for public-API authentication"
```

---

## Task 2: `lib/api/errors.ts`

**Files:**
- Create: `lib/api/errors.ts`
- Test: `lib/api/__tests__/errors.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/api/__tests__/errors.test.ts
import { describe, it, expect } from "vitest";
import { apiError, errorResponse, type ErrorCode } from "../errors";

describe("apiError", () => {
  it("returns the canonical envelope shape", () => {
    expect(apiError("deck_not_found", "Nope")).toEqual({
      error: { code: "deck_not_found", message: "Nope" },
    });
  });
});

describe("errorResponse", () => {
  it("maps known codes to the right HTTP status", () => {
    const r = errorResponse("invalid_request", "bad");
    expect(r.status).toBe(400);
  });
  it("returns 401 for unauthorized", () => {
    expect(errorResponse("unauthorized", "x").status).toBe(401);
  });
  it("returns 404 for deck_not_found", () => {
    expect(errorResponse("deck_not_found", "x").status).toBe(404);
  });
  it("returns 429 for rate_limit_exceeded", () => {
    expect(errorResponse("rate_limit_exceeded", "x").status).toBe(429);
  });
  it("returns 500 for internal_error", () => {
    expect(errorResponse("internal_error", "x").status).toBe(500);
  });
  it("attaches extra fields when provided", async () => {
    const r = errorResponse("rate_limit_exceeded", "x", { retry_after_seconds: 23 });
    const body = await r.json();
    expect(body.error.retry_after_seconds).toBe(23);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/api/__tests__/errors.test.ts
```
Expected: FAIL — `Cannot find module '../errors'`.

- [ ] **Step 3: Implement `lib/api/errors.ts`**

```ts
import { NextResponse } from "next/server";

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "deck_not_found"
  | "rate_limit_exceeded"
  | "internal_error";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  deck_not_found: 404,
  rate_limit_exceeded: 429,
  internal_error: 500,
};

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string } & Record<string, unknown>;
};

export function apiError(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): ApiErrorBody {
  return { error: { code, message, ...(extra ?? {}) } };
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(apiError(code, message, extra), {
    status: STATUS_BY_CODE[code],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/api/__tests__/errors.test.ts
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/errors.ts lib/api/__tests__/errors.test.ts
git commit -m "Add API error envelope helpers"
```

---

## Task 3: `lib/api/cors.ts`

**Files:**
- Create: `lib/api/cors.ts`
- Test: `lib/api/__tests__/cors.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/api/__tests__/cors.test.ts
import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { withCors, preflightResponse } from "../cors";

describe("withCors", () => {
  it("adds the public-API CORS headers to an existing response", () => {
    const r = withCors(NextResponse.json({ ok: true }));
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
  it("does NOT set Access-Control-Allow-Credentials", () => {
    const r = withCors(NextResponse.json({ ok: true }));
    expect(r.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("preflightResponse", () => {
  it("returns a 204 with full CORS preflight headers", () => {
    const r = preflightResponse();
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(r.headers.get("Access-Control-Allow-Headers")).toBe("Authorization");
    expect(r.headers.get("Access-Control-Max-Age")).toBe("86400");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/api/__tests__/cors.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/api/cors.ts`**

```ts
import { NextResponse } from "next/server";

export function withCors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

export function preflightResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/api/__tests__/cors.test.ts
```
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/cors.ts lib/api/__tests__/cors.test.ts
git commit -m "Add CORS helpers for public API"
```

---

## Task 4: `lib/api/auth.ts` — key parsing, hashing, verification

**Files:**
- Create: `lib/api/auth.ts`
- Test: `lib/api/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing tests for the pure functions**

```ts
// lib/api/__tests__/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractBearerToken, hashKey, parseKey } from "../auth";

describe("extractBearerToken", () => {
  it("returns the token from 'Bearer <token>'", () => {
    expect(extractBearerToken("Bearer rtt_abc")).toBe("rtt_abc");
  });
  it("returns null for missing header", () => {
    expect(extractBearerToken(null)).toBeNull();
  });
  it("returns null for non-bearer schemes", () => {
    expect(extractBearerToken("Basic abc")).toBeNull();
  });
  it("returns null for malformed Bearer header", () => {
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer  ")).toBeNull();
  });
});

describe("parseKey", () => {
  it("accepts rtt_ + 43-char base64url", () => {
    const key = "rtt_" + "A".repeat(43);
    expect(parseKey(key)).toEqual({ prefix: "AAAAAAAA", full: key });
  });
  it("rejects keys without the rtt_ prefix", () => {
    expect(parseKey("xyz_" + "A".repeat(43))).toBeNull();
  });
  it("rejects keys with wrong random-portion length", () => {
    expect(parseKey("rtt_" + "A".repeat(20))).toBeNull();
    expect(parseKey("rtt_" + "A".repeat(50))).toBeNull();
  });
  it("rejects keys with non-base64url characters", () => {
    expect(parseKey("rtt_" + "!".repeat(43))).toBeNull();
  });
});

describe("hashKey", () => {
  it("produces a 64-char lowercase hex sha256", () => {
    const h = hashKey("rtt_test");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is deterministic", () => {
    expect(hashKey("rtt_test")).toBe(hashKey("rtt_test"));
  });
  it("differs for different inputs", () => {
    expect(hashKey("rtt_a")).not.toBe(hashKey("rtt_b"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/api/__tests__/auth.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the pure functions in `lib/api/auth.ts`**

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const KEY_PREFIX = "rtt_";
const RANDOM_LEN = 43; // base64url(32 bytes) = 43 chars (no padding)
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export type ParsedKey = { prefix: string; full: string };
export type VerifiedKey = {
  id: string;
  user_id: string;
  key_prefix: string;
};

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme !== "Bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

export function parseKey(key: string): ParsedKey | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const random = key.slice(KEY_PREFIX.length);
  if (random.length !== RANDOM_LEN) return null;
  if (!BASE64URL_RE.test(random)) return null;
  return { prefix: random.slice(0, 8), full: key };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateKey(): { full: string; prefix: string; hash: string } {
  const random = randomBytes(32).toString("base64url"); // 43 chars
  const full = KEY_PREFIX + random;
  return { full, prefix: random.slice(0, 8), hash: hashKey(full) };
}

// Constant-time compare for any place we hold two hex hashes side-by-side.
export function safeHashEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
```

Note: we keep `safeHashEqual` exported for completeness, but the DB lookup (next step) does the equality check at the index level. `timingSafeEqual` is used only in the rare case we compare two in-memory hashes (e.g., a future scenario or a defensive double-check). The DB query is already constant-time at the SQL layer.

- [ ] **Step 4: Add the `verifyApiKey` function (DB-backed)**

Add to `lib/api/auth.ts`:

```ts
/**
 * Service-role admin client used ONLY here, for two reasons:
 *  - The auth check happens on an unauthenticated request (no user cookie).
 *  - We need to read api_keys rows owned by *any* user.
 * The function only returns the minimum (user_id, key_prefix, id) — never the hash.
 */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin env vars missing");
  return createServiceClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function verifyApiKey(presentedKey: string): Promise<VerifiedKey | null> {
  const parsed = parseKey(presentedKey);
  if (!parsed) return null;
  const hash = hashKey(parsed.full);

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, user_id, key_prefix")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as VerifiedKey;
}

/**
 * Non-blocking last_used_at update via Next's `after` helper.
 * The response returns before this completes.
 */
export function touchLastUsedAt(keyId: string): void {
  after(async () => {
    try {
      const supabase = adminClient();
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", keyId);
    } catch {
      // best-effort; never block or surface
    }
  });
}
```

**Note:** The spec describes anon-client reads for deck data. `api_keys` reads are a separate concern — the request is unauthenticated from Supabase's POV (no cookie), so RLS would deny anon SELECT. The admin client is scoped to this single module and only handles the auth check itself. This is the one place in `lib/api/` that touches the service-role key.

- [ ] **Step 5: Add an integration-style test for `verifyApiKey` with Supabase mocked**

Append to `lib/api/__tests__/auth.test.ts`:

```ts
import { verifyApiKey } from "../auth";

vi.mock("@supabase/supabase-js", () => {
  const maybeSingle = vi.fn();
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    limit: () => builder,
    maybeSingle,
  };
  return {
    createClient: () => ({
      from: () => builder,
    }),
    __setMaybeSingle: (impl: any) => maybeSingle.mockImplementation(impl),
  };
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
});

describe("verifyApiKey", () => {
  it("returns null for a malformed key", async () => {
    expect(await verifyApiKey("nope")).toBeNull();
  });

  it("returns null when the DB has no matching active row", async () => {
    const mod = await import("@supabase/supabase-js") as any;
    mod.__setMaybeSingle(async () => ({ data: null, error: null }));
    const validKey = "rtt_" + "A".repeat(43);
    expect(await verifyApiKey(validKey)).toBeNull();
  });

  it("returns the verified key on a DB hit", async () => {
    const mod = await import("@supabase/supabase-js") as any;
    mod.__setMaybeSingle(async () => ({
      data: { id: "abc", user_id: "u1", key_prefix: "AAAAAAAA" },
      error: null,
    }));
    const validKey = "rtt_" + "A".repeat(43);
    expect(await verifyApiKey(validKey)).toEqual({
      id: "abc",
      user_id: "u1",
      key_prefix: "AAAAAAAA",
    });
  });
});
```

- [ ] **Step 6: Run all auth tests**

```bash
npx vitest run lib/api/__tests__/auth.test.ts
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/api/auth.ts lib/api/__tests__/auth.test.ts
git commit -m "Add API key parsing, hashing, and verification"
```

---

## Task 5: `lib/api/rateLimit.ts`

**Files:**
- Create: `lib/api/rateLimit.ts`
- Test: `lib/api/__tests__/rateLimit.test.ts`

- [ ] **Step 1: Write failing tests for the pure helper**

```ts
// lib/api/__tests__/rateLimit.test.ts
import { describe, it, expect } from "vitest";
import { extractClientIp } from "../rateLimit";

describe("extractClientIp", () => {
  function reqWith(headers: Record<string, string>) {
    return { headers: new Headers(headers) } as Request;
  }

  it("uses x-vercel-forwarded-for when present", () => {
    expect(extractClientIp(reqWith({ "x-vercel-forwarded-for": "1.2.3.4" })))
      .toBe("1.2.3.4");
  });

  it("returns the first IP if the header is a comma list", () => {
    expect(extractClientIp(reqWith({ "x-vercel-forwarded-for": "1.2.3.4, 10.0.0.1" })))
      .toBe("1.2.3.4");
  });

  it("falls back to x-forwarded-for (first value)", () => {
    expect(extractClientIp(reqWith({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })))
      .toBe("5.6.7.8");
  });

  it("returns 'unknown' when no forwarded header is present", () => {
    expect(extractClientIp(reqWith({}))).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/api/__tests__/rateLimit.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `lib/api/rateLimit.ts`**

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix epoch seconds
};

let _redis: Redis | null = null;
function redis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

let _perKeyMinute: Ratelimit | null = null;
function perKeyMinute(): Ratelimit {
  if (!_perKeyMinute) {
    _perKeyMinute = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: false,
      prefix: "rtt:api:key-min",
    });
  }
  return _perKeyMinute;
}

let _perKeyDay: Ratelimit | null = null;
function perKeyDay(): Ratelimit {
  if (!_perKeyDay) {
    _perKeyDay = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(10_000, "1 d"),
      analytics: false,
      prefix: "rtt:api:key-day",
    });
  }
  return _perKeyDay;
}

let _perIpUnauthMinute: Ratelimit | null = null;
function perIpUnauthMinute(): Ratelimit {
  if (!_perIpUnauthMinute) {
    _perIpUnauthMinute = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      analytics: false,
      prefix: "rtt:api:ip-unauth",
    });
  }
  return _perIpUnauthMinute;
}

/** Vercel-verified client IP; comma-separated lists return the first entry. */
export function extractClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

/** Check both per-minute and per-day caps for an API key. Stricter wins. */
export async function rateLimitForKey(keyPrefix: string): Promise<RateLimitResult> {
  const id = `key:${keyPrefix}`;
  const [m, d] = await Promise.all([perKeyMinute().limit(id), perKeyDay().limit(id)]);
  // Use the stricter of the two on the response headers.
  const stricter = m.remaining <= d.remaining ? m : d;
  return {
    success: m.success && d.success,
    limit: stricter === m ? 60 : 10_000,
    remaining: stricter.remaining,
    reset: Math.ceil(stricter.reset / 1000),
  };
}

/** Pre-401 IP throttle, to slow key-guessing. */
export async function rateLimitForUnauthIp(ip: string): Promise<RateLimitResult> {
  const r = await perIpUnauthMinute().limit(`ip:${ip}`);
  return {
    success: r.success,
    limit: 30,
    remaining: r.remaining,
    reset: Math.ceil(r.reset / 1000),
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run lib/api/__tests__/rateLimit.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/rateLimit.ts lib/api/__tests__/rateLimit.test.ts
git commit -m "Add Upstash rate-limit helpers for public API"
```

---

## Task 6: `lib/api/cache.ts` — cached loaders + query-param validation

**Files:**
- Create: `lib/api/cache.ts`
- Test: `lib/api/__tests__/cache.test.ts`

- [ ] **Step 1: Write failing tests for the validation helpers**

```ts
// lib/api/__tests__/cache.test.ts
import { describe, it, expect } from "vitest";
import { parseListParams, isUuid, PUBLIC_DECKS_LIST_TAG, publicDeckTag } from "../cache";

describe("parseListParams", () => {
  function p(qs: string) {
    return parseListParams(new URL("http://x/?" + qs).searchParams);
  }

  it("returns defaults when nothing is set", () => {
    expect(p("")).toEqual({
      ok: true,
      value: { page: 1, page_size: 24, format: null, username: null, sort: "newest" },
    });
  });

  it("rejects unknown sort values", () => {
    const r = p("sort=banana");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/sort/i);
  });

  it("rejects page_size outside allowlist", () => {
    const r = p("page_size=25");
    expect(r.ok).toBe(false);
  });

  it("accepts page_size in allowlist", () => {
    expect(p("page_size=50").ok).toBe(true);
    expect(p("page_size=100").ok).toBe(true);
  });

  it("rejects page below 1 or above 1000", () => {
    expect(p("page=0").ok).toBe(false);
    expect(p("page=1001").ok).toBe(false);
  });

  it("trims and accepts username", () => {
    const r = p("username=%20foo%20");
    if (r.ok) expect(r.value.username).toBe("foo");
  });
});

describe("isUuid", () => {
  it("accepts valid v4 UUIDs", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
  });
  it("rejects malformed strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("publicDeckTag", () => {
  it("builds the per-deck tag", () => {
    expect(publicDeckTag("abc")).toBe("public-deck:abc");
    expect(PUBLIC_DECKS_LIST_TAG).toBe("public-decks-list");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/api/__tests__/cache.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `lib/api/cache.ts`**

```ts
import { unstable_cache } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export const PUBLIC_DECKS_LIST_TAG = "public-decks-list" as const;
export const publicDeckTag = (id: string) => `public-deck:${id}` as const;

const SITE_URL = "https://landofredemption.com";
const PAGE_SIZE_ALLOWLIST = new Set([24, 50, 100]);
const SORTS = new Set(["newest", "most_viewed", "name"] as const);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ListSort = "newest" | "most_viewed" | "name";

export type ListParams = {
  page: number;
  page_size: number;
  format: string | null;
  username: string | null;
  sort: ListSort;
};

export type DeckPayload = {
  id: string;
  name: string;
  description: string | null;
  format: string | null;
  paragon: string | null;
  card_count: number;
  is_legal: boolean;
  view_count: number;
  username: string | null;
  created_at: string;
  updated_at: string;
  url: string;
};

export type ListPayload = {
  data: DeckPayload[];
  pagination: { page: number; page_size: number; total: number; has_more: boolean };
};

export type DetailPayload = DeckPayload & {
  cards: { name: string; set: string | null; quantity: number; zone: string }[];
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function parseListParams(sp: URLSearchParams): ParseResult<ListParams> {
  const pageRaw = sp.get("page");
  const page = pageRaw === null ? 1 : Number.parseInt(pageRaw, 10);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    return { ok: false, message: "page must be an integer in [1, 1000]" };
  }

  const pageSizeRaw = sp.get("page_size");
  const page_size = pageSizeRaw === null ? 24 : Number.parseInt(pageSizeRaw, 10);
  if (!Number.isInteger(page_size) || !PAGE_SIZE_ALLOWLIST.has(page_size)) {
    return { ok: false, message: "page_size must be one of 24, 50, 100" };
  }

  const sortRaw = sp.get("sort");
  const sort = (sortRaw ?? "newest") as ListSort;
  if (!SORTS.has(sort)) {
    return { ok: false, message: "sort must be one of newest, most_viewed, name" };
  }

  const format = sp.get("format")?.trim() || null;
  const username = sp.get("username")?.trim() || null;

  return { ok: true, value: { page, page_size, format, username, sort } };
}

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function deckUrl(id: string): string {
  return `${SITE_URL}/decklist/${id}`;
}

type DeckRow = {
  id: string;
  name: string;
  description: string | null;
  format: string | null;
  paragon: string | null;
  card_count: number | null;
  is_legal: boolean | null;
  view_count: number | null;
  created_at: string;
  updated_at: string;
  profiles: { username: string | null } | null;
};

function rowToPayload(row: DeckRow): DeckPayload {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    format: row.format,
    paragon: row.paragon,
    card_count: row.card_count ?? 0,
    is_legal: row.is_legal ?? false,
    view_count: row.view_count ?? 0,
    username: row.profiles?.username ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    url: deckUrl(row.id),
  };
}

const DECK_COLUMNS =
  "id, name, description, format, paragon, card_count, is_legal, view_count, created_at, updated_at, profiles!inner(username)";

async function loadListFresh(params: ListParams): Promise<ListPayload> {
  const supabase = await createClient();

  // Resolve username → user_id inside the cached function so the cache key
  // is the raw username string.
  let userIdFilter: string | null = null;
  if (params.username) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", params.username)
      .maybeSingle();
    if (!profile) {
      return {
        data: [],
        pagination: { page: params.page, page_size: params.page_size, total: 0, has_more: false },
      };
    }
    userIdFilter = profile.id;
  }

  let q = supabase
    .from("decks")
    .select(DECK_COLUMNS, { count: "exact" })
    .eq("is_public", true);

  if (params.format) {
    if (params.format === "Type 1") {
      q = q.or("format.is.null,format.eq.Type 1");
    } else {
      q = q.eq("format", params.format);
    }
  }
  if (userIdFilter) q = q.eq("user_id", userIdFilter);

  switch (params.sort) {
    case "most_viewed":
      q = q.order("view_count", { ascending: false, nullsFirst: false }).order("id", { ascending: true });
      break;
    case "name":
      q = q.order("name", { ascending: true }).order("id", { ascending: true });
      break;
    case "newest":
    default:
      q = q.order("updated_at", { ascending: false }).order("id", { ascending: true });
      break;
  }

  const offset = (params.page - 1) * params.page_size;
  q = q.range(offset, offset + params.page_size - 1);

  const { data, count, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as unknown as DeckRow[];
  return {
    data: rows.map(rowToPayload),
    pagination: {
      page: params.page,
      page_size: params.page_size,
      total: count ?? 0,
      has_more: (count ?? 0) > offset + rows.length,
    },
  };
}

async function loadDetailFresh(id: string): Promise<DetailPayload | null> {
  const supabase = await createClient();
  const { data: deck, error } = await supabase
    .from("decks")
    .select(DECK_COLUMNS)
    .eq("is_public", true)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!deck) return null;

  const { data: cards, error: cardsErr } = await supabase
    .from("deck_cards")
    .select("card_name, card_set, quantity, zone")
    .eq("deck_id", id);
  if (cardsErr) throw cardsErr;

  const payload = rowToPayload(deck as unknown as DeckRow);
  return {
    ...payload,
    cards: (cards ?? []).map((c: any) => ({
      name: c.card_name,
      set: c.card_set ?? null,
      quantity: c.quantity,
      zone: c.zone ?? "main",
    })),
  };
}

export function loadPublicDecksList(params: ListParams): Promise<ListPayload> {
  return unstable_cache(
    () => loadListFresh(params),
    ["public-decks-list", params.page.toString(), params.page_size.toString(), params.format ?? "", params.username ?? "", params.sort],
    { tags: [PUBLIC_DECKS_LIST_TAG], revalidate: 300 },
  )();
}

export function loadPublicDeckDetail(id: string): Promise<DetailPayload | null> {
  return unstable_cache(
    () => loadDetailFresh(id),
    ["public-deck-detail", id],
    { tags: [PUBLIC_DECKS_LIST_TAG, publicDeckTag(id)], revalidate: 3600 },
  )();
}
```

- [ ] **Step 4: Run validation tests**

```bash
npx vitest run lib/api/__tests__/cache.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/cache.ts lib/api/__tests__/cache.test.ts
git commit -m "Add cached loaders for public deck list and detail"
```

---

## Task 7: List route — `app/api/v1/decks/route.ts`

**Files:**
- Create: `app/api/v1/decks/route.ts`
- Test: `app/api/v1/__tests__/decks-route.test.ts`

- [ ] **Step 1: Write failing tests for the route handler**

```ts
// app/api/v1/__tests__/decks-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  extractBearerToken: vi.fn(),
  verifyApiKey: vi.fn(),
  touchLastUsedAt: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  extractClientIp: vi.fn(() => "1.2.3.4"),
  rateLimitForKey: vi.fn(),
  rateLimitForUnauthIp: vi.fn(async () => ({ success: true, limit: 30, remaining: 29, reset: 1000 })),
}));
vi.mock("@/lib/api/cache", async (orig) => {
  const real: any = await orig();
  return { ...real, loadPublicDecksList: vi.fn() };
});

import { GET, OPTIONS } from "../decks/route";
import * as auth from "@/lib/api/auth";
import * as rl from "@/lib/api/rateLimit";
import * as cache from "@/lib/api/cache";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/decks", () => {
  it("returns 401 when no Authorization header is present", async () => {
    (auth.extractBearerToken as any).mockReturnValue(null);
    const r = await GET(req("https://x/api/v1/decks"));
    expect(r.status).toBe(401);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 401 when the bearer key is invalid", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_bad");
    (auth.verifyApiKey as any).mockResolvedValue(null);
    const r = await GET(req("https://x/api/v1/decks", { authorization: "Bearer rtt_bad" }));
    expect(r.status).toBe(401);
  });

  it("returns 400 for invalid query params", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_good");
    (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
    (rl.rateLimitForKey as any).mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 1000 });
    const r = await GET(req("https://x/api/v1/decks?sort=banana"));
    expect(r.status).toBe(400);
  });

  it("returns 429 when rate-limited (keys present)", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_good");
    (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
    (rl.rateLimitForKey as any).mockResolvedValue({ success: false, limit: 60, remaining: 0, reset: 1234567890 });
    const r = await GET(req("https://x/api/v1/decks"));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).not.toBeNull();
    expect(r.headers.get("X-RateLimit-Reset")).toBe("1234567890");
  });

  it("returns 200 with the cached list body and rate-limit + cache-control headers", async () => {
    (auth.extractBearerToken as any).mockReturnValue("rtt_good");
    (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
    (rl.rateLimitForKey as any).mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 999 });
    (cache.loadPublicDecksList as any).mockResolvedValue({
      data: [],
      pagination: { page: 1, page_size: 24, total: 0, has_more: false },
    });

    const r = await GET(req("https://x/api/v1/decks"));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toMatch(/s-maxage=300/);
    expect(r.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(auth.touchLastUsedAt).toHaveBeenCalledWith("k");
  });
});

describe("OPTIONS /api/v1/decks", () => {
  it("returns 204 with CORS preflight headers and bypasses auth", async () => {
    const r = await OPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(auth.verifyApiKey).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run app/api/v1/__tests__/decks-route.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/api/v1/decks/route.ts`**

```ts
import { NextResponse } from "next/server";
import { extractBearerToken, verifyApiKey, touchLastUsedAt } from "@/lib/api/auth";
import {
  extractClientIp,
  rateLimitForKey,
  rateLimitForUnauthIp,
  type RateLimitResult,
} from "@/lib/api/rateLimit";
import { loadPublicDecksList, parseListParams } from "@/lib/api/cache";
import { errorResponse } from "@/lib/api/errors";
import { preflightResponse, withCors } from "@/lib/api/cors";

export const runtime = "nodejs";

function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(Math.max(0, rl.remaining)),
    "X-RateLimit-Reset": String(rl.reset),
  };
}

function applyHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return preflightResponse();
}

export async function GET(req: Request) {
  const token = extractBearerToken(req.headers.get("authorization"));

  if (!token) {
    const ip = extractClientIp(req);
    const ipRl = await rateLimitForUnauthIp(ip);
    if (!ipRl.success) {
      return withCors(
        applyHeaders(
          errorResponse("rate_limit_exceeded", "Too many unauthenticated requests.", {
            retry_after_seconds: Math.max(1, ipRl.reset - Math.floor(Date.now() / 1000)),
          }),
          { ...rateLimitHeaders(ipRl), "Retry-After": String(Math.max(1, ipRl.reset - Math.floor(Date.now() / 1000))) },
        ),
      );
    }
    return withCors(errorResponse("unauthorized", "Missing or invalid Authorization header."));
  }

  const verified = await verifyApiKey(token);
  if (!verified) {
    const ip = extractClientIp(req);
    await rateLimitForUnauthIp(ip); // count failed attempts
    return withCors(errorResponse("unauthorized", "Missing or invalid Authorization header."));
  }

  const keyRl = await rateLimitForKey(verified.key_prefix);
  if (!keyRl.success) {
    const retry = Math.max(1, keyRl.reset - Math.floor(Date.now() / 1000));
    return withCors(
      applyHeaders(
        errorResponse("rate_limit_exceeded", `Rate limit exceeded. Retry after ${retry}s.`, {
          retry_after_seconds: retry,
        }),
        { ...rateLimitHeaders(keyRl), "Retry-After": String(retry) },
      ),
    );
  }

  const url = new URL(req.url);
  const parsed = parseListParams(url.searchParams);
  if (!parsed.ok) {
    return withCors(applyHeaders(errorResponse("invalid_request", parsed.message), rateLimitHeaders(keyRl)));
  }

  let body;
  try {
    body = await loadPublicDecksList(parsed.value);
  } catch (e) {
    console.error("loadPublicDecksList failed", e);
    return withCors(applyHeaders(errorResponse("internal_error", "Unexpected server error."), rateLimitHeaders(keyRl)));
  }

  touchLastUsedAt(verified.id);

  const res = NextResponse.json(body, { status: 200 });
  applyHeaders(res, {
    ...rateLimitHeaders(keyRl),
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
  });
  return withCors(res);
}
```

- [ ] **Step 4: Run all route tests**

```bash
npx vitest run app/api/v1/__tests__/decks-route.test.ts
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/decks/route.ts app/api/v1/__tests__/decks-route.test.ts
git commit -m "Add GET /api/v1/decks list endpoint"
```

---

## Task 8: Detail route — `app/api/v1/decks/[id]/route.ts`

**Files:**
- Create: `app/api/v1/decks/[id]/route.ts`
- Test: `app/api/v1/__tests__/deck-detail-route.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/api/v1/__tests__/deck-detail-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  extractBearerToken: vi.fn(),
  verifyApiKey: vi.fn(),
  touchLastUsedAt: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  extractClientIp: vi.fn(() => "1.2.3.4"),
  rateLimitForKey: vi.fn(),
  rateLimitForUnauthIp: vi.fn(async () => ({ success: true, limit: 30, remaining: 29, reset: 1000 })),
}));
vi.mock("@/lib/api/cache", async (orig) => {
  const real: any = await orig();
  return { ...real, loadPublicDeckDetail: vi.fn() };
});

import { GET } from "../decks/[id]/route";
import * as auth from "@/lib/api/auth";
import * as rl from "@/lib/api/rateLimit";
import * as cache from "@/lib/api/cache";

function req() {
  return new Request("https://x/api/v1/decks/abc", { headers: { authorization: "Bearer rtt_good" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth.extractBearerToken as any).mockReturnValue("rtt_good");
  (auth.verifyApiKey as any).mockResolvedValue({ id: "k", user_id: "u", key_prefix: "abcd1234" });
  (rl.rateLimitForKey as any).mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 999 });
});

describe("GET /api/v1/decks/:id", () => {
  it("returns 400 for malformed UUID", async () => {
    const r = await GET(req(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(r.status).toBe(400);
    expect(cache.loadPublicDeckDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when the cached loader returns null", async () => {
    (cache.loadPublicDeckDetail as any).mockResolvedValue(null);
    const r = await GET(req(), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    expect(r.status).toBe(404);
  });

  it("returns 200 with the cached body + cache-control header when found", async () => {
    (cache.loadPublicDeckDetail as any).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "X",
      cards: [],
    });
    const r = await GET(req(), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toMatch(/s-maxage=300/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run app/api/v1/__tests__/deck-detail-route.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `app/api/v1/decks/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { extractBearerToken, verifyApiKey, touchLastUsedAt } from "@/lib/api/auth";
import {
  extractClientIp,
  rateLimitForKey,
  rateLimitForUnauthIp,
  type RateLimitResult,
} from "@/lib/api/rateLimit";
import { loadPublicDeckDetail, isUuid } from "@/lib/api/cache";
import { errorResponse } from "@/lib/api/errors";
import { preflightResponse, withCors } from "@/lib/api/cors";

export const runtime = "nodejs";

function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(Math.max(0, rl.remaining)),
    "X-RateLimit-Reset": String(rl.reset),
  };
}

function applyHeaders(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return preflightResponse();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    const ip = extractClientIp(req);
    await rateLimitForUnauthIp(ip);
    return withCors(errorResponse("unauthorized", "Missing or invalid Authorization header."));
  }

  const verified = await verifyApiKey(token);
  if (!verified) {
    const ip = extractClientIp(req);
    await rateLimitForUnauthIp(ip);
    return withCors(errorResponse("unauthorized", "Missing or invalid Authorization header."));
  }

  const keyRl = await rateLimitForKey(verified.key_prefix);
  if (!keyRl.success) {
    const retry = Math.max(1, keyRl.reset - Math.floor(Date.now() / 1000));
    return withCors(
      applyHeaders(
        errorResponse("rate_limit_exceeded", `Rate limit exceeded. Retry after ${retry}s.`, {
          retry_after_seconds: retry,
        }),
        { ...rateLimitHeaders(keyRl), "Retry-After": String(retry) },
      ),
    );
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return withCors(applyHeaders(errorResponse("invalid_request", "id must be a UUID."), rateLimitHeaders(keyRl)));
  }

  let body;
  try {
    body = await loadPublicDeckDetail(id);
  } catch (e) {
    console.error("loadPublicDeckDetail failed", e);
    return withCors(applyHeaders(errorResponse("internal_error", "Unexpected server error."), rateLimitHeaders(keyRl)));
  }

  if (!body) {
    return withCors(applyHeaders(errorResponse("deck_not_found", `No public deck with id '${id}' exists.`), rateLimitHeaders(keyRl)));
  }

  touchLastUsedAt(verified.id);

  const res = NextResponse.json(body, { status: 200 });
  applyHeaders(res, {
    ...rateLimitHeaders(keyRl),
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
  });
  return withCors(res);
}
```

- [ ] **Step 4: Run all detail-route tests**

```bash
npx vitest run app/api/v1/__tests__/deck-detail-route.test.ts
```
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/decks/[id]/route.ts app/api/v1/__tests__/deck-detail-route.test.ts
git commit -m "Add GET /api/v1/decks/:id detail endpoint"
```

---

## Task 9: Wire cache invalidation into existing deck-mutation actions

**Files:**
- Modify: `app/decklist/actions.ts`

Add `revalidateTag` calls so cached API responses become stale when public decks change. The existing actions already `revalidatePath("/decklist/community")`; we add tag-based invalidation alongside it.

- [ ] **Step 1: Read the relevant section**

Open `app/decklist/actions.ts`. Find these locations (line numbers approximate from current state):
- `toggleDeckPublicAction` (~line 842) — runs on publish/unpublish.
- Deck-update action that revalidates `/decklist/community` (~line 1521).
- Deck-delete action that revalidates `/decklist/community` (~line 1549).
- Card-mutation site that revalidates `/decklist/community` (~line 1668).

- [ ] **Step 2: Add the import**

At the top of the file, ensure `revalidateTag` is imported alongside `revalidatePath`:

```ts
import { revalidatePath, revalidateTag } from "next/cache";
```

(If `revalidatePath` is imported in a different style, just add `revalidateTag` to the existing import.)

- [ ] **Step 3: Invalidate in `toggleDeckPublicAction`**

After the successful update inside `toggleDeckPublicAction`, before returning:

```ts
revalidateTag("public-decks-list");
revalidateTag(`public-deck:${deckId}`);
```

(Place these next to the existing `revalidatePath` call — both fire whether the deck was made public or private. Going-private removes it from the cached list; going-public ensures the list refreshes.)

- [ ] **Step 4: Invalidate in the deck-update / deck-delete actions**

Every site that currently calls `revalidatePath("/decklist/community")` for a deck **that may be public** should also call:

```ts
revalidateTag("public-decks-list");
revalidateTag(`public-deck:${deckId}`);
```

This applies to:
- The deck-metadata update action (~line 1521).
- The deck-delete action (~line 1549).
- The card-mutation site (~line 1668) — for this one, `public-deck:<id>` is enough; the list response doesn't include cards. Add only the per-deck tag:
  ```ts
  revalidateTag(`public-deck:${deckId}`);
  ```

Use `Edit` with enough surrounding context to make each replacement unique.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/decklist/actions.ts
git commit -m "Invalidate public-API cache tags on deck mutations"
```

---

## Task 10: API key management — server actions

**Files:**
- Create: `app/account/api-keys/actions.ts`

- [ ] **Step 1: Implement create + revoke server actions**

```ts
// app/account/api-keys/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { generateKey } from "@/lib/api/auth";

const MAX_ACTIVE_KEYS = 5;

export type CreateApiKeyResult =
  | { ok: true; fullKey: string; name: string; prefix: string }
  | { ok: false; error: string };

export async function createApiKeyAction(name: string): Promise<CreateApiKeyResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  if (trimmed.length > 64) return { ok: false, error: "Name must be 64 characters or fewer." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { count } = await supabase
    .from("api_keys")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return { ok: false, error: "Maximum of 5 active API keys. Revoke one to create another." };
  }

  const { full, prefix, hash } = generateKey();
  const { error } = await supabase.from("api_keys").insert({
    user_id: user.id,
    name: trimmed,
    key_prefix: prefix,
    key_hash: hash,
  });
  if (error) return { ok: false, error: "Failed to create key." };

  revalidatePath("/account/api-keys");
  return { ok: true, fullKey: full, name: trimmed, prefix };
}

export async function revokeApiKeyAction(keyId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // RLS enforces user_id ownership on UPDATE.
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .is("revoked_at", null);
  if (error) return { ok: false, error: "Failed to revoke key." };

  revalidatePath("/account/api-keys");
  return { ok: true };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/account/api-keys/actions.ts
git commit -m "Add server actions for API key create/revoke"
```

---

## Task 11: API key management — UI

**Files:**
- Create: `app/account/api-keys/page.tsx`
- Create: `app/account/api-keys/client.tsx`

- [ ] **Step 1: Implement the server component**

```tsx
// app/account/api-keys/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { ApiKeysClient, type ApiKeyRow } from "./client";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const keys: ApiKeyRow[] = (data ?? []).map((k: any) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    revokedAt: k.revoked_at,
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">API Keys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Generate keys to access the public deck API. The full key is shown once at creation —
        copy it immediately.
      </p>
      <ApiKeysClient initialKeys={keys} />
    </div>
  );
}
```

- [ ] **Step 2: Implement the client component**

```tsx
// app/account/api-keys/client.tsx
"use client";

import { useState, useTransition } from "react";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function maskedPrefix(p: string) {
  return `rtt_${p}…`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to manual fallback
    }
  }
  return false;
}

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newlyCreated, setNewlyCreated] = useState<{ fullKey: string; name: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createApiKeyAction(name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setShowCreate(false);
      setNewlyCreated({ fullKey: result.fullKey, name: result.name });
      setKeys((prev) => [
        {
          id: "pending",
          name: result.name,
          keyPrefix: result.prefix,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
        },
        ...prev,
      ]);
    });
  }

  function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? Active integrations using it will stop working.")) return;
    startTransition(async () => {
      const result = await revokeApiKeyAction(id);
      if (result.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)));
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setShowCreate(true);
            setError(null);
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          disabled={pending}
        >
          Create new key
        </button>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2">Name</th>
            <th>Prefix</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-muted-foreground">
                No keys yet.
              </td>
            </tr>
          )}
          {keys.map((k) => (
            <tr key={k.id} className="border-t">
              <td className="py-2">{k.name}</td>
              <td className="font-mono">{maskedPrefix(k.keyPrefix)}</td>
              <td>{formatDate(k.createdAt)}</td>
              <td>{formatDate(k.lastUsedAt)}</td>
              <td>{k.revokedAt ? "Revoked" : "Active"}</td>
              <td className="text-right">
                {!k.revokedAt && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id)}
                    disabled={pending}
                    className="text-red-600 hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <div className="rounded-md border bg-muted/30 p-4">
          <label className="mb-2 block text-sm font-medium">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My Discord bot"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            maxLength={64}
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setError(null);
                setName("");
              }}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {newlyCreated && <RevealModal {...newlyCreated} onDismiss={() => setNewlyCreated(null)} />}
    </div>
  );
}

function RevealModal({
  fullKey,
  name,
  onDismiss,
}: {
  fullKey: string;
  name: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(fullKey);
    if (ok) {
      setCopied(true);
      return;
    }
    const input = document.getElementById("api-key-fallback") as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-md border bg-background p-6">
        <h2 className="mb-2 text-lg font-semibold">Copy your new key</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          This is the only time <strong>{name}</strong>’s full key will be displayed. If you
          dismiss this dialog without copying it, you will need to revoke and create a new one.
        </p>
        <input
          id="api-key-fallback"
          type="text"
          readOnly
          value={fullKey}
          className="w-full rounded-md border bg-muted px-3 py-2 font-mono text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={onDismiss} className="rounded-md border px-4 py-2 text-sm">
            I’ve copied it
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual UI smoke test**

Start the dev server and exercise the page:

```bash
npm run dev
```

Navigate to `http://localhost:3000/account/api-keys` (signed in). Verify:
- Empty state renders.
- "Create new key" opens the form; submitting with empty name shows error.
- Successful create shows the reveal modal once; full key visible; copy button works (and falls back to input selection if you simulate clipboard failure in devtools).
- After dismissing, the table row appears with the masked prefix; full key is not displayed anywhere.
- Creating a 6th key shows the inline "Maximum of 5 active API keys" error.
- Revoke confirms then marks the row as Revoked.

If a UI issue blocks completion, note it and skip — the API endpoints are functional without this page, but the page must work before shipping.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/account/api-keys/page.tsx app/account/api-keys/client.tsx
git commit -m "Add /account/api-keys management page"
```

---

## Task 12: End-to-end smoke test with `curl`

**No files created.** This task validates the deployed-locally API surface end-to-end.

- [ ] **Step 1: Run a known public deck through the list endpoint**

In one terminal:
```bash
npm run dev
```

Generate a key via the UI from Task 11. Copy the full key. In another terminal:

```bash
KEY="rtt_<paste-here>"
curl -sS -H "Authorization: Bearer $KEY" 'http://localhost:3000/api/v1/decks?page_size=24&sort=newest' | jq .
```

Expected: 200 response with `data: [...]` and `pagination: { … }`. Each deck has the documented fields, `username` is present (or `null` if profile missing), and no `user_id`.

- [ ] **Step 2: Fetch a single public deck**

Pick any `id` from step 1:

```bash
curl -sS -H "Authorization: Bearer $KEY" 'http://localhost:3000/api/v1/decks/<id>' | jq .
```

Expected: 200 with `cards: [...]`. Each card has `name`, `set`, `quantity`, `zone`.

- [ ] **Step 3: Exercise error paths**

```bash
# 401 - missing auth
curl -i 'http://localhost:3000/api/v1/decks'

# 401 - bad key
curl -i -H "Authorization: Bearer rtt_invalid" 'http://localhost:3000/api/v1/decks'

# 400 - bad sort
curl -i -H "Authorization: Bearer $KEY" 'http://localhost:3000/api/v1/decks?sort=banana'

# 400 - bad page_size
curl -i -H "Authorization: Bearer $KEY" 'http://localhost:3000/api/v1/decks?page_size=25'

# 400 - malformed UUID
curl -i -H "Authorization: Bearer $KEY" 'http://localhost:3000/api/v1/decks/not-a-uuid'

# 404 - well-formed UUID but no public deck
curl -i -H "Authorization: Bearer $KEY" 'http://localhost:3000/api/v1/decks/11111111-1111-4111-8111-111111111111'
```

Verify each returns the documented status code and the canonical `{ "error": { "code": ..., "message": ... } }` envelope. CORS header `Access-Control-Allow-Origin: *` and rate-limit headers should be present on every response.

- [ ] **Step 4: Verify CORS preflight**

```bash
curl -i -X OPTIONS 'http://localhost:3000/api/v1/decks'
```

Expected: 204 with `Access-Control-Allow-Methods: GET, OPTIONS` and `Access-Control-Allow-Headers: Authorization`.

- [ ] **Step 5: Verify invalidation by mutating a public deck**

In the web UI, toggle a public deck to private (or edit its name). Re-run step 1 — the deck should disappear (or its name should update) within the same request, because `revalidateTag` runs synchronously with the mutation.

- [ ] **Step 6: No commit unless changes were needed**

If any of the smoke-test steps reveal a bug, file a follow-up edit on the relevant file and commit. Otherwise this task is a pure verification.

---

## Task 13: Consumer-facing reference doc

**Files:**
- Create: `docs/api/v1.md`

- [ ] **Step 1: Write the reference**

```markdown
# Public Deck API — v1

Read-only HTTP API for community decks on landofredemption.com.

**Base URL:** `https://landofredemption.com/api/v1`

## Authentication

Every request must include an `Authorization: Bearer rtt_…` header. Generate keys at
[https://landofredemption.com/account/api-keys](https://landofredemption.com/account/api-keys).

## Rate limits

- 60 requests / minute and 10,000 requests / day per key.
- Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`
  (Unix epoch seconds, UTC).
- A 429 response includes `Retry-After: <seconds>` and a body with `retry_after_seconds`.

## Endpoints

### `GET /decks`

List public decks. Query parameters:

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int | 1 | 1–1000 |
| `page_size` | int | 24 | One of 24, 50, 100 |
| `format` | string | — | `Type 1` also matches NULL-format decks (legacy) |
| `username` | string | — | Exact match |
| `sort` | enum | `newest` | `newest`, `most_viewed`, `name` |

Response (200):
```json
{
  "data": [ /* deck objects */ ],
  "pagination": { "page": 1, "page_size": 24, "total": 1287, "has_more": true }
}
```

### `GET /decks/:id`

Returns one deck plus its cards.

Response (200):
```json
{
  "id": "uuid",
  "name": "Strong Hosts",
  "...": "...",
  "cards": [
    { "name": "Son of God \"Manger\"", "set": "Promo", "quantity": 1, "zone": "main" }
  ]
}
```

## Deck object fields

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | Stable identifier |
| `name` | string | |
| `description` | string \| null | |
| `format` | string \| null | |
| `paragon` | string \| null | |
| `card_count` | int | **Main zone only** — reserve and maybeboard not included |
| `is_legal` | bool | Computed at last save; may be stale after errata |
| `view_count` | int | Read-only via API; not incremented by `GET /decks/:id` |
| `username` | string \| null | |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |
| `url` | string | Canonical web URL |

## Card object fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | Full card name |
| `set` | string \| null | Set code |
| `quantity` | int | |
| `zone` | string | One of `main`, `reserve`, `maybeboard` |

`name + set` is the recommended join key against your own card data.

## Errors

All non-2xx responses:
```json
{ "error": { "code": "<code>", "message": "<message>" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Bad query params or malformed UUID |
| 401 | `unauthorized` | Missing, invalid, or revoked API key |
| 404 | `deck_not_found` | Deck doesn’t exist or isn’t public. **Do not retry.** |
| 429 | `rate_limit_exceeded` | See `retry_after_seconds` and `Retry-After` |
| 500 | `internal_error` | Unexpected server error |

## CORS

`Access-Control-Allow-Origin: *` on every response. Bearer tokens must be sent in the
`Authorization` header (never via query string).

## Versioning

This is **v1**. Breaking changes (renaming fields, removing fields, changing types, adding
required params) will land at `/api/v2` with v1 kept running for a deprecation window.
Adding new optional fields, new optional params, and new endpoints under `/api/v1` are
non-breaking.
```

- [ ] **Step 2: Commit**

```bash
git add docs/api/v1.md
git commit -m "Add public API v1 reference doc"
```

---

## Task 14: Final verification + open PR

- [ ] **Step 1: Full test suite**

```bash
npx vitest run
```
Expected: all green.

- [ ] **Step 2: Type-check + production build**

```bash
npx tsc --noEmit
npm run build
```
Expected: clean.

- [ ] **Step 3: Manual sanity pass**

Re-run the curl checks from Task 12 against the dev server one final time. Confirm:
- A revoked key (revoke via UI) immediately returns 401 on the next request.
- A new deck published via the UI appears in the list within one revalidation.
- `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600` is on the 200 responses; not on 401/429.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin <branch>
gh pr create --title "Public Deck API v1" --body "$(cat <<'EOF'
## Summary
- New read-only public API at `/api/v1/decks` and `/api/v1/decks/:id`.
- Required API keys (rtt_…) managed at `/account/api-keys`.
- Upstash-backed rate limiting (60/min, 10k/day per key).
- `unstable_cache` + edge `Cache-Control` for performant reads; tag-based invalidation hooked into existing deck mutations.

## Test plan
- [ ] Vitest suite green
- [ ] `npm run build` clean
- [ ] Manual curl smoke test (auth, 400/401/404/429 paths, OPTIONS preflight)
- [ ] Verify a public→private deck disappears from a subsequent list call

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review check (already applied)

- **Spec coverage:** Migration (T1), errors (T2), CORS (T3), auth (T4), rate-limit (T5), cache + validation (T6), list route (T7), detail route (T8), invalidation hooks (T9), UI server action + page (T10–T11), curl smoke (T12), reference doc (T13), build/PR (T14). All spec sections map to a task.
- **No placeholders:** Every step shows the actual code or command.
- **Type consistency:** `ParsedKey`, `VerifiedKey`, `RateLimitResult`, `ListParams`, `DeckPayload`, `ListPayload`, `DetailPayload`, `ApiKeyRow` flow consistently across tasks. Function names (`extractBearerToken`, `verifyApiKey`, `touchLastUsedAt`, `rateLimitForKey`, `rateLimitForUnauthIp`, `extractClientIp`, `parseListParams`, `isUuid`, `loadPublicDecksList`, `loadPublicDeckDetail`, `withCors`, `preflightResponse`, `errorResponse`, `apiError`, `generateKey`, `createApiKeyAction`, `revokeApiKeyAction`) match where they're defined and where they're imported.
- **Note re. service-role:** The spec says "use the anon client for deck reads." That holds in `lib/api/cache.ts`. The auth check itself in `lib/api/auth.ts` uses the service-role admin client to look up `api_keys` — this is intentional because the request is unauthenticated from Supabase's POV (no cookie); RLS on `api_keys` would otherwise deny anon SELECTs. The service-role key is scoped to that one file. This is consistent with the spec's "single helper" language for elevated access.
