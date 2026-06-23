# Forge Phase 1a.3 — Private Art Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the leak-proof private card-art pipeline for The Forge — private Vercel Blob upload (UUID keys), an authenticated streaming proxy, placeholder/original handling, "download original," a guardrail banning `next/image` under `app/forge/**`, and a broadened anon-leak CI test.

**Architecture:** A new minimal `forge_cards` identity table (owner + three art-ref columns + RLS) gives art something to hang on; its content model (snapshot jsonb, sets, immutable `card_versions`) is deliberately deferred to the later studio slice. Art bytes live only in a **private** Blob store under unguessable UUID keys; Postgres stores only the opaque key. Every read flows through `GET /forge/api/art/[cardId]` → `requireForge()` (404 if not a member) → RLS lookup of the key → server-side `get(key, { access: 'private' })` → streamed bytes with `Cache-Control: private, no-store`. The browser never sees the blob host or key. A thin `/forge/art` panel exercises the pipeline end-to-end; the studio later absorbs these same primitives.

**Tech Stack:** Next.js 15 App Router (route handlers + server actions), Supabase Postgres (RLS + SECURITY DEFINER RPCs), `@vercel/blob` v2.3.0 (`put`/`get`/`del` with `access: 'private'`), Vitest guardrail tests.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md`). Every task's requirements implicitly include this section.

- **Private art store:** Playtest art lives in a **private** Vercel Blob store (`access: 'private'`) with **UUID keys** (not card names). The existing public upload routes use `access: 'public'` — Forge upload code must **not** copy that.
- **Authed proxy only:** Served only through `GET /forge/api/art/[cardId]` → `requireForge()` (404 if unauthorized) → RLS-checked lookup → server-side fetch of the private blob (server-only token) → stream bytes with `Cache-Control: private, no-store`. The browser only ever sees the proxy URL on the app's own domain — never the blob host or key.
- **`next/image` forbidden under `app/forge/**`.** `next.config.js` wildcards `*.public.blob.vercel-storage.com` in `remotePatterns`, and private Blob shares the storage domain family, so an `<Image>` could CDN-cache a public optimized variant. Forge art uses plain `<img src="/forge/api/art/...">` only.
- **Download original:** same proxy with `?download=1` → `Content-Disposition: attachment`. Logged in `forge_audit` (action `art_download`).
- **404 not 401/403** for anything unauthorized — the area stays secret.
- **Secret spine:** the secret lives in exactly one place — Postgres behind RLS. Every other surface (Blob, RSC, API, CDN) carries only an opaque UUID reference or streams bytes after the server-side gate.
- **Env:** the server-only `BLOB_READ_WRITE_TOKEN` stays server-only, never `NEXT_PUBLIC_*`, never added to `.env.example`. (It already exists in prod — used by `app/api/spoilers/upload/route.ts`; the same store holds private blobs in v2.)
- **DB conventions (match 048/049):** every SECURITY DEFINER function pins `set search_path = ''`, fully-qualifies `public.*`, and is locked with `revoke execute ... from public, anon; grant execute ... to authenticated;` (Supabase default-grants EXECUTE to anon directly, so `revoke from public` alone is insufficient).
- **Keystone guardrail:** the anon-leak CI test (`__tests__/forge-anon-leak.test.ts`) MUST be extended for every new Forge table and RPC.

## Phase-boundary decision (read before starting)

`forge_cards` did not exist before this plan. This plan creates it as an **identity-only** table — `id`, `owner_id`, `title`, the three `working_art_*` columns, timestamps, RLS. The studio slice later **adds** the content fields (`working_snapshot` jsonb, `set_id`, status, and the immutable `card_versions` table). Nothing here is throwaway: every column matches the spec's data model. In 1a.3 there is no image processing, so `working_art_original_key` is set equal to `working_art_key` on upload (the served art *is* the original); the studio refines full-res/replace-history handling later.

Two spec-vs-reality deviations, both deliberate:
1. **"Lint rule" → Vitest guardrail.** The repo has **no ESLint config and no `lint` script**. Standing up ESLint for one rule is disproportionate and would surface unrelated pre-existing issues. The existing Forge guardrails are all Vitest. So the `next/image` ban is a static-scan Vitest test (Task 6) that runs in the default `npm test` and gates CI the same way.
2. **Middleware note.** The spec said `/forge/api` is outside middleware coverage. Reality: `middleware.ts` only enforces auth on the `/tracker` and `/admin` prefixes (`utils/supabase/middleware.ts` `PROTECTED_PREFIXES`), so `/forge/**` passes through untouched and the route handler's own `requireForge()` is the gate. Same outcome; no middleware change needed.

## File Structure

- **Create** `supabase/migrations/050_forge_cards_art.sql` — `forge_cards` table, RLS, four SECURITY DEFINER RPCs, grants.
- **Create** `app/forge/lib/art.ts` — server-only blob helpers (`validateArtFile`, `uploadForgeArt`, `readForgeArt`, `deleteForgeArt`) + constants.
- **Create** `app/forge/lib/__tests__/art.test.ts` — hermetic test of the pure `validateArtFile`.
- **Create** `app/forge/lib/cards.ts` — `"use server"` actions: `createCard`, `uploadArt`, `setPlaceholder`, `listMyForgeCards`.
- **Create** `app/forge/api/art/[cardId]/route.ts` — the authed streaming proxy (`GET`).
- **Create** `app/forge/api/art/[cardId]/__tests__/route.test.ts` — hermetic unauth→404 unit test (mocks `requireForge`).
- **Create** `app/forge/art/page.tsx` — elder-gated server page; loads the caller's cards.
- **Create** `app/forge/art/ArtPanel.tsx` — `"use client"` panel: create card, upload/replace art, placeholder toggle, `<img>` preview, download-original link.
- **Create** `__tests__/forge-no-next-image.test.ts` — static guardrail: no `next/image` under `app/forge/**`.
- **Modify** `__tests__/forge-anon-leak.test.ts` — add `forge_cards` to `FORGE_TABLES`; add the four new RPCs to `FORGE_RPCS`.

---

### Task 1: `forge_cards` migration — identity table + RLS + RPCs

**Files:**
- Create: `supabase/migrations/050_forge_cards_art.sql`

**Interfaces:**
- Produces (consumed by Tasks 2, 4, 5): table `public.forge_cards(id, owner_id, title, working_art_key, working_art_is_placeholder, working_art_original_key, created_at, updated_at)`; RPCs `forge_create_card(p_title text) returns uuid`, `forge_set_working_art(p_card_id uuid, p_key text, p_original_key text) returns void`, `forge_set_art_placeholder(p_card_id uuid, p_is_placeholder boolean) returns void`, `forge_log_art_download(p_card_id uuid) returns void`.
- Consumes: helpers from 048 (`public.is_forge_member()`, `public.is_forge_elder_or_super()`, `public.my_forge_role()`) and the `public.forge_audit` table from 049.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/050_forge_cards_art.sql`:

```sql
-- 050_forge_cards_art.sql
-- Forge phase 1a.3: minimal card IDENTITY + the private art pipeline.
-- forge_cards ships ONLY what art needs (owner + art refs). The card CONTENT model
-- (working_snapshot jsonb, sets, immutable card_versions) lands in the later studio
-- slice. Builds on 048 (is_forge_member / is_forge_elder_or_super) and 049 (forge_audit).
-- SCHEMA + FUNCTIONS ONLY — no card content.

-- 1) Card identity. Art refs are private-blob PATHNAMES (UUID keys), never URLs.
create table if not exists public.forge_cards (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null references auth.users(id) on delete cascade,
  title                       text,
  working_art_key             text,                       -- private blob pathname (UUID) for the current draft art
  working_art_is_placeholder  boolean not null default false,
  working_art_original_key    text,                       -- full-res original (== working_art_key in 1a.3; studio refines)
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table public.forge_cards enable row level security;

-- 2) RLS: any Forge member may READ any card row (member-vs-non-member is the
--    boundary; single-author Phase 1a has no per-card visibility yet). No direct
--    write policy — writes go through the SECURITY DEFINER RPCs below (cf. 048/049).
drop policy if exists "forge_cards_select" on public.forge_cards;
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated
  using (public.is_forge_member());

revoke all on public.forge_cards from anon;
grant select on public.forge_cards to authenticated;

-- 3) Create a card (elders design cards in Phase 1a; playtesters do not).
create or replace function public.forge_create_card(p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'only elders may create cards';
  end if;
  insert into public.forge_cards (owner_id, title)
  values (auth.uid(), nullif(btrim(p_title), ''))
  returning id into v_id;
  return v_id;
end; $$;

-- 4) Set the current draft art (key + full-res original). Clears the placeholder
--    flag. Owner or any elder may edit.
create or replace function public.forge_set_working_art(
  p_card_id uuid, p_key text, p_original_key text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_cards
     set working_art_key = p_key,
         working_art_original_key = p_original_key,
         working_art_is_placeholder = false,
         updated_at = now()
   where id = p_card_id;
end; $$;

-- 5) Toggle the placeholder flag (advisory "art not final" state; no blob needed).
create or replace function public.forge_set_art_placeholder(
  p_card_id uuid, p_is_placeholder boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid() or public.is_forge_elder_or_super())
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  update public.forge_cards
     set working_art_is_placeholder = coalesce(p_is_placeholder, false),
         updated_at = now()
   where id = p_card_id;
end; $$;

-- 6) Audit an art download (member-gated; the proxy calls this on ?download=1).
create or replace function public.forge_log_art_download(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_forge_member() then
    raise exception 'not a member';
  end if;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'art_download', p_card_id::text);
end; $$;

-- 7) Lock down execute: strip anon (Supabase default-grants it directly), grant authenticated.
revoke execute on function public.forge_create_card(text) from public, anon;
revoke execute on function public.forge_set_working_art(uuid, text, text) from public, anon;
revoke execute on function public.forge_set_art_placeholder(uuid, boolean) from public, anon;
revoke execute on function public.forge_log_art_download(uuid) from public, anon;

grant execute on function public.forge_create_card(text) to authenticated;
grant execute on function public.forge_set_working_art(uuid, text, text) to authenticated;
grant execute on function public.forge_set_art_placeholder(uuid, boolean) to authenticated;
grant execute on function public.forge_log_art_download(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration to the dev/prod project**

Apply via the Supabase MCP (matches how 048/049 were applied):

Use `mcp__supabase__apply_migration` with `name: "050_forge_cards_art"` and the SQL body above.
Expected: success, no error.

- [ ] **Step 3: Verify schema + RLS landed**

Run via `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='forge_cards') as col_count,
  (select relrowsecurity from pg_class where relname='forge_cards') as rls_enabled,
  (select count(*) from pg_proc
     where proname in ('forge_create_card','forge_set_working_art',
                       'forge_set_art_placeholder','forge_log_art_download')) as rpc_count;
```
Expected: `col_count = 8`, `rls_enabled = true`, `rpc_count = 4`.

- [ ] **Step 4: Verify anon cannot read the table or execute the RPCs**

Run via `mcp__supabase__execute_sql`:

```sql
select
  has_table_privilege('anon','public.forge_cards','SELECT')          as anon_can_select,
  has_function_privilege('anon','public.forge_create_card(text)','EXECUTE') as anon_can_create;
```
Expected: both `false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/050_forge_cards_art.sql
git commit -m "feat(forge): forge_cards identity table + art RPCs (1a.3)"
```

---

### Task 2: Extend the anon-leak guardrail for `forge_cards` + art RPCs

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts`

**Interfaces:**
- Consumes: the table/RPCs from Task 1.

- [ ] **Step 1: Add `forge_cards` to the table list**

In `__tests__/forge-anon-leak.test.ts`, change the `FORGE_TABLES` constant:

```ts
const FORGE_TABLES = ["playtest_members", "forge_invites", "forge_audit", "forge_cards"];
```

- [ ] **Step 2: Add the four new RPCs to the anon-cannot-exec probes**

Append these entries to the `FORGE_RPCS` array (after the existing `forge_list_invites` entry):

```ts
    ["forge_create_card", { p_title: "x" }],
    ["forge_set_working_art", { p_card_id: "00000000-0000-0000-0000-000000000000", p_key: "x", p_original_key: "x" }],
    ["forge_set_art_placeholder", { p_card_id: "00000000-0000-0000-0000-000000000000", p_is_placeholder: true }],
    ["forge_log_art_download", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
```

- [ ] **Step 3: Run the security test and verify it passes**

Run: `npm run test:security`
Expected: PASS — `anon sees zero rows in forge_cards` and `anon cannot execute forge_create_card` (+ the three other new RPCs) all green, alongside the existing probes.

(Requires `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, same as for 1a.1/1a.2.)

- [ ] **Step 4: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): extend anon-leak guardrail for forge_cards + art RPCs"
```

---

### Task 3: Private-blob art helpers (`art.ts`)

**Files:**
- Create: `app/forge/lib/art.ts`
- Test: `app/forge/lib/__tests__/art.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 4, 5): `ALLOWED_ART_TYPES: readonly string[]`, `MAX_ART_BYTES: number`, `validateArtFile(file: { type: string; size: number }): string | null`, `uploadForgeArt(file: File): Promise<string>` (returns the stored blob pathname/key), `readForgeArt(key: string): Promise<GetBlobResult>`, `deleteForgeArt(key: string): Promise<void>`.

- [ ] **Step 1: Write the failing test for `validateArtFile`**

Create `app/forge/lib/__tests__/art.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateArtFile, MAX_ART_BYTES } from "@/app/forge/lib/art";

describe("validateArtFile", () => {
  it("accepts a normal PNG", () => {
    expect(validateArtFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("rejects a non-image type", () => {
    expect(validateArtFile({ type: "application/pdf", size: 1024 })).toMatch(/Invalid file type/);
  });

  it("rejects a file over the size cap", () => {
    expect(validateArtFile({ type: "image/png", size: MAX_ART_BYTES + 1 })).toMatch(/too large/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/art.test.ts`
Expected: FAIL — cannot resolve `@/app/forge/lib/art`.

- [ ] **Step 3: Write `art.ts`**

Create `app/forge/lib/art.ts`:

```ts
// Server-only helpers for Forge private card art.
// DO NOT import this module into a "use client" component — it uses the
// server-only BLOB_READ_WRITE_TOKEN and the PRIVATE Vercel Blob store. Art is
// uploaded with access:'private' under unguessable UUID keys and read back
// server-side; the browser only ever sees the /forge/api/art proxy URL.
import { randomUUID } from "crypto";
import { put, get, del, type GetBlobResult } from "@vercel/blob";

const ART_PREFIX = "forge-art/";
export const ALLOWED_ART_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_ART_BYTES = 15 * 1024 * 1024; // 15MB

/** Returns an error string if the file is unacceptable, or null if valid. Pure. */
export function validateArtFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_ART_TYPES.includes(file.type as (typeof ALLOWED_ART_TYPES)[number])) {
    return "Invalid file type. Accepted: JPEG, PNG, WebP.";
  }
  if (file.size > MAX_ART_BYTES) {
    return "File too large. Maximum 15MB.";
  }
  return null;
}

