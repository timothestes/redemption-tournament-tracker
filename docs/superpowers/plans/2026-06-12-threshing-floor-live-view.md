# Threshing Floor Live View Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an outline author publish a finished episode to a permanent, login-free, read-only public URL (`/threshingfloor/episodes/<n>`) that renders the same `outline.html` in a "view mode".

**Architecture:** Add a frozen `published_data` snapshot column to the existing `threshing_floor_drafts` row and a `SECURITY DEFINER` function exposing only published snapshots to anon. A public route handler reads that snapshot and serves the existing `outline.html` with the data injected, where a new view-mode branch renders read-only (reusing the file's print-mode hide rules and keeping the spoiler/agur enlarge modals interactive). A Publish/Unpublish UI in the editor toolbar drives it.

**Tech Stack:** Next.js 15 App Router route handlers, Supabase (RLS + SECURITY DEFINER RPC), vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-threshing-floor-live-view-design.md` — read it first.

**Branch:** `tf-live-view` (already checked out).

**File map:**
- Create: `supabase/migrations/046_threshing_floor_published.sql`
- Create: `app/threshingfloor/api/drafts/[episode]/publish/route.ts` + test `app/threshingfloor/api/__tests__/publish-route.test.ts`
- Create: `app/threshingfloor/episodes/[episode]/route.ts` (public viewer) + test `app/threshingfloor/episodes/__tests__/viewer-route.test.ts`
- Create: `app/threshingfloor/viewerHtml.ts` (pure inject/escape helper) + test `app/threshingfloor/__tests__/viewerHtml.test.ts`
- Modify: `app/threshingfloor/api/drafts/route.ts` and `app/threshingfloor/api/drafts/[episode]/route.ts` (return `published_at`)
- Modify: `app/threshingfloor/outline.html` (view-mode branch + view CSS + fetch guards + Publish UI)
- Modify: `next.config.js` (file tracing for the new route)

**Conventions:**
- Server Supabase client: `import { createClient } from "@/utils/supabase/server"` (async). For the anon public read, the standard server client is fine — with no session it acts as the `anon` role, and the SECURITY DEFINER function is granted to `anon`.
- Permission gate: `requireThreshingFloor()` / `notFoundResponse()` from `app/threshingfloor/api/auth.ts`.
- Episode normalization: `normalizeEpisode` / `isNumericEpisode` from `app/threshingfloor/episodes.ts`.
- Tests: `npm test` (vitest). Route-test mock style: `app/api/v1/__tests__/decks-route.test.ts` and the existing `app/threshingfloor/api/__tests__/drafts-route.test.ts`.
- Migrations applied via the Supabase MCP `apply_migration` tool AND saved to `supabase/migrations/`.
- `outline.html` has two ~114KB base64-free now (header was extracted) but is still ~140KB/3200 lines; never read it whole — use `grep -n` + `sed -n 'A,Bp' | cut -c1-200`, edit with unique anchors, re-grep after each edit.

---

### Task 1: Migration — published snapshot column + public read function

**Files:**
- Create: `supabase/migrations/046_threshing_floor_published.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Live View Mode: a frozen "published" snapshot of an episode outline that
-- anonymous visitors can read at /threshingfloor/episodes/<n>. The editable
-- draft (data) stays private; only published_data is ever exposed publicly.

ALTER TABLE public.threshing_floor_drafts
  ADD COLUMN IF NOT EXISTS published_data jsonb,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Public read path. SECURITY DEFINER so anon can call it without any RLS grant
-- on the table itself. Returns ONLY published_data, and ONLY when published.
CREATE OR REPLACE FUNCTION public.get_published_outline(ep text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT published_data
  FROM public.threshing_floor_drafts
  WHERE episode_number = ep AND published_at IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_published_outline(text) TO anon, authenticated;
```

- [ ] **Step 2: Apply via Supabase MCP**

Load `mcp__supabase__apply_migration` (ToolSearch `select:mcp__supabase__apply_migration`), apply with name `threshing_floor_published` and the SQL above. Expected: success.

- [ ] **Step 3: Verify columns + function isolation**

Load `mcp__supabase__execute_sql`. Run:
```sql
-- columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name='threshing_floor_drafts' AND column_name IN ('published_data','published_at');
-- function returns NULL for a non-existent / unpublished episode
SELECT public.get_published_outline('___nope___') IS NULL AS unknown_is_null;
```
Expected: two column rows; `unknown_is_null = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/046_threshing_floor_published.sql
git commit -m "feat: published snapshot column and public read function for live view"
```

---

### Task 2: Publish/Unpublish API + expose published_at on draft reads

**Files:**
- Create: `app/threshingfloor/api/drafts/[episode]/publish/route.ts`
- Modify: `app/threshingfloor/api/drafts/[episode]/route.ts` (add `published_at` to GET select)
- Modify: `app/threshingfloor/api/drafts/route.ts` (add `published_at` to list select)
- Test: `app/threshingfloor/api/__tests__/publish-route.test.ts`

- [ ] **Step 1: Write the publish route** (`app/threshingfloor/api/drafts/[episode]/publish/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { normalizeEpisode } from "../../../../episodes";
import { notFoundResponse, requireThreshingFloor } from "../../../auth";

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

function publicUrl(episode: string): string {
  return "/threshingfloor/episodes/" + encodeURIComponent(episode);
}

// POST = save current data AND freeze it as the public snapshot (one step, so
// the published copy is exactly what's on screen).
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Draft too large (over 4 MB)" }, { status: 413 });
  }
  let body: { data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return NextResponse.json({ error: "data must be an object" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: saved, error } = await auth.supabase
    .from("threshing_floor_drafts")
    .upsert(
      {
        episode_number: episode,
        data: body.data,
        published_data: body.data,
        published_at: now,
        updated_by: auth.user.id,
        updated_at: now,
      },
      { onConflict: "episode_number" }
    )
    .select("episode_number, published_at")
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: "Failed to publish" }, { status: 500 });
  }
  return NextResponse.json({ ...saved, url: publicUrl(episode) });
}

