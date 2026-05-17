# Public Deck API — Design

**Status:** Draft
**Date:** 2026-05-17
**Owner:** @timothestes

## Goal

Expose community (public) deck data to third-party tools and sites via a stable, documented, read-only HTTP API. Authenticated with required API keys, rate-limited per key, cached aggressively at the edge.

Non-goals: writes, search, tag/tournament filters, public docs site, usage dashboard, exposure of any private deck data.

## Audience & contract

Third-party tools (deck viewers, analytics, Discord bots, judging tools). This means a versioned, stable contract — breaking changes require a `v2`.

## Endpoints

All endpoints are read-only and mounted under `/api/v1/`.

### `GET /api/v1/decks`

Paginated list of public deck metadata. No card lists in the response.

**Query parameters:**

| Param | Type | Default | Constraints |
|---|---|---|---|
| `page` | int | `1` | ≥ 1, capped at `1000` (avoids `OFFSET 10_000_000`). |
| `page_size` | int | `24` | Allowed values: `24`, `50`, or `100` only (allowlist). Other values → 400. |
| `format` | string | — | e.g. `Type 1`, `Type 2`, `Classic`. `Type 1` also matches decks with `format IS NULL` (legacy default). This is preserved for parity with the existing community page. Consumers wanting strict matching should compare against `format` in the response. |
| `username` | string | — | Exact match against `profiles.username`. |
| `sort` | enum | `newest` | One of: `newest`, `most_viewed`, `name`. Unknown values → 400 (do not silently fall back to `newest`). Every `sort` has an implicit secondary `ORDER BY id ASC` tiebreaker so pagination is deterministic when sort values tie. |

These constraints are also the cache-key dimensions, which is why the surface is intentionally narrow.