/** Upload to the PRIVATE blob store under an unguessable UUID key. Returns the stored pathname. */
export async function uploadForgeArt(file: File): Promise<string> {
  const key = `${ART_PREFIX}${randomUUID()}`;
  const blob = await put(key, file, {
    access: "private",
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN!,
    contentType: file.type,
  });
  return blob.pathname;
}

/** Server-side read of a private art blob by its stored key. */
export function readForgeArt(key: string): Promise<GetBlobResult> {
  return get(key, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN! });
}

/** Best-effort delete of a private art blob (used when art is replaced). Non-fatal on failure. */
export async function deleteForgeArt(key: string): Promise<void> {
  try {
    await del(key, { token: process.env.BLOB_READ_WRITE_TOKEN! });
  } catch {
    // A dangling private+UUID blob is invisible and harmless; don't fail the request.
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/art.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/art.ts app/forge/lib/__tests__/art.test.ts
git commit -m "feat(forge): private-blob art helpers"
```

---

### Task 4: Card server actions (`cards.ts`)

**Files:**
- Create: `app/forge/lib/cards.ts`

**Interfaces:**
- Consumes: `requireForge`/`requireElder` from `@/app/forge/lib/auth`; `validateArtFile`/`uploadForgeArt` from `@/app/forge/lib/art`; RPCs from Task 1.
- Produces (consumed by Task 7): `createCard(title: string): Promise<{ ok: true; id: string } | { ok: false; error: string }>`, `uploadArt(cardId: string, formData: FormData): Promise<{ ok: boolean; error?: string }>`, `setPlaceholder(cardId: string, isPlaceholder: boolean): Promise<{ ok: boolean; error?: string }>`, `listMyForgeCards(): Promise<ForgeCardRow[]>` where `ForgeCardRow = { id: string; title: string | null; working_art_key: string | null; working_art_is_placeholder: boolean; updated_at: string }`.

- [ ] **Step 1: Write `cards.ts`**

Create `app/forge/lib/cards.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt } from "@/app/forge/lib/art";

export type ForgeCardRow = {
  id: string;
  title: string | null;
  working_art_key: string | null;
  working_art_is_placeholder: boolean;
  updated_at: string;
};

export async function createCard(
  title: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_create_card", { p_title: title });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create card" };
  revalidatePath("/forge/art");
  return { ok: true, id: data };
}