// DELETE = unpublish (take the public page down). Leaves the draft intact.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const { error } = await auth.supabase
    .from("threshing_floor_drafts")
    .update({ published_data: null, published_at: null })
    .eq("episode_number", episode);
  if (error) return NextResponse.json({ error: "Failed to unpublish" }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Add `published_at` to the per-episode GET select**

In `app/threshingfloor/api/drafts/[episode]/route.ts`, change the GET select string:
```ts
    .select("episode_number, data, updated_at")
```
to:
```ts
    .select("episode_number, data, updated_at, published_at")
```
(Only that one line in the `GET` handler. Leave PUT/DELETE unchanged.)

- [ ] **Step 3: Add `published_at` to the list select**

In `app/threshingfloor/api/drafts/route.ts`, the final (non-`before`) list query, change:
```ts
    .select("episode_number, updated_at");
```
to:
```ts
    .select("episode_number, updated_at, published_at");
```
`sortDraftsForList` only reads `episode_number`/`updated_at`, so the extra field passes through untouched.

- [ ] **Step 4: Write the tests** (`app/threshingfloor/api/__tests__/publish-route.test.ts`)

Mirror the stub style of `app/threshingfloor/api/__tests__/drafts-route.test.ts`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../auth", async (orig) => {
  const real: any = await orig();
  return { ...real, requireThreshingFloor: vi.fn() };
});

import { POST, DELETE } from "../drafts/[episode]/publish/route";
import * as auth from "../../auth";
import { NextRequest } from "next/server";

function makeSupabase(results: any[]) {
  let call = 0;
  const next = () => results[Math.min(call++, results.length - 1)];
  const chain: any = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    single: vi.fn(async () => next()),
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
const ctx = (episode: string) => ({ params: Promise.resolve({ episode }) });
const post = (episode: string, body: any) =>
  POST(new NextRequest("http://x/threshingfloor/api/drafts/" + episode + "/publish", {
    method: "POST", body: JSON.stringify(body),
  }), ctx(episode));

beforeEach(() => vi.clearAllMocks());

describe("POST publish", () => {
  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await post("100", { data: {} });
    expect(r.status).toBe(404);
  });

  it("400s on non-object data", async () => {
    authorized([]);
    const r = await post("100", { data: "nope" });
    expect(r.status).toBe(400);
  });

  it("publishes and returns episode, published_at, and public url", async () => {
    authorized([{ data: { episode_number: "100", published_at: "2026-06-12T00:00:00Z" }, error: null }]);
    const r = await post("100", { data: { "ep-num": "100" } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.episode_number).toBe("100");
    expect(j.published_at).toBe("2026-06-12T00:00:00Z");
    expect(j.url).toBe("/threshingfloor/episodes/100");
  });
});

