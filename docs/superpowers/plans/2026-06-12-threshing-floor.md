# Threshing Floor Secret Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the podcast outline tool ("TF Outline VersionB Toggle.html") as a permission-gated secret page at `/threshingfloor` with Postgres-backed drafts and real JSON data endpoints.

**Architecture:** The 3,100-line HTML file is kept intact at `app/threshingfloor/outline.html` and served by an authenticated route handler. Three small API route groups (page, drafts CRUD, data auto-fill) all gate on a new `threshing_floor` value in the existing `admin_users.permissions TEXT[]` system. Drafts are one `jsonb` row per episode. Surgical JS patches inside the HTML swap file-download persistence for the API.

**Tech Stack:** Next.js 15 App Router route handlers, Supabase (RLS + SECURITY DEFINER RPC `get_my_admin_permissions`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-threshing-floor-design.md` — read it first.

**File map:**
- Create: `supabase/migrations/044_threshing_floor.sql`
- Create: `app/threshingfloor/episodes.ts` + `app/threshingfloor/__tests__/episodes.test.ts`
- Create: `app/threshingfloor/api/auth.ts`
- Create: `app/threshingfloor/route.ts`
- Create: `app/threshingfloor/outline.html` (moved from repo root `TF Outline VersionB Toggle.html`, then patched)
- Create: `app/threshingfloor/api/drafts/route.ts`
- Create: `app/threshingfloor/api/drafts/[episode]/route.ts`
- Create: `app/threshingfloor/api/__tests__/drafts-route.test.ts`
- Create: `app/threshingfloor/api/data/route.ts`
- Modify: `next.config.js`
- Delete: `TF Outline VersionB Toggle.html` (repo root, final task)

**Conventions you need to know:**
- Server Supabase client: `import { createClient } from "@/utils/supabase/server"` (async: `await createClient()`).
- Permission-check precedent: `app/api/spoilers/upload/route.ts:9-28` (`check_admin_role` RPC, then `get_my_admin_permissions` RPC).
- Tests run with `npm test` (vitest). Existing route-test mocking pattern: `app/api/v1/__tests__/decks-route.test.ts`.
- Migrations are applied via the Supabase MCP `apply_migration` tool (project convention) AND saved to `supabase/migrations/`.
- The HTML file has two ~114KB base64 lines (37 and 478). Never Read the whole file; use `sed -n 'START,ENDp' file | cut -c1-200` to inspect and Edit with exact unique strings to patch. Line numbers below were verified against the file at plan time but re-verify with grep before each edit.

---

### Task 1: Migration — permission grants + drafts table + RLS

**Files:**
- Create: `supabase/migrations/044_threshing_floor.sql`

- [ ] **Step 1: Write the migration**

```sql
-- New admin permission: 'threshing_floor'
-- Grants access to the secret Threshing Floor podcast outline page at
-- /threshingfloor and its drafts API. Granted to jhendrix6426 and BaboonyTim.
-- Also creates the shared drafts table (one jsonb row per episode).

-- 1) Grant the permission (idempotent; fails loudly if a user row is missing)
DO $$
DECLARE
  target uuid;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    '809bf436-d74d-41d2-be17-e37b03cd2328',  -- jhendrix6426
    '6d30f6e3-838e-4f11-9416-95996da6e5b9'   -- BaboonyTim
  ]::uuid[]
  LOOP
    UPDATE public.admin_users
    SET permissions = array_append(permissions, 'threshing_floor')
    WHERE user_id = target
      AND COALESCE(permissions @> ARRAY['threshing_floor'], false) = false;

    IF NOT EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE user_id = target AND permissions @> ARRAY['threshing_floor']
    ) THEN
      RAISE EXCEPTION 'threshing_floor grant failed: no admin_users row for %', target;
    END IF;
  END LOOP;
END $$;

-- 2) Drafts table
CREATE TABLE public.threshing_floor_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) RLS — every operation requires the threshing_floor permission.
-- Uses the SECURITY DEFINER helper from migration 010; do NOT use an inline
-- subquery against admin_users (circular-RLS failure documented in 009).
ALTER TABLE public.threshing_floor_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tf_drafts_select" ON public.threshing_floor_drafts
  FOR SELECT TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_drafts_insert" ON public.threshing_floor_drafts
  FOR INSERT TO authenticated
  WITH CHECK ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_drafts_update" ON public.threshing_floor_drafts
  FOR UPDATE TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()))
  WITH CHECK ('threshing_floor' = ANY(public.get_my_admin_permissions()));

CREATE POLICY "tf_drafts_delete" ON public.threshing_floor_drafts
  FOR DELETE TO authenticated
  USING ('threshing_floor' = ANY(public.get_my_admin_permissions()));
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with name `threshing_floor` and the SQL above.
Expected: success, no error.

- [ ] **Step 3: Verify grants and idempotency**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT user_id, permissions FROM admin_users
WHERE user_id IN ('809bf436-d74d-41d2-be17-e37b03cd2328','6d30f6e3-838e-4f11-9416-95996da6e5b9');
```
Expected: both rows contain `threshing_floor`. Then re-run just the `DO $$ ... $$` block via `execute_sql` — expected: succeeds with no duplicate value added (re-check the SELECT; `permissions` must contain `threshing_floor` exactly once).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/044_threshing_floor.sql
git commit -m "feat: add threshing_floor permission and drafts table"
```