export async function uploadArt(
  cardId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided" };
  const invalid = validateArtFile(file);
  if (invalid) return { ok: false, error: invalid };

  const key = await uploadForgeArt(file);
  // No image processing in 1a.3: the uploaded file IS the original.
  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: key,
    p_original_key: key,
  });
  if (error) return { ok: false, error: "Could not save art" };
  revalidatePath("/forge/art");
  return { ok: true };
}

export async function setPlaceholder(
  cardId: string,
  isPlaceholder: boolean
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_set_art_placeholder", {
    p_card_id: cardId,
    p_is_placeholder: isPlaceholder,
  });
  if (error) return { ok: false, error: "Could not update placeholder" };
  revalidatePath("/forge/art");
  return { ok: true };
}

export async function listMyForgeCards(): Promise<ForgeCardRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, working_art_key, working_art_is_placeholder, updated_at")
    .eq("owner_id", ctx.user.id)
    .order("updated_at", { ascending: false });
  return (data ?? []) as ForgeCardRow[];
}
```

- [ ] **Step 2: Typecheck the new module**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `app/forge/lib/cards.ts`.

(There is no hermetic unit test here — these actions require auth cookies + network. The validation guard path is covered by Task 3's `validateArtFile` test; the full action path is covered by Task 8's manual happy-path. Type-correctness is the gate for this task.)

- [ ] **Step 3: Commit**

```bash
git add app/forge/lib/cards.ts
git commit -m "feat(forge): card + art server actions"
```

---

### Task 5: Authed streaming art proxy (`route.ts`)

**Files:**
- Create: `app/forge/api/art/[cardId]/route.ts`
- Test: `app/forge/api/art/[cardId]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireForge`/`notFoundResponse` from `@/app/forge/lib/auth`; `readForgeArt` from `@/app/forge/lib/art`; `forge_cards` SELECT (RLS) + `forge_log_art_download` RPC from Task 1.
- Produces: `GET(req: NextRequest, ctx: { params: Promise<{ cardId: string }> }): Promise<Response>`.

- [ ] **Step 1: Write the failing unauth→404 unit test**

Create `app/forge/api/art/[cardId]/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth gate so we can force the unauthenticated branch hermetically.
vi.mock("@/app/forge/lib/auth", () => ({
  requireForge: vi.fn(),
  notFoundResponse: () => new Response("Not Found", { status: 404 }),
}));
// Blob read must never be reached on the unauth path; stub it so an accidental
// call would be obvious (and to avoid importing the real @vercel/blob).
vi.mock("@/app/forge/lib/art", () => ({ readForgeArt: vi.fn() }));