**Response 200:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Strong Hosts",
      "description": "…",
      "format": "Type 1",
      "paragon": "…",
      "card_count": 100,
      "is_legal": true,
      "view_count": 42,
      "username": "timothestes",
      "created_at": "2026-04-01T12:00:00Z",
      "updated_at": "2026-05-10T08:00:00Z",
      "url": "https://landofredemption.com/decklist/<id>"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 24,
    "total": 1287,
    "has_more": true
  }
}
```

### `GET /api/v1/decks/:id`

Single public deck with embedded card list.

**Response 200:** same deck object as the list endpoint, plus:

```json
{
  "cards": [
    {
      "name": "Son of God \"Manger\"",
      "set": "Promo",
      "quantity": 1,
      "zone": "main"
    }
  ]
}
```

`zone` is one of `main`, `reserve`, or `maybeboard` (mirrors `deck_cards.zone`). All zones are included; consumers filter as needed. The maybeboard is a user's "considering" list — many consumers will want to ignore it.

Cards are returned in their stored order (deck order). No card-database enrichment in v1 — consumers join `name + set` against their own card data.

### Behavior notes

- `card_count` reflects the main zone only — reserve and maybeboard cards are not included.
- `is_legal` is computed at the deck's last save; may be stale relative to current REG/errata until the deck is re-saved.
- `view_count` — `GET /api/v1/decks/:id` **does not** increment `view_count`. View count is bumped only by the web UI; the API exposes the current value but treats it as read-only. (This also avoids cache-thrash on detail reads.)

### Fields intentionally excluded

- `user_id` — leak vector; `username` is the public identifier.
- `preview_card_1`, `preview_card_2` — internal UI thumbnails.
- `card_img_file` on `deck_cards` — internal display detail.

### Legality

No filtering on `is_legal`. All `is_public = true` decks are returned; each response includes the `is_legal` flag so consumers can filter themselves.

## Authentication

**Required API keys.** Every request must include:

```
Authorization: Bearer rtt_<random>
```

- Key format: the random portion is `crypto.randomBytes(32)` encoded as base64url (43 chars), giving 256 bits of entropy. The full key is `rtt_<43-char base64url>`. The `rtt_` prefix makes leaked keys greppable.
- Full key is shown **once** at creation. Only the SHA-256 hash is stored.
- Verification is a single indexed lookup: `WHERE key_hash = sha256(presented_key) AND revoked_at IS NULL`. Any in-process byte comparison uses `crypto.timingSafeEqual`.
- Failed auth → `401`.

### Schema

```sql
CREATE TABLE api_keys (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,           -- first 8 chars of the random portion (after the rtt_ prefix), for UI identification
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
-- No DELETE policy — revocation is a soft-delete via UPDATE.
```

- Max **5 active keys per user** (enforced in the create action).
- Revocation = soft delete (`revoked_at = NOW()`). Revoked keys reject on the next request.
- `last_used_at` is updated opportunistically on successful auth: the update runs via `import { after } from "next/server"` so it doesn't block the response.

### Management UI

New page at `/account/api-keys`:

- Table of keys: name, masked prefix (`rtt_abcd1234…`), `created_at`, `last_used_at`, revoke button.
- "Create new key" modal: prompts for a label, then displays the full key once with a copy button and a clear warning ("you won't see this again").
- After creation, the full key is displayed in a modal with a copy button. If the user dismisses the modal, the key is **unrecoverable** — they must revoke and create a new one. A warning to that effect appears in the modal.
- Copy button uses the Clipboard API; falls back to a focused, selected `<input>` if unavailable.
- Attempting to create a 6th active key shows an inline error in the create modal: "Maximum of 5 active API keys. Revoke one to create another." No silent failure.
- Revoke confirms before soft-deleting.

Server actions live in `app/account/api-keys/actions.ts`.

## Rate limiting

**Single flat tier per API key:**

- 60 requests / minute
- 10,000 requests / day

Both checked on every request; the stricter wins.

**Backend:** Upstash Redis via `@upstash/ratelimit` (provisioned through the Vercel Marketplace).

**Identifier:** `api_key:<key_hash_prefix>` for authenticated requests. Unauthenticated probes (missing/invalid bearer) are also rate-limited by IP (`ip:<x-vercel-forwarded-for>`, 30/min) before the 401 — prevents key-guessing.

Both route handlers set `export const runtime = "nodejs"` (not edge) so the keep-alive pool to Upstash is reused.

**Headers on every API response:**

```
X-RateLimit-Limit:     60
X-RateLimit-Remaining: 47
X-RateLimit-Reset:     1715961600
```

`X-RateLimit-Reset` is a Unix epoch timestamp in seconds (UTC).

**429 response body:**

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Retry after 23s.",
    "retry_after_seconds": 23
  }
}
```

Also sets `Retry-After: 23` (seconds).

Lives in `lib/api/rateLimit.ts`. Called from each route handler (not global middleware) so the rest of the site is untouched.

## Caching

The public-deck dataset changes infrequently and responses are identical for every caller — ideal for edge caching.

**Strategy:** Next.js 15.2's stable `unstable_cache` from `next/cache` wraps the data-loading functions in `lib/api/cache.ts` with explicit `tags` for precise invalidation via `revalidateTag`.

| Function | Cache key inputs | Tags | `revalidate` |
|---|---|---|---|
| `loadPublicDecksList(params)` | `page`, `page_size`, `format`, `username`, `sort` | `public-decks-list` | `300` (5 minutes) |
| `loadPublicDeckDetail(id)` | `id` | `public-decks-list`, `public-deck:<id>` | `3600` (1 hour) |

Cached loaders are constructed as `unstable_cache(fn, keyParts, { tags: [...], revalidate: <seconds> })`. The cached `loadPublicDecksList` performs the `profiles.username` join in a single query (`profiles!inner(username)`) so there's no N+1 inside the cache boundary. When `?username=foo` is provided, the profile lookup to resolve `user_id` happens inside the cached function (cache key is the raw `username` string).

Cache keys are derived from the (clamped) query parameters only, never from the `Authorization` header. The same cached payload is reused across all callers.

**Invalidation** (added to existing actions in `app/decklist/actions.ts`) uses `revalidateTag` from `next/cache`:

| Trigger | Tags invalidated |
|---|---|
| Deck published or unpublished | `public-decks-list`, `public-deck:<id>` |
| Public deck metadata edited (name, description, format, paragon) | `public-decks-list`, `public-deck:<id>` |
| Public deck deleted | `public-decks-list`, `public-deck:<id>` |
| Cards added/removed/edited on a public deck | `public-deck:<id>` only |
| `view_count` increment | none (intentionally stale; up to 5 min lag is acceptable) |

**Interaction with auth/rate-limit:** auth check, rate-limit check, and header injection happen in the route handler **outside** the cached function. The cached function returns only the response body, so the same payload is reused across all callers.

401 and 429 responses are never cached — they short-circuit before the cached call.

**Edge CDN header:** 200 responses set `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600` so Vercel's edge CDN caches the JSON across regions. `unstable_cache` is in-function only — without this header every region's first request hits origin. 401, 429, and 5xx responses do not set this header.

## Errors

All non-2xx responses use the same envelope:

```json
{
  "error": {
    "code": "deck_not_found",
    "message": "No public deck with id 'abc' exists."
  }
}
```

| Status | Code | When |
|---|---|---|
| `400` | `invalid_request` | Invalid query params (bad `page_size`, unknown `sort`, etc.) |
| `401` | `unauthorized` | Missing, malformed, invalid, or revoked API key |
| `404` | `deck_not_found` | Deck doesn't exist **or** exists but `is_public = false` (not distinguished — prevents probing for private IDs). `GET /api/v1/decks/:id` validates `id` as a UUID format **before** the DB lookup. Malformed IDs return `400 invalid_request`. Valid UUIDs for non-existent or private decks return `404 deck_not_found` (the two paths are not distinguished — see Security). |
| `429` | `rate_limit_exceeded` | Rate limit hit |
| `500` | `internal_error` | Unexpected server error |

Helpers in `lib/api/errors.ts`.

## Security

- Route handlers use the **anon** Supabase client. The existing RLS policy on `decks` already restricts anon reads to `is_public = true` rows, making RLS the primary enforcement. The `.eq("is_public", true)` filter in code remains as defense-in-depth. If a `profiles.username` join requires elevated access at query time, isolate it behind a single helper in `lib/api/db.ts` with assertion tests; otherwise use the anon client throughout.
- API keys are never logged. Only the first 8 chars (`key_prefix`) appear in logs or admin UIs.
- The only user-identifying field returned is `username`. Email, `user_id`, and any auth metadata are never exposed.
- CORS: routes export an `OPTIONS` handler returning `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS`, `Access-Control-Allow-Headers: Authorization`, `Access-Control-Max-Age: 86400`. OPTIONS is **not** auth-gated or rate-limited (browsers send it before the bearer header). 200 responses on `GET` also include `Access-Control-Allow-Origin: *`. The API never accepts the bearer key via query string. Do NOT send `Access-Control-Allow-Credentials`.
- CORS header injection lives in `lib/api/cors.ts` and is applied to every response (200, 401, 429, OPTIONS).

## File layout

```
app/api/v1/decks/route.ts             ← list endpoint
app/api/v1/decks/[id]/route.ts        ← detail endpoint
app/account/api-keys/page.tsx         ← key management UI
app/account/api-keys/actions.ts       ← create/revoke server actions
lib/api/auth.ts                       ← bearer-token verification
lib/api/rateLimit.ts                  ← Upstash wrapper
lib/api/cache.ts                      ← cached loaders + tag helpers
lib/api/errors.ts                     ← error envelope helpers
supabase/migrations/030_create_api_keys.sql  ← api_keys table + RLS
docs/api/v1.md                        ← consumer-facing reference
```

## Testing

- **Unit:** error envelope helpers, key hashing, rate-limit identifier derivation.
- **Integration (against a test Supabase project):**
  - Auth: missing key → 401; valid key → 200; revoked key → 401.
  - Scope: cannot fetch a private deck by id (404).
  - Filters: each query param exercised; bad inputs return 400.
  - Pagination: `total`, `has_more`, and boundary cases.
  - Rate limit: 61st request in a minute returns 429 with correct headers.
  - Cache invalidation: making a deck private removes it from a subsequent list response within one revalidation.
  - Cache invalidation on deck deletion: deleting a public deck removes it from a subsequent list response (assert via `revalidateTag` call site mock — do not assert via wall-clock).
  - Profile deletion tombstoning: if a user's profile is deleted, their previously-public decks either no longer appear in list responses or appear with `username: null` (pick one and assert).

## Out of scope for v1

- Search (`?search=`), tag filters (`?tags=`), tournament-only filter.
- Per-key tier system (a single flat tier ships; tiers can be added without breaking the contract).
- Public docs site / Swagger / OpenAPI export. v1 ships with `docs/api/v1.md` only.
- Usage analytics UI. `last_used_at` is stored; a per-user dashboard is post-v1.
- Webhooks, write endpoints, user-resource endpoints, card-data endpoint.

## Open questions resolved during design

- **Approach:** Next.js Route Handlers (vs Supabase Edge Functions vs PostgREST). Chosen for stack fit and contract control.
- **Auth:** Required API keys (vs anonymous or optional keys). Chosen for abuse control and per-key analytics.
- **Card payload:** Raw `name + set + quantity + zone` (vs enriched with card-DB fields). Chosen to keep the contract small and avoid committing to a card-data schema.
- **Cards location:** Embedded in `GET /decks/:id` (vs separate `/cards` sub-resource). Chosen so a typical consumer gets the full deck in one request.
- **Filter surface:** Core only — page/page_size/format/username/sort. Search, tags, and tournament filters deferred.
- **Rate limits:** Single flat tier — 60/min, 10k/day.
- **Legality filter:** None. `is_legal` is returned so consumers can filter themselves.