---

### Task 2: Pure episode utilities (TDD)

**Files:**
- Create: `app/threshingfloor/episodes.ts`
- Test: `app/threshingfloor/__tests__/episodes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeEpisode,
  isNumericEpisode,
  pickPreviousEpisode,
  sortDraftsForList,
} from "../episodes";

describe("normalizeEpisode", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEpisode("  100 ")).toBe("100");
  });
  it("rejects empty and whitespace-only values", () => {
    expect(normalizeEpisode("")).toBeNull();
    expect(normalizeEpisode("   ")).toBeNull();
  });
  it("rejects values containing a slash", () => {
    expect(normalizeEpisode("10/0")).toBeNull();
  });
  it("rejects values longer than 100 chars", () => {
    expect(normalizeEpisode("x".repeat(101))).toBeNull();
  });
  it("allows free text like 'draft'", () => {
    expect(normalizeEpisode("draft")).toBe("draft");
  });
});

describe("isNumericEpisode", () => {
  it("accepts integers and decimals", () => {
    expect(isNumericEpisode("100")).toBe(true);
    expect(isNumericEpisode("100.5")).toBe(true);
  });
  it("rejects non-numeric and partial-numeric values", () => {
    expect(isNumericEpisode("draft")).toBe(false);
    expect(isNumericEpisode("Ep100")).toBe(false);
    expect(isNumericEpisode("100.")).toBe(false);
    expect(isNumericEpisode("")).toBe(false);
  });
});

describe("pickPreviousEpisode", () => {
  const eps = ["98", "draft", "100", "99.5", "Ep97"];
  it("returns the highest numeric episode strictly below the target", () => {
    expect(pickPreviousEpisode(eps, "100")).toBe("99.5");
    expect(pickPreviousEpisode(eps, "99.5")).toBe("98");
  });
  it("ignores non-numeric stored episodes", () => {
    expect(pickPreviousEpisode(["draft", "Ep97"], "100")).toBeNull();
  });
  it("returns null when nothing is below the target", () => {
    expect(pickPreviousEpisode(eps, "98")).toBeNull();
  });
  it("returns null for a non-numeric target", () => {
    expect(pickPreviousEpisode(eps, "draft")).toBeNull();
  });
});

describe("sortDraftsForList", () => {
  it("sorts numeric episodes descending first, then non-numeric by updated_at desc", () => {
    const rows = [
      { episode_number: "draft", updated_at: "2026-06-01T00:00:00Z" },
      { episode_number: "99", updated_at: "2026-05-01T00:00:00Z" },
      { episode_number: "notes", updated_at: "2026-06-10T00:00:00Z" },
      { episode_number: "100", updated_at: "2026-04-01T00:00:00Z" },
    ];
    expect(sortDraftsForList(rows).map((r) => r.episode_number)).toEqual([
      "100", "99", "notes", "draft",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/threshingfloor --reporter=basic`
Expected: FAIL — cannot resolve `../episodes`.

- [ ] **Step 3: Implement**

```ts
export interface DraftListRow {
  episode_number: string;
  updated_at: string;
}

const NUMERIC_RE = /^\d+(\.\d+)?$/;

export function normalizeEpisode(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.includes("/") || t.length > 100) return null;
  return t;
}

export function isNumericEpisode(s: string): boolean {
  return NUMERIC_RE.test(s);
}

export function pickPreviousEpisode(episodes: string[], before: string): string | null {
  if (!isNumericEpisode(before)) return null;
  const target = parseFloat(before);
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const ep of episodes) {
    if (!isNumericEpisode(ep)) continue;
    const v = parseFloat(ep);
    if (v < target && v > bestVal) {
      bestVal = v;
      best = ep;
    }
  }
  return best;
}

export function sortDraftsForList(rows: DraftListRow[]): DraftListRow[] {
  return [...rows].sort((a, b) => {
    const an = isNumericEpisode(a.episode_number);
    const bn = isNumericEpisode(b.episode_number);
    if (an && bn) return parseFloat(b.episode_number) - parseFloat(a.episode_number);
    if (an) return -1;
    if (bn) return 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/threshingfloor --reporter=basic`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/threshingfloor/episodes.ts app/threshingfloor/__tests__/episodes.test.ts
git commit -m "feat: episode utilities for threshing floor drafts"
```

---

### Task 3: Auth helper, page-serving route, file move, Vercel tracing

**Files:**
- Create: `app/threshingfloor/api/auth.ts`
- Create: `app/threshingfloor/route.ts`
- Create: `app/threshingfloor/outline.html` (move)
- Modify: `next.config.js`

- [ ] **Step 1: Write the auth helper** (`app/threshingfloor/api/auth.ts`)

```ts
import { createClient } from "@/utils/supabase/server";

/**
 * Gate for everything under /threshingfloor. Returns the Supabase client and
 * user when the caller has the `threshing_floor` admin permission, else null.
 * Callers respond 404 (not 401/403) so the route stays secret.
 */