import { GET } from "@/app/forge/api/art/[cardId]/route";
import { requireForge } from "@/app/forge/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";

describe("GET /forge/api/art/[cardId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the caller is not a Forge member", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/forge/api/art/[cardId]/__tests__/route.test.ts"`
Expected: FAIL — cannot resolve `@/app/forge/api/art/[cardId]/route`.

- [ ] **Step 3: Write the proxy route**

Create `app/forge/api/art/[cardId]/route.ts`:

```ts
import { type NextRequest } from "next/server";
import { requireForge, notFoundResponse } from "@/app/forge/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
): Promise<Response> {
  const ctx = await requireForge();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  const { cardId } = await params;

  // RLS-checked lookup: only Forge members can see any row; non-members are
  // already rejected above. maybeSingle() → null (not throw) on no/invalid id.
  const { data: card } = await ctx.supabase
    .from("forge_cards")
    .select("working_art_key")
    .eq("id", cardId)
    .maybeSingle();

  if (!card?.working_art_key) return notFoundResponse();

  const result = await readForgeArt(card.working_art_key);
  if (result.statusCode !== 200) return notFoundResponse();

  const download = req.nextUrl.searchParams.get("download") === "1";
  if (download) {
    // Best-effort audit; never block the download on a logging failure.
    await ctx.supabase.rpc("forge_log_art_download", { p_card_id: cardId });
  }

  const headers = new Headers({
    "Content-Type": result.blob.contentType,
    "Cache-Control": "private, no-store",
  });
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="card-${cardId}"`);
  }
  return new Response(result.stream, { headers });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "app/forge/api/art/[cardId]/__tests__/route.test.ts"`
Expected: PASS — 404 returned, `readForgeArt` not called.

- [ ] **Step 5: Commit**

```bash
git add "app/forge/api/art/[cardId]/route.ts" "app/forge/api/art/[cardId]/__tests__/route.test.ts"
git commit -m "feat(forge): authed private-art streaming proxy"
```

---

### Task 6: Guardrail — ban `next/image` under `app/forge/**`

**Files:**
- Create: `__tests__/forge-no-next-image.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: a hermetic static-source guardrail that fails the build if any file under `app/forge/` imports `next/image` or references `next/legacy/image`.

- [ ] **Step 1: Write the guardrail test**

Create `__tests__/forge-no-next-image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// The spec forbids next/image under app/forge/** — private Blob shares the
// storage domain family that next.config.js wildcards, so <Image> could
// CDN-cache a public optimized variant of secret art. Forge art uses plain <img>
// against the /forge/api/art proxy only. (This repo has no ESLint; this static
// scan is the CI guardrail, and it runs in the default `npm test`.)
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}

describe("Forge next/image ban", () => {
  it("no file under app/forge imports next/image", () => {
    const offenders = walk(join(process.cwd(), "app", "forge")).filter((file) => {
      const src = readFileSync(file, "utf8");
      return /from\s+["']next\/(legacy\/)?image["']/.test(src) || /["']next\/(legacy\/)?image["']/.test(src);
    });
    expect(offenders, `next/image is banned under app/forge:\n${offenders.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes against current code**

Run: `npx vitest run __tests__/forge-no-next-image.test.ts`
Expected: PASS — no current `app/forge` file imports `next/image`. (This guardrail now protects Task 7.)

- [ ] **Step 3: Commit**

```bash
git add __tests__/forge-no-next-image.test.ts
git commit -m "test(forge): guardrail banning next/image under app/forge"
```

---

### Task 7: Thin art panel (`/forge/art`)

**Files:**
- Create: `app/forge/art/page.tsx`
- Create: `app/forge/art/ArtPanel.tsx`

**Interfaces:**
- Consumes: `requireElder` from `@/app/forge/lib/auth`; `listMyForgeCards`/`createCard`/`uploadArt`/`setPlaceholder` + `ForgeCardRow` from `@/app/forge/lib/cards`.

- [ ] **Step 1: Write the server page**

Create `app/forge/art/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireElder } from "@/app/forge/lib/auth";
import { listMyForgeCards } from "@/app/forge/lib/cards";
import ArtPanel from "./ArtPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeArtPage() {
  const ctx = await requireElder();
  if (!ctx) notFound();
  const cards = await listMyForgeCards();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Card Art
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload private art for your cards. Art is served only to Forge members through an authenticated proxy.
      </p>
      <ArtPanel cards={cards} />
    </main>
  );
}
```

- [ ] **Step 2: Write the client panel**

Create `app/forge/art/ArtPanel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCard, uploadArt, setPlaceholder, type ForgeCardRow } from "@/app/forge/lib/cards";

export default function ArtPanel({ cards }: { cards: ForgeCardRow[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function onCreate() {
    setError(null);
    const res = await createCard(title);
    if (!res.ok) return setError(res.error);
    setTitle("");
    refresh();
  }

  async function onUpload(cardId: string, file: File) {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadArt(cardId, fd);
    if (!res.ok) return setError(res.error ?? "Upload failed");
    refresh();
  }

  async function onTogglePlaceholder(card: ForgeCardRow) {
    setError(null);
    const res = await setPlaceholder(card.id, !card.working_art_is_placeholder);
    if (!res.ok) return setError(res.error ?? "Update failed");
    refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New card title (optional)"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={onCreate}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          New card
        </button>
      </div>

      {cards.length === 0 && <p className="text-sm text-muted-foreground">No cards yet.</p>}

      <ul className="space-y-4">
        {cards.map((card) => (
          <li key={card.id} className="rounded-lg border p-4">
            <div className="flex items-start gap-4">
              <div className="relative h-40 w-28 shrink-0 overflow-hidden rounded-md border bg-muted">
                {card.working_art_key ? (
                  // Plain <img> ONLY — next/image is banned under app/forge (see guardrail test).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/forge/api/art/${card.id}`}
                    alt={card.title ?? "card art"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    No art
                  </div>
                )}
                {card.working_art_is_placeholder && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="rotate-[-20deg] text-xs font-bold tracking-widest text-white">
                      PLACEHOLDER
                    </span>
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <p className="truncate font-medium">{card.title ?? "Untitled"}</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload(card.id, f);
                    e.target.value = "";
                  }}
                  className="block w-full text-xs"
                />
                <div className="flex flex-wrap gap-3 text-sm">
                  <button onClick={() => onTogglePlaceholder(card)} className="text-emerald-600 hover:underline">
                    {card.working_art_is_placeholder ? "Unmark placeholder" : "Mark placeholder"}
                  </button>
                  {card.working_art_key && (
                    <a href={`/forge/api/art/${card.id}?download=1`} className="text-emerald-600 hover:underline">
                      Download original
                    </a>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify the guardrail still passes (panel uses `<img>`, not `<Image>`)**

Run: `npx vitest run __tests__/forge-no-next-image.test.ts`
Expected: PASS — the panel uses plain `<img>`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/forge/art/page.tsx app/forge/art/ArtPanel.tsx
git commit -m "feat(forge): thin art panel for the private art pipeline"
```

---

### Task 8: End-to-end verification + production build

**Files:** none (verification only).

- [ ] **Step 1: Full hermetic test suite**

Run: `npm test`
Expected: PASS, including `forge-no-next-image`, `art`, and the proxy route unit test. (The network-gated leak test only runs under `npm run test:security`.)

- [ ] **Step 2: Security guardrail**

Run: `npm run test:security`
Expected: PASS — `forge_cards` + the four art RPCs are anon-locked.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: success; `/forge/art` and `/forge/api/art/[cardId]` appear in the route manifest.

- [ ] **Step 4: Manual happy path (as an elder/superadmin — e.g. baboonytim)**

Run `npm run dev`, sign in as a Forge elder/superadmin, then:
1. Visit `/forge/art` → loads (non-members get 404 — verify by signing out and reloading: expect 404, not a redirect).
2. Create a card → it appears with "No art".
3. Upload a PNG/JPEG/WebP → the preview renders via `/forge/api/art/<id>` (check DevTools Network: the image request hits **your app domain**, not `*.blob.vercel-storage.com`, and the response has `Cache-Control: private, no-store`).
4. "Download original" → file downloads (Content-Disposition attachment).
5. "Mark placeholder" → the diagonal PLACEHOLDER stamp overlays the art.

- [ ] **Step 5: Manual leak checks (spec leak-test steps 3–4)**

1. Copy a real card id from step 4. In a private window (signed out), `curl -i http://localhost:3000/forge/api/art/<id>` → **404** (no bytes, no redirect).
2. Confirm the audit row: via `mcp__supabase__execute_sql`, `select action, target from public.forge_audit where action = 'art_download' order by at desc limit 1;` → shows your download.
3. Confirm the raw blob URL is not guessable/public: there is no public URL exposed anywhere in the page source or network tab — only `/forge/api/art/<id>` paths.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(forge): 1a.3 private art pipeline verification"
```

---

## Self-Review

**Spec coverage** (spec §"Image isolation" + §Phasing "Private art upload/serving"):
- Private Blob `access:'private'` + UUID keys → Task 3 (`uploadForgeArt`).
- Authed proxy `GET /forge/api/art/[cardId]`, 404-gate, RLS lookup, server fetch, `private, no-store` → Task 5.
- `next/image` ban under `app/forge/**` → Task 6 (Vitest guardrail; deviation from "lint rule" documented).
- Placeholder + original handling, "download original" `?download=1` + audit → Tasks 1 (cols/RPC), 5 (proxy), 7 (UI).
- Broadened anon-leak test (new table + RPCs) + route-404/blob-domain manual checks → Tasks 2, 8.
- `forge_cards` identity (minimal) → Task 1.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `ForgeCardRow` defined in Task 4, imported in Task 7. `uploadForgeArt` returns `string` (key), consumed in Task 4 and stored, read in Task 5 via `readForgeArt`. `GetBlobResult` 200 shape (`stream`, `blob.contentType`) matches `@vercel/blob` v2.3.0. RPC names/params match between Task 1 (definition), Task 2 (anon probes), Task 4/5 (callers).

**Scope check:** single implementation plan; the card *content* model and studio UI are explicitly deferred.