describe("DELETE unpublish", () => {
  it("404s when unauthorized", async () => {
    (auth.requireThreshingFloor as any).mockResolvedValue(null);
    const r = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx("100"));
    expect(r.status).toBe(404);
  });

  it("returns success", async () => {
    authorized([{ error: null }]);
    const r = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx("100"));
    expect(r.status).toBe(200);
    expect((await r.json()).success).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run app/threshingfloor` — expect all pass (episodes + drafts + publish).
Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add app/threshingfloor/api
git commit -m "feat: publish/unpublish API and published_at on draft reads"
```

---

### Task 3: Pure HTML inject/escape helper (TDD)

**Files:**
- Create: `app/threshingfloor/viewerHtml.ts`
- Test: `app/threshingfloor/__tests__/viewerHtml.test.ts`

- [ ] **Step 1: Write the failing tests** (`app/threshingfloor/__tests__/viewerHtml.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { buildViewerHtml, escapeForScript } from "../viewerHtml";

describe("escapeForScript", () => {
  it("escapes characters that could break out of a <script> tag", () => {
    const out = escapeForScript('</script><x>&  ');
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<x>");
    expect(out).toContain("\\u003c"); // <
    expect(out).toContain("\\u003e"); // >
    expect(out).toContain("\\u0026"); // &
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
  });
  it("produces valid JSON that round-trips", () => {
    const value = { a: "</script>", b: [1, 2], c: "x & y" };
    const parsed = JSON.parse(escapeForScript(value).replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
    expect(parsed).toEqual(value);
  });
});

describe("buildViewerHtml", () => {
  const shell = "<head></head><script>main();</script>";
  it("injects the bootstrap before the first <script> tag", () => {
    const out = buildViewerHtml(shell, "100", { "ep-num": "100" });
    expect(out.indexOf("window.__TF_VIEW__")).toBeLessThan(out.indexOf("main();"));
    expect(out).toContain('"episode"');
  });
  it("does not let snapshot content break out of the bootstrap script", () => {
    const out = buildViewerHtml(shell, "100", { evil: "</script><img src=x onerror=alert(1)>" });
    // the literal closing tag from the payload must not appear; only the real one
    expect(out.match(/<\/script>/g)!.length).toBe(1);
  });
  it("returns the shell unchanged except for the injected tag", () => {
    const out = buildViewerHtml(shell, "100", {});
    expect(out).toContain("<head></head>");
    expect(out).toContain("main();");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/threshingfloor/__tests__/viewerHtml.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement** (`app/threshingfloor/viewerHtml.ts`)

```ts
// Serialize a value as a JS literal safe to embed inside an inline <script>.
// Escapes the characters that could terminate the tag or inject markup.
export function escapeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Inject the view-mode bootstrap before the outline's main <script> so the
// flag/data are set before that script runs.
export function buildViewerHtml(
  shellHtml: string,
  episode: string,
  data: Record<string, unknown>
): string {
  const payload = escapeForScript({ episode, data });
  const bootstrap = `<script>window.__TF_VIEW__ = ${payload};</script>\n`;
  return shellHtml.replace("<script>", bootstrap + "<script>");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/threshingfloor/__tests__/viewerHtml.test.ts` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/threshingfloor/viewerHtml.ts app/threshingfloor/__tests__/viewerHtml.test.ts
git commit -m "feat: viewer HTML inject/escape helper"
```

---

### Task 4: Public viewer route + file tracing

**Files:**
- Create: `app/threshingfloor/episodes/[episode]/route.ts`
- Test: `app/threshingfloor/episodes/__tests__/viewer-route.test.ts`
- Modify: `next.config.js`

- [ ] **Step 1: Write the route** (`app/threshingfloor/episodes/[episode]/route.ts`)

```ts
import { readFile } from "fs/promises";
import path from "path";
import { createClient } from "@/utils/supabase/server";
import { normalizeEpisode } from "../../episodes";
import { buildViewerHtml } from "../../viewerHtml";

type Ctx = { params: Promise<{ episode: string }> };

function notFound() {
  return new Response("Not Found", { status: 404 });
}

// Public, anonymous, noindex viewer for a PUBLISHED episode outline.
export async function GET(_request: Request, { params }: Ctx) {
  const { episode: raw } = await params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return notFound();
  }
  const episode = normalizeEpisode(decoded);
  if (!episode) return notFound();

  // Anon role; get_published_outline is SECURITY DEFINER and granted to anon.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_published_outline", { ep: episode });
  if (error || !data) return notFound();

  const filePath = path.join(process.cwd(), "app/threshingfloor/outline.html");
  const shell = await readFile(filePath, "utf-8");
  const html = buildViewerHtml(shell, episode, data as Record<string, unknown>);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Write the tests** (`app/threshingfloor/episodes/__tests__/viewer-route.test.ts`)

Mock the supabase server client and the filesystem read so the test is hermetic.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));
vi.mock("fs/promises", () => ({
  readFile: vi.fn(async () => "<head></head><script>main();</script>"),
}));

import { GET } from "../[episode]/route";

const ctx = (episode: string) => ({ params: Promise.resolve({ episode }) });
const req = () => new Request("http://x/threshingfloor/episodes/100");

beforeEach(() => vi.clearAllMocks());

describe("GET /threshingfloor/episodes/[episode]", () => {
  it("404s when the episode is not published (function returns null)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await GET(req(), ctx("100"));
    expect(r.status).toBe(404);
  });

  it("404s on an invalid episode segment", async () => {
    const r = await GET(req(), ctx("%20%20"));
    expect(r.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("serves the outline with injected snapshot + noindex header when published", async () => {
    rpc.mockResolvedValue({ data: { "ep-num": "100" }, error: null });
    const r = await GET(req(), ctx("100"));
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const body = await r.text();
    expect(body).toContain("window.__TF_VIEW__");
    expect(body.indexOf("window.__TF_VIEW__")).toBeLessThan(body.indexOf("main();"));
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run app/threshingfloor` — all pass.

- [ ] **Step 4: Add file tracing** in `next.config.js` — extend the existing `outputFileTracingIncludes`:

```js
  outputFileTracingIncludes: {
    '/threshingfloor/outline': ['./app/threshingfloor/outline.html'],
    '/threshingfloor/episodes/[episode]': ['./app/threshingfloor/outline.html'],
  },
```

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add app/threshingfloor/episodes next.config.js
git commit -m "feat: public viewer route for published outlines"
```

---

### Task 5: View mode inside outline.html (render read-only)

**Files:**
- Modify: `app/threshingfloor/outline.html`

Inspect regions with `sed -n 'A,Bp' app/threshingfloor/outline.html | cut -c1-200` and re-grep anchors after each edit (line numbers shift).

- [ ] **Step 1: Guard network calls so view mode never hits auth-gated APIs**

The main `<script>` starts at the line matching `^<script>$` (currently ~1269). `fetchNationalsInfo()` auto-fires on load via the `tog-rtn` checkbox `onchange`, and `fetchTournamentListings()` is the shared network helper. Add an early return to each so they no-op in view mode.

Find `function fetchNationalsInfo() {` and insert as its first line:
```js
    if (window.__TF_VIEW__) return;
```
Find `function fetchTournamentListings(onSuccess, onError) {` and insert as its first line:
```js
    if (window.__TF_VIEW__) return;
```

- [ ] **Step 2: Add the view-mode bootstrap at the very end of the script**

The script ends with the toggle-init loop:
```js
  document.querySelectorAll('.toggle-item input[type=checkbox]').forEach(function(cb) {
    if (cb.onchange) cb.onchange.call(cb, { target: cb });
  });
```
Immediately AFTER that block (still inside `<script>`), append:
```js
  // ---- View mode: render a published snapshot read-only ----
  if (window.__TF_VIEW__) {
    document.body.classList.add('view-mode');
    try {
      applyDraft(window.__TF_VIEW__.data || {});
    } catch (e) {
      // Leave whatever rendered; a partial outline beats a blank page.
    }
  }
```
`applyDraft` already calls `resetForm()` then fills every field, rebuilds dynamic rows, and applies section-toggle visibility — exactly the read-only render we want. Network calls are guarded (Step 1).

- [ ] **Step 3: Add the view-mode stylesheet**

Add a `<style>`-block rule set. Put it at the END of the existing `<style>` (find the last `</style>` before `</head>` and insert before it). This mirrors the structural hides from the `@media print` block but for screen, KEEPS the enlarge modals interactive, and renders inputs as plain text. Insert:

```css
  /* ---- Live View Mode (public read-only render) ---- */
  body.view-mode .toolbar,
  body.view-mode .toggle-row,
  body.view-mode .sec-order-controls,
  body.view-mode #tourn-add-row,
  body.view-mode .tourn-remove-btn,
  body.view-mode .placement-clear,
  body.view-mode .rank-clear,
  body.view-mode #prev-rankings-field,
  body.view-mode #prev-meta-rankings-field,
  body.view-mode #tournaments-section button,
  body.view-mode #tournaments-section select,
  body.view-mode #upcoming-fetch-status,
  body.view-mode .rtn-row-remove,
  body.view-mode .countdown-remove,
  body.view-mode #rtn-section .btn,
  body.view-mode #rtn-carryforward-status,
  body.view-mode #rtn-nats-fetch-status,
  body.view-mode #spoiler-fetch-status,
  body.view-mode #spoilers-section button,
  body.view-mode #spoilers-section select,
  body.view-mode #spoilers-section label.btn,
  body.view-mode .spoiler-card-remove,
  body.view-mode .spoiler-card-addnote-btn,
  body.view-mode #spoiler-empty-state,
  body.view-mode #agur-empty-state,
  body.view-mode .agur-card-remove,
  body.view-mode .agur-card-addnote-btn,
  body.view-mode #dotw-fetch-status,
  body.view-mode #draft-picker-row,
  body.view-mode .repeat-remove,
  body.view-mode [id$="-add-row"],
  body.view-mode input[type="file"] {
    display: none !important;
  }
  body.view-mode .rank-delta.empty { display: none; }
  /* Render inputs/textviews as static text */
  body.view-mode input,
  body.view-mode textarea,
  body.view-mode select {
    border: none !important;
    background: transparent !important;
    resize: none;
    pointer-events: none;
    box-shadow: none !important;
  }
  body.view-mode textarea { overflow: hidden; }
  /* The enlarge modals stay clickable */
  body.view-mode .spoiler-card-img-wrap,
  body.view-mode .agur-card-img-wrap { pointer-events: auto; cursor: pointer; }
```

Before finalizing, VERIFY these selector ids/classes exist (grep each in the file): `tourn-add-row`, `tourn-remove-btn`, `placement-clear`, `rank-clear`, `prev-rankings-field`, `prev-meta-rankings-field`, `rtn-row-remove`, `countdown-remove`, `rtn-carryforward-status`, `rtn-nats-fetch-status`, `spoiler-fetch-status`, `spoiler-card-remove`, `spoiler-card-addnote-btn`, `spoiler-empty-state`, `agur-empty-state`, `agur-card-remove`, `agur-card-addnote-btn`, `dotw-fetch-status`, `draft-picker-row`, `spoiler-card-img-wrap`, `agur-card-img-wrap`. The `@media print` block (search `@media print`) already references most of these — cross-check against it. If an id differs, correct the selector; do not invent ids.

- [ ] **Step 4: Security audit — ensure no snapshot text reaches innerHTML**

The snapshot is attacker-controllable in principle (whatever was typed/published). `applyDraft` populates fields via `.value`/`textContent`/`.src`, but verify the spoiler/agur **note** renderers and the bullet `-print` builders use `textContent`, not `innerHTML`, for stored text. Inspect:
- `openSpoilerModal` (grep `function openSpoilerModal`) and `openAgurModal` — the `modalNote.innerHTML = ''` lines: confirm the note lines are appended as `document.createElement('li')` + `.textContent = line` (safe). If any does `el.innerHTML = <stored text>`, change it to build `<li>` nodes with `.textContent`.
- The spoiler/agur card note `-print` builders (grep `printList.innerHTML`) — same check.
- The collectors-card restore path already sets `.src` via property (verified previously) — confirm still so.

If all are `textContent`, make no change and note "audit passed" in the commit body. If a sink is found, fix it minimally (build text nodes).

- [ ] **Step 5: Syntax check + tests**

```bash
python3 -c "import re; s=open('app/threshingfloor/outline.html').read(); m=re.search(r'<script>(.*)</script>', s, re.S); open('/tmp/tfv.js','w').write(m.group(1))"
node --check /tmp/tfv.js && echo SYNTAX_OK
npx vitest run app/threshingfloor
```
Expected: SYNTAX_OK; tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/threshingfloor/outline.html
git commit -m "feat: view mode renders published snapshot read-only"
```

---

### Task 6: Publish/Unpublish UI in the editor toolbar

**Files:**
- Modify: `app/threshingfloor/outline.html`

- [ ] **Step 1: Add the Publish button to the toolbar**

Find:
```html
    <button class="btn btn-ghost" onclick="window.print()">Print / Export PDF</button>
```
Insert BEFORE it:
```html
    <button class="btn btn-ghost" onclick="publishEpisode()">Publish</button>
```

- [ ] **Step 2: Add publish/unpublish functions**

Find the editor's `function saveData() {` and insert the following functions immediately BEFORE it (so they share scope with `collectData`/`draftEpisodeKey`):

```js
  function showPublishLink(ep, published) {
    var status = document.getElementById('save-status');
    if (!published) { status.textContent = 'Not published.'; return; }
    var url = location.origin + '/threshingfloor/episodes/' + encodeURIComponent(ep);
    status.innerHTML = '';
    status.appendChild(document.createTextNode('Published: '));
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = url;
    a.style.color = 'var(--teal-mid)';
    status.appendChild(a);
    var copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'btn btn-ghost'; copy.textContent = 'Copy';
    copy.style.marginLeft = '8px';
    copy.addEventListener('click', function() {
      navigator.clipboard.writeText(url).then(function() { copy.textContent = 'Copied'; });
    });
    var unpub = document.createElement('button');
    unpub.type = 'button'; unpub.className = 'btn btn-red'; unpub.textContent = 'Unpublish';
    unpub.style.marginLeft = '6px';
    unpub.addEventListener('click', function() { unpublishEpisode(); });
    status.appendChild(copy);
    status.appendChild(unpub);
  }

  function publishEpisode() {
    var ep = draftEpisodeKey();
    var status = document.getElementById('save-status');
    var json = JSON.stringify({ data: collectData() });
    if (json.length > 4 * 1024 * 1024) {
      status.textContent = 'Too large to publish (over 4 MB) -- remove some images.';
      return;
    }
    status.textContent = 'Publishing...';
    fetch('/threshingfloor/api/drafts/' + encodeURIComponent(ep) + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json
    }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(row) {
      window.loadedDraftUpdatedAt = null; // publish also saved; force fresh concurrency token next save
      showPublishLink(ep, true);
    }).catch(function() { status.textContent = 'Publish failed -- try again.'; });
  }

  function unpublishEpisode() {
    var ep = draftEpisodeKey();
    var status = document.getElementById('save-status');
    showConfirm('Take the public page for Ep ' + ep + ' offline?', { confirmText: 'Unpublish', danger: true }).then(function(ok) {
      if (!ok) return;
      fetch('/threshingfloor/api/drafts/' + encodeURIComponent(ep) + '/publish', { method: 'DELETE' })
        .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(function() { status.textContent = 'Unpublished Ep ' + ep + '.'; })
        .catch(function() { status.textContent = 'Could not unpublish.'; });
    });
  }
```

Note: `showConfirm` and `draftEpisodeKey`/`collectData`/`window.loadedDraftUpdatedAt` already exist in this file (verify with grep). `publishEpisode` sets the concurrency token to null because the POST also wrote `data`, so the next plain Save should not 409 against a stale token.

- [ ] **Step 3: Reflect published state after loading a draft**

Find `function loadDraft(ep) {` and its `.then(function(row) {` body where it sets status to `'Loaded Ep ' + row.episode_number + '.'`. Replace that single status line:
```js
        status.textContent = 'Loaded Ep ' + row.episode_number + '.';
```
with:
```js
        if (row.published_at) { showPublishLink(row.episode_number, true); }
        else { status.textContent = 'Loaded Ep ' + row.episode_number + '.'; }
```
(`row` comes from `GET /threshingfloor/api/drafts/[episode]`, which now returns `published_at` — Task 2 Step 2.)

- [ ] **Step 4: Guard the publish button in view mode**

The Publish button lives in `.toolbar`, which `body.view-mode` already hides (Task 5), so no extra work — but confirm by grep that the Publish button is inside the `.toolbar` div and not elsewhere.

- [ ] **Step 5: Syntax check + tests**

```bash
python3 -c "import re; s=open('app/threshingfloor/outline.html').read(); m=re.search(r'<script>(.*)</script>', s, re.S); open('/tmp/tfp.js','w').write(m.group(1))"
node --check /tmp/tfp.js && echo SYNTAX_OK
npx vitest run app/threshingfloor
```
Expected: SYNTAX_OK; tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/threshingfloor/outline.html
git commit -m "feat: publish/unpublish controls in editor toolbar"
```

---

### Task 7: Final verification and cleanup

- [ ] **Step 1: Full suite + tsc + build**

```bash
npm test
npx tsc --noEmit
npm run build 2>&1 | grep -iE "threshingfloor|error|failed"
```
Expected: tests green; tsc clean; build shows `/threshingfloor/episodes/[episode]` and `/threshingfloor/api/drafts/[episode]/publish` routes, no errors.

- [ ] **Step 2: End-to-end against the production build (DB writes are real)**

```bash
npm run start > /tmp/tf-live.log 2>&1 &
sleep 5
# anonymous viewer for an unpublished episode -> 404
curl -s -o /dev/null -w "unpublished view -> %{http_code}\n" "http://localhost:3000/threshingfloor/episodes/99999"
# anonymous editor + publish API still gated -> 404
curl -s -o /dev/null -w "editor -> %{http_code}\n" http://localhost:3000/threshingfloor
curl -s -X POST -o /dev/null -w "publish API anon -> %{http_code}\n" http://localhost:3000/threshingfloor/api/drafts/1/publish
kill %1 2>/dev/null; lsof -ti :3000 | xargs kill 2>/dev/null; echo cleaned
```
Expected: all `404`.

- [ ] **Step 3: Authorized end-to-end (requires a granted login; may defer to repo owner)**

Using Playwright MCP against the dev/prod server with a granted session (BaboonyTim), or hand to the owner:
1. In the editor, set episode `1`, fill a field (e.g. a spoiler with an image), click **Publish** → status shows a copyable public link.
2. Open that link in a **logged-out** context (incognito) → outline renders read-only: no toolbar/toggles/add-remove buttons, fields show as text, hidden sections stay hidden, **clicking a spoiler image enlarges it**, and the browser console shows no failed `/threshingfloor/api/*` calls.
3. Back in the editor, **Unpublish** → the public link now 404s.
Report exactly which steps were verified vs. deferred.

- [ ] **Step 4: Push**

```bash
git push -u origin tf-live-view
```

- [ ] **Step 5: Preview-deploy follow-up (owner)**

After Vercel builds the branch, confirm a published episode renders on the preview URL for a logged-out visitor — validates `outputFileTracingIncludes` bundles `outline.html` for the new `/threshingfloor/episodes/[episode]` route (cannot be confirmed locally). Flag in the final report.