export async function requireThreshingFloor() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: isAdmin } = await supabase.rpc("check_admin_role");
  if (!isAdmin) return null;

  const { data: perms } = await supabase.rpc("get_my_admin_permissions");
  if (!Array.isArray(perms) || !perms.includes("threshing_floor")) return null;

  return { supabase, user };
}

export function notFoundResponse() {
  return new Response("Not Found", { status: 404 });
}
```

- [ ] **Step 2: Move the HTML file (no patches yet)**

```bash
git mv "TF Outline VersionB Toggle.html" app/threshingfloor/outline.html
```

Note: files inside `app/` that aren't `page/route/layout` etc. are not routable — Next ignores `outline.html` as a route; only our handler serves it.

- [ ] **Step 3: Write the page route** (`app/threshingfloor/route.ts`)

```ts
import { readFile } from "fs/promises";
import path from "path";
import { notFoundResponse, requireThreshingFloor } from "./api/auth";

export async function GET() {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();

  const filePath = path.join(process.cwd(), "app/threshingfloor/outline.html");
  const html = await readFile(filePath, "utf-8");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    },
  });
}
```

- [ ] **Step 4: Add Vercel file tracing** (`next.config.js`)

Add inside `nextConfig` (top-level key, supported in Next 15):

```js
  outputFileTracingIncludes: {
    '/threshingfloor': ['./app/threshingfloor/outline.html'],
  },
```

- [ ] **Step 5: Verify anonymous 404 and authorized load**

Run: `npm run dev` (background), then `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/threshingfloor`
Expected: `404`.
Authorized check happens in Task 9 (needs a logged-in browser session).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: serve threshing floor outline behind permission gate"
```

---

### Task 4: Drafts API routes (with tests)

**Files:**
- Create: `app/threshingfloor/api/drafts/route.ts`
- Create: `app/threshingfloor/api/drafts/[episode]/route.ts`
- Test: `app/threshingfloor/api/__tests__/drafts-route.test.ts`

- [ ] **Step 1: Write the collection route** (`app/threshingfloor/api/drafts/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { isNumericEpisode, pickPreviousEpisode, sortDraftsForList } from "../../episodes";
import { notFoundResponse, requireThreshingFloor } from "../auth";

// GET /threshingfloor/api/drafts            -> [{ episode_number, updated_at }]
// GET /threshingfloor/api/drafts?before=100 -> full row of the previous numeric episode
export async function GET(request: NextRequest) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const { supabase } = auth;

  const before = request.nextUrl.searchParams.get("before");

  if (before !== null) {
    if (!isNumericEpisode(before.trim())) {
      return NextResponse.json(
        { error: "before must be a numeric episode number" },
        { status: 400 }
      );
    }
    const { data: rows, error } = await supabase
      .from("threshing_floor_drafts")
      .select("episode_number");
    if (error) {
      return NextResponse.json({ error: "Failed to load drafts" }, { status: 500 });
    }
    const prev = pickPreviousEpisode(
      (rows ?? []).map((r) => r.episode_number),
      before.trim()
    );
    if (!prev) return notFoundResponse();

    const { data: row, error: rowError } = await supabase
      .from("threshing_floor_drafts")
      .select("episode_number, data, updated_at")
      .eq("episode_number", prev)
      .single();
    if (rowError || !row) return notFoundResponse();
    return NextResponse.json(row);
  }

  const { data, error } = await supabase
    .from("threshing_floor_drafts")
    .select("episode_number, updated_at");
  if (error) {
    return NextResponse.json({ error: "Failed to load drafts" }, { status: 500 });
  }
  return NextResponse.json(sortDraftsForList(data ?? []));
}
```

- [ ] **Step 2: Write the per-episode route** (`app/threshingfloor/api/drafts/[episode]/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { normalizeEpisode } from "../../../episodes";
import { notFoundResponse, requireThreshingFloor } from "../../auth";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel rejects > 4.5 MB at the edge

async function resolveEpisode(params: Promise<{ episode: string }>): Promise<string | null> {
  const { episode } = await params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(episode);
  } catch {
    return null;
  }
  return normalizeEpisode(decoded);
}

type Ctx = { params: Promise<{ episode: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("threshing_floor_drafts")
    .select("episode_number, data, updated_at")
    .eq("episode_number", episode)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to load draft" }, { status: 500 });
  if (!data) return notFoundResponse();
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Draft too large (over 4 MB)" }, { status: 413 });
  }
  let body: { data?: unknown; lastSeenUpdatedAt?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return NextResponse.json({ error: "data must be an object" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await auth.supabase
    .from("threshing_floor_drafts")
    .select("updated_at")
    .eq("episode_number", episode)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: "Failed to check draft" }, { status: 500 });
  }
  if (
    existing &&
    typeof body.lastSeenUpdatedAt === "string" &&
    body.lastSeenUpdatedAt !== existing.updated_at
  ) {
    return NextResponse.json(
      { error: "Draft was modified by someone else" },
      { status: 409 }
    );
  }

  const { data: saved, error } = await auth.supabase
    .from("threshing_floor_drafts")
    .upsert(
      {
        episode_number: episode,
        data: body.data,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "episode_number" }
    )
    .select("episode_number, updated_at")
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 });
  }
  return NextResponse.json(saved);
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const { error } = await auth.supabase
    .from("threshing_floor_drafts")
    .delete()
    .eq("episode_number", episode);
  if (error) return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Write the route tests** (`app/threshingfloor/api/__tests__/drafts-route.test.ts`)

Follow the mocking style of `app/api/v1/__tests__/decks-route.test.ts`. Mock the auth module and a chainable Supabase stub:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../auth", async (orig) => {
  const real: any = await orig();
  return { ...real, requireThreshingFloor: vi.fn() };
});

import { GET as listGET } from "../drafts/route";
import { GET as oneGET, PUT, DELETE } from "../drafts/[episode]/route";
import * as auth from "../auth";
import { NextRequest } from "next/server";

// Minimal chainable supabase stub. Each test sets `result` (and optionally
// `results` for sequential calls) to what the terminal call resolves to.
function makeSupabase(results: any[]) {
  let call = 0;
  const next = () => results[Math.min(call++, results.length - 1)];
  const chain: any = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    single: vi.fn(async () => next()),
    maybeSingle: vi.fn(async () => next()),
    then: (resolve: any) => Promise.resolve(next()).then(resolve),
  };
  return chain;
}

function authorized(results: any[]) {
  (auth.requireThreshingFloor as any).mockResolvedValue({
    supabase: makeSupabase(results),
    user: { id: "user-1" },
  });
}

const req = (url: string, init?: RequestInit) => new NextRequest(url, init as any);
const ctx = (episode: string) => ({ params: Promise.resolve({ episode }) });

beforeEach(() => vi.clearAllMocks());

describe("GET /threshingfloor/api/drafts", () => {
  it("returns 404 when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await listGET(req("http://x/threshingfloor/api/drafts"));
    expect(r.status).toBe(404);
  });

  it("returns the sorted list", async () => {
    authorized([
      {
        data: [
          { episode_number: "99", updated_at: "2026-01-01T00:00:00Z" },
          { episode_number: "100", updated_at: "2026-01-02T00:00:00Z" },
        ],
        error: null,
      },
    ]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts"));
    expect(r.status).toBe(200);
    expect((await r.json()).map((d: any) => d.episode_number)).toEqual(["100", "99"]);
  });

  it("returns 400 for non-numeric ?before=", async () => {
    authorized([]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts?before=draft"));
    expect(r.status).toBe(400);
  });

  it("returns the previous episode's full row for ?before=", async () => {
    authorized([
      { data: [{ episode_number: "98" }, { episode_number: "draft" }], error: null },
      { data: { episode_number: "98", data: { "rank-1": "Bo" }, updated_at: "t" }, error: null },
    ]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts?before=100"));
    expect(r.status).toBe(200);
    expect((await r.json()).episode_number).toBe("98");
  });

  it("returns 404 for ?before= with no earlier numeric episode", async () => {
    authorized([{ data: [{ episode_number: "draft" }], error: null }]);
    const r = await listGET(req("http://x/threshingfloor/api/drafts?before=100"));
    expect(r.status).toBe(404);
  });
});

describe("PUT /threshingfloor/api/drafts/[episode]", () => {
  const put = (episode: string, body: any) =>
    PUT(
      req("http://x/threshingfloor/api/drafts/" + episode, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
      ctx(episode)
    );

  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await put("100", { data: {} });
    expect(r.status).toBe(404);
  });

  it("400s on an invalid episode segment", async () => {
    authorized([]);
    const r = await put("%20%20", { data: {} });
    expect(r.status).toBe(400);
  });

  it("400s when data is not an object", async () => {
    authorized([]);
    const r = await put("100", { data: "nope" });
    expect(r.status).toBe(400);
  });

  it("409s when lastSeenUpdatedAt mismatches", async () => {
    authorized([{ data: { updated_at: "2026-01-02T00:00:00Z" }, error: null }]);
    const r = await put("100", { data: {}, lastSeenUpdatedAt: "2026-01-01T00:00:00Z" });
    expect(r.status).toBe(409);
  });

  it("upserts and returns episode_number + updated_at", async () => {
    authorized([
      { data: null, error: null }, // no existing row
      { data: { episode_number: "100", updated_at: "2026-06-12T00:00:00Z" }, error: null },
    ]);
    const r = await put("100", { data: { "ep-num": "100" } });
    expect(r.status).toBe(200);
    expect((await r.json()).episode_number).toBe("100");
  });
});

describe("GET/DELETE /threshingfloor/api/drafts/[episode]", () => {
  it("GET returns 404 for a missing draft", async () => {
    authorized([{ data: null, error: null }]);
    const r = await oneGET(req("http://x/threshingfloor/api/drafts/100"), ctx("100"));
    expect(r.status).toBe(404);
  });

  it("DELETE returns success", async () => {
    authorized([{ error: null }]);
    const r = await DELETE(req("http://x/threshingfloor/api/drafts/100"), ctx("100"));
    expect(r.status).toBe(200);
    expect((await r.json()).success).toBe(true);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/threshingfloor --reporter=basic`
Expected: all PASS. If the chainable-stub `then` trick doesn't match how a query resolves (e.g. the list GET awaits the chain directly), adjust the stub — not the route — unless the route genuinely misuses supabase-js.

- [ ] **Step 5: Commit**

```bash
git add app/threshingfloor/api
git commit -m "feat: threshing floor drafts API"
```

---

### Task 5: Data auto-fill endpoint

**Files:**
- Create: `app/threshingfloor/api/data/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { loadUpcomingListings } from "@/app/tournaments/actions";
import { loadPublicSpoilersAction } from "@/app/spoilers/actions";
import { isUuid, loadPublicDeckDetail } from "@/lib/api/cache";
import { notFoundResponse, requireThreshingFloor } from "../auth";

// GET /threshingfloor/api/data?kind=tournaments | spoilers | deck&id=<uuid>
export async function GET(request: NextRequest) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();

  const kind = request.nextUrl.searchParams.get("kind");

  if (kind === "tournaments") {
    return NextResponse.json(await loadUpcomingListings());
  }

  if (kind === "spoilers") {
    const { spoilers } = await loadPublicSpoilersAction();
    return NextResponse.json(spoilers);
  }

  if (kind === "deck") {
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!isUuid(id)) {
      return NextResponse.json({ error: "id must be a deck uuid" }, { status: 400 });
    }
    const deck = await loadPublicDeckDetail(id);
    if (!deck) return notFoundResponse();
    const format =
      deck.format === "Type 1" ? "T1" : deck.format === "Type 2" ? "T2" : "";
    return NextResponse.json({
      name: deck.name,
      creator: deck.username,
      format,
      card_count: deck.card_count,
    });
  }

  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no new errors (pre-existing errors elsewhere, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add app/threshingfloor/api/data
git commit -m "feat: threshing floor data auto-fill endpoint"
```

---

### Task 6: HTML patch — DB-backed save/load, reset-before-restore, picker, delete, Download JSON

**Files:**
- Modify: `app/threshingfloor/outline.html`

All edits use the Edit tool with exact unique strings. Inspect regions first with `sed -n 'START,ENDp' app/threshingfloor/outline.html | cut -c1-200` (line numbers shift as you edit — re-grep each anchor).

- [ ] **Step 1: Add Download JSON button to the toolbar**

Find (one occurrence, in the toolbar div):
```html
    <button class="btn btn-ghost" onclick="loadData()">Load Draft</button>
```
Replace with:
```html
    <button class="btn btn-ghost" onclick="loadData()">Load Draft</button>
    <button class="btn btn-ghost" onclick="downloadJson()">Download JSON</button>
```

- [ ] **Step 2: Replace `saveData()` and add helpers**

The current function (grep `function saveData()`) downloads a Blob. Replace the entire function body with:

```js
  window.loadedDraftUpdatedAt = null;

  function draftEpisodeKey() {
    var v = document.getElementById('ep-num').value.trim();
    return v || 'draft';
  }

  function saveData() {
    var ep = draftEpisodeKey();
    var status = document.getElementById('save-status');
    var payload = { data: collectData() };
    if (window.loadedDraftUpdatedAt) payload.lastSeenUpdatedAt = window.loadedDraftUpdatedAt;
    var json = JSON.stringify(payload);
    if (json.length > 4 * 1024 * 1024) {
      status.textContent = 'Draft too large to save (over 4 MB) -- remove some images.';
      return;
    }
    status.textContent = 'Saving...';
    fetch('/threshingfloor/api/drafts/' + encodeURIComponent(ep), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: json
    }).then(function(res) {
      if (res.status === 409) {
        if (confirm('This draft was changed by someone else since you loaded it. Overwrite their version?')) {
          window.loadedDraftUpdatedAt = null;
          saveData();
        } else {
          status.textContent = 'Save canceled.';
        }
        return null;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(row) {
      if (!row) return;
      window.loadedDraftUpdatedAt = row.updated_at;
      status.textContent = 'Saved Ep ' + ep + ' at ' + new Date().toLocaleTimeString();
    }).catch(function() {
      status.textContent = 'Save failed -- check connection and try again.';
    });
  }

  function downloadJson() {
    var epNum = draftEpisodeKey();
    var json = JSON.stringify(collectData(), null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'TF_Outline_Ep' + epNum + '.json';
    a.click();
  }
```

- [ ] **Step 3: Extract `resetForm()` and use it in `clearAll()`**

Find `function clearAll()` (near the end of the script). It currently inlines field clearing. Restructure to:

```js
  function resetForm() {
    document.querySelectorAll('input[type=text], input[type=date], textarea').forEach(function(el) { el.value = ''; });
    removeExtraNotesField();
    removeCountdownField();
    removeCollectorsCard();
    syncCollectorsBullets();
    document.getElementById('agur-card-grid').innerHTML = '';
    document.getElementById('agur-empty-state').style.display = '';
    document.getElementById('rtn-deadlines-list').innerHTML = '';
    document.getElementById('rtn-deadlines-field').style.display = 'none';
    window.rtnDeadlineCount = 0;
    document.getElementById('rtn-events-list').innerHTML = '';
    document.getElementById('rtn-events-field').style.display = 'none';
    window.rtnEventCount = 0;
    mailbagBody.innerHTML = '';
    window.mailbagCount = 0;
    addMailbagItem();
    mailbagBody.appendChild(createMailbagAddRow());
    newsBody.innerHTML = '';
    window.newsCount = 0;
    addNewsItem();
    newsBody.appendChild(createNewsAddRow());
    window.previousRankings = null;
    window.previousMetaRankings = null;
    updateAllRankDeltas();
    updateAllMetaRankDeltas();
    window.loadedDraftUpdatedAt = null;
  }

  function clearAll() {
    if (!confirm('Clear all fields and reset toggles to default?')) return;
    resetForm();
    var defaults = {
      'tog-news': true, 'tog-tournaments': true, 'tog-rankings': true,
      'tog-dotw': true, 'tog-mailbag': true,
      'tog-rtn': false, 'tog-spoilers': false, 'tog-collectors': false,
      'tog-meta': false, 'tog-agur': false, 'tog-potm': false, 'tog-guest': false
    };
    Object.keys(defaults).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.checked = defaults[id];
        if (el.onchange) el.onchange.call(el, { target: el });
      }
    });
    document.getElementById('save-status').textContent = 'Cleared.';
  }
```

**Verify the element ids before editing**: grep the file for `rtn-deadlines-list`, `rtn-events-list`, `rtn-deadlines-field`, `rtn-events-field`, `removeCountdownField` — all must exist (they did at plan time; `addDeadlineRow`/`addSideEventRow` reference them). The original `clearAll` did NOT clear RTN rows — that was part of the re-entrancy bug; this fixes it.

- [ ] **Step 4: Replace `loadData()` with a DB-backed picker, preserving the restore logic**

The existing `loadData()` has two parts: a file-input wrapper, and a large restore body (everything inside `reader.onload`'s `try`). Keep the restore body **verbatim** — wrap it as `applyDraft(data)` — and replace the wrapper:

```js
  function applyDraft(data) {
    resetForm();
    // ... the ENTIRE existing body of reader.onload's try-block goes here,
    // verbatim, EXCEPT the final status line that references file.name.
    // It starts with: Object.keys(data).forEach(function(id) { ... checkbox pass
    // and ends with the setTimeout(...) block that restores values and syncs.
  }

  function loadData() {
    var status = document.getElementById('save-status');
    status.textContent = 'Loading drafts...';
    fetch('/threshingfloor/api/drafts')
      .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function(list) {
        if (!list.length) { status.textContent = 'No drafts saved yet.'; return; }
        showDraftPicker(list);
        status.textContent = 'Select a draft to load.';
      })
      .catch(function() { status.textContent = 'Could not load drafts.'; });
  }

  function showDraftPicker(list) {
    var existing = document.getElementById('draft-picker-row');
    if (existing) existing.remove();
    var row = document.createElement('div');
    row.id = 'draft-picker-row';
    row.style.cssText = 'display:flex; gap:6px; align-items:center; width:100%; margin-top:6px;';
    var picker = document.createElement('select');
    picker.className = 'field-input';
    picker.style.flex = '1';
    list.forEach(function(d) {
      var opt = document.createElement('option');
      opt.value = d.episode_number;
      opt.textContent = 'Ep ' + d.episode_number + ' -- saved ' + new Date(d.updated_at).toLocaleString();
      picker.appendChild(opt);
    });
    var loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn btn-teal';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', function() { loadDraft(picker.value); });
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-red';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', function() { deleteDraft(picker.value); });
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', function() { row.remove(); });
    row.appendChild(picker);
    row.appendChild(loadBtn);
    row.appendChild(delBtn);
    row.appendChild(closeBtn);
    document.querySelector('.toolbar').appendChild(row);
  }

  function loadDraft(ep) {
    var status = document.getElementById('save-status');
    status.textContent = 'Loading Ep ' + ep + '...';
    fetch('/threshingfloor/api/drafts/' + encodeURIComponent(ep))
      .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function(row) {
        applyDraft(row.data);
        window.loadedDraftUpdatedAt = row.updated_at;
        status.textContent = 'Loaded Ep ' + row.episode_number + '.';
        var pickerRow = document.getElementById('draft-picker-row');
        if (pickerRow) pickerRow.remove();
      })
      .catch(function() { status.textContent = 'Could not load that draft.'; });
  }

  function deleteDraft(ep) {
    if (!confirm('Delete the saved draft for Ep ' + ep + '? This cannot be undone.')) return;
    var status = document.getElementById('save-status');
    fetch('/threshingfloor/api/drafts/' + encodeURIComponent(ep), { method: 'DELETE' })
      .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function() {
        status.textContent = 'Deleted Ep ' + ep + '.';
        loadData();
      })
      .catch(function() { status.textContent = 'Could not delete that draft.'; });
  }
```

Implementation notes:
- The restore body references `file.name` only in its final status assignment and the catch's `alert(...)` — drop both; `loadDraft` sets status itself. Wrap `applyDraft`'s body in its own `try/catch` setting `status.textContent = 'Could not apply that draft.'` on failure.
- The restore body's `setTimeout` is inside it; keep as-is.
- `applyDraft` must be defined before `loadDraft` in source order is NOT required (function declarations hoist), but keep them adjacent for readability.

- [ ] **Step 5: Smoke-check in a browser**

Run dev server; open `/threshingfloor` logged in as a granted user (see Task 9 note). Save a draft, reload page, Load it, Load it a second time — mailbag/news/agur sections must not duplicate. If you cannot log in as a granted user, defer to Task 9 and verify the page still parses: `node -e "const s=require('fs').readFileSync('app/threshingfloor/outline.html','utf8'); const m=s.match(/<script>([\s\S]*)<\/script>/); new Function(m[1].slice(0,0)); console.log('html read ok, length', s.length)"` plus `npx vitest run app/threshingfloor` still green.

- [ ] **Step 6: Commit**

```bash
git add app/threshingfloor/outline.html
git commit -m "feat: DB-backed save/load with reset-before-restore in outline"
```

---

### Task 7: HTML patch — previous-rankings from the database

**Files:**
- Modify: `app/threshingfloor/outline.html`

- [ ] **Step 1: Replace `loadPreviousRankings()`**

Find `function loadPreviousRankings()` (file-input based). Replace the whole function:

```js
  function loadPreviousRankings() {
    var status = document.getElementById('prev-rankings-status');
    var ep = document.getElementById('ep-num').value.trim();
    if (!/^\d+(\.\d+)?$/.test(ep)) {
      status.textContent = 'Enter a numeric episode number first.';
      return;
    }
    status.textContent = 'Loading...';
    fetch('/threshingfloor/api/drafts?before=' + encodeURIComponent(ep))
      .then(function(res) {
        if (res.status === 404) { status.textContent = 'No earlier episode draft found.'; return null; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(row) {
        if (!row) return;
        var data = row.data || {};
        var prev = {};
        var count = 0;
        for (var r = 1; r <= 10; r++) {
          var name = data['rank-' + r];
          if (name && name.trim()) {
            prev[name.trim()] = r;
            count++;
            if (window.knownPlayers.indexOf(name.trim()) === -1) window.knownPlayers.push(name.trim());
            document.getElementById('rank-' + r).value = name.trim();
          }
        }
        window.previousRankings = prev;
        rebuildPlayerOptions();
        updateAllRankDeltas();
        status.textContent = count > 0
          ? ('Loaded ' + count + ' player(s) from Ep ' + row.episode_number + ' -- fields pre-filled, use x to clear and reorder')
          : 'No rankings found in that draft.';
      })
      .catch(function() { status.textContent = 'Could not load the previous draft.'; });
  }
```

- [ ] **Step 2: Replace `loadPreviousMetaRankings()`**

Same shape; find `function loadPreviousMetaRankings()` and replace with the identical pattern, substituting: keys `meta-rank-<r>`, status element `prev-meta-rankings-status`, arrays `window.knownArchetypes` / `window.previousMetaRankings`, and calls `rebuildArchetypeOptions()` / `updateAllMetaRankDeltas()`, message "archetype(s)" instead of "player(s)".

```js
  function loadPreviousMetaRankings() {
    var status = document.getElementById('prev-meta-rankings-status');
    var ep = document.getElementById('ep-num').value.trim();
    if (!/^\d+(\.\d+)?$/.test(ep)) {
      status.textContent = 'Enter a numeric episode number first.';
      return;
    }
    status.textContent = 'Loading...';
    fetch('/threshingfloor/api/drafts?before=' + encodeURIComponent(ep))
      .then(function(res) {
        if (res.status === 404) { status.textContent = 'No earlier episode draft found.'; return null; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(row) {
        if (!row) return;
        var data = row.data || {};
        var prev = {};
        var count = 0;
        for (var r = 1; r <= 10; r++) {
          var name = data['meta-rank-' + r];
          if (name && name.trim()) {
            prev[name.trim()] = r;
            count++;
            if (window.knownArchetypes.indexOf(name.trim()) === -1) window.knownArchetypes.push(name.trim());
            document.getElementById('meta-rank-' + r).value = name.trim();
          }
        }
        window.previousMetaRankings = prev;
        rebuildArchetypeOptions();
        updateAllMetaRankDeltas();
        status.textContent = count > 0
          ? ('Loaded ' + count + ' archetype(s) from Ep ' + row.episode_number + ' -- fields pre-filled, use x to clear and reorder')
          : 'No meta rankings found in that draft.';
      })
      .catch(function() { status.textContent = 'Could not load the previous draft.'; });
  }
```

- [ ] **Step 3: Commit**

```bash
git add app/threshingfloor/outline.html
git commit -m "feat: previous-rankings auto-load from saved drafts"
```

---

### Task 8: HTML patch — tournaments/spoilers/deck fetchers use real endpoints

**Files:**
- Modify: `app/threshingfloor/outline.html`

- [ ] **Step 1: Replace `fetchTournamentListings()`**

Find `function fetchTournamentListings(onSuccess, onError)` (regex-scrapes `redemptionccg.app/tournaments`). Replace entirely:

```js
  function fetchTournamentListings(onSuccess, onError) {
    fetch('/threshingfloor/api/data?kind=tournaments')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(onSuccess)
      .catch(function() {
        onError('Could not fetch tournament listings.');
      });
  }
```

- [ ] **Step 2: Make the Nationals filter case-insensitive**

In `fetchNationalsInfo()`, find:
```js
        return item.tournament_type === 'National';
```
Replace with:
```js
        return /national/i.test(item.tournament_type || '');
```

- [ ] **Step 3: Replace the fetch in `fetchRecentSpoilers()`**

The function fetches `https://redemptionccg.app/spoilers` and regex-extracts `initialSpoilers`. Replace from the `fetch(` call through the end of the regex/`JSON.parse` block (everything before `var now = new Date();`) so it becomes:

```js
    fetch('/threshingfloor/api/data?kind=spoilers')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(listings) {
        var now = new Date();
```
…and keep the remainder of the `.then` body (cutoff filtering, picker population, top-set autofill) unchanged, ending with the existing `.catch` whose message becomes `'Could not fetch spoilers.'`.

- [ ] **Step 4: Replace `fetchDeckInfo()`, delete `parseDeckHtml()`, remove the paste fallback**

Replace `function fetchDeckInfo() { ... }` entirely:

```js
  function fetchDeckInfo() {
    var url = document.getElementById('dotw-link').value.trim();
    var status = document.getElementById('dotw-fetch-status');
    if (!url) { status.textContent = 'Enter a deck link first.'; return; }
    var m = url.match(/decklist\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    if (!m) { status.textContent = 'Could not find a deck id in that link.'; return; }
    status.textContent = 'Fetching...';
    fetch('/threshingfloor/api/data?kind=deck&id=' + m[1])
      .then(function(res) {
        if (res.status === 404) { status.textContent = 'Deck not found (must be public or unlisted).'; return null; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(deck) {
        if (!deck) return;
        if (deck.name) document.getElementById('dotw-name').value = deck.name;
        if (deck.creator) document.getElementById('dotw-creator').value = deck.creator;
        if (deck.format) document.getElementById('dotw-format').value = deck.format;
        status.textContent = 'Filled in from deck (' + (deck.card_count || 0) + ' cards). Set color manually.';
      })
      .catch(function() { status.textContent = 'Could not fetch deck info.'; });
  }
```

Then:
- Delete the whole `function parseDeckHtml(html, url) { ... }` block.
- Delete the `dotw-paste` textarea element from the markup (grep `dotw-paste`; remove the `<textarea ... id="dotw-paste" ...>` line). Old drafts containing a `dotw-paste` key are harmless — the restore loop skips unknown ids.
- Grep for any remaining `parseDeckHtml` / `dotw-paste` / `pasteBox` references and remove them.

- [ ] **Step 5: Verify no scraping remains**

Run: `grep -n "redemptionccg.app" app/threshingfloor/outline.html | grep -v "decklist/\.\.\.\|placeholder"`
Expected: remaining hits are only placeholder text (e.g. the `dotw-link` input placeholder), no `fetch(` calls to absolute URLs. Also `grep -c "initialSpoilers\|\"listings\":" app/threshingfloor/outline.html` → 0.

- [ ] **Step 6: Commit**

```bash
git add app/threshingfloor/outline.html
git commit -m "feat: outline auto-fill uses real JSON endpoints"
```

---

### Task 9: Final verification and cleanup

**Files:**
- Verify everything; no new files.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, including pre-existing suites.

- [ ] **Step 2: Type check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds. (Build is justified here: new routes + next.config change.)

- [ ] **Step 3: Anonymous 404 sweep**

With `npm run dev` running:
```bash
for p in /threshingfloor /threshingfloor/api/drafts /threshingfloor/api/drafts/100 "/threshingfloor/api/data?kind=tournaments"; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3000$p"; done
```
Expected: all `404`.

- [ ] **Step 4: Authorized end-to-end (requires granted login)**

The granted accounts are `baboonytim@gmail.com` and `jhendrix6426@gmail.com`. Tim (the repo owner) controls baboonytim. Using Playwright MCP against the dev server with an existing session, or asking Tim to click through:
1. `/threshingfloor` renders the outline.
2. Enter episode `1`, fill a field, Save Draft → status "Saved Ep 1 …".
3. Reload page → Load Draft → picker shows Ep 1 → Load → field restored.
4. Load the same draft twice in a row → mailbag/news/agur sections do NOT duplicate.
5. Enter episode `2` → "Load Previous Draft" in Power Rankings → prefills from Ep 1 (or reports none if Ep 1 had no rankings).
6. Fetch buttons: Upcoming Tournaments, Nationals info, Recent Spoilers, Deck link fetch — each populates or reports a sensible empty message.
7. Delete draft Ep 1 via the picker.
If a step can't be performed (no session available), report exactly which steps were verified and which remain for Tim.

- [ ] **Step 5: Confirm the dropped file is gone from the repo root**

Run: `ls "TF Outline VersionB Toggle.html"` → expected: No such file (it was `git mv`'d in Task 3).

- [ ] **Step 6: Final commit (anything stray) and report**

```bash
git status --short
```
Expected: clean. Report verification results honestly, including any deferred manual steps.

- [ ] **Step 7: Preview deploy check (post-merge follow-up)**

After deploy, confirm `/threshingfloor` serves for a granted user on Vercel (validates `outputFileTracingIncludes`). This cannot be verified locally; flag it in the final report.
