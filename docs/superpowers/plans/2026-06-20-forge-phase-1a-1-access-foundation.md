# The Forge — Phase 1a.1: Access & Security Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the secure, invite-only `/forge` shell — the roles data model, the `requireForge`/`requireElder`/`requireForgeSuperadmin` gate (404 to everyone else), a seeded superadmin, and the keystone anon-leak test — so every later Forge feature is built on a verified leak-proof foundation.

**Architecture:** A dedicated `playtest_members` table with a `playtest_role` enum (not overloading `admin_users`). `SECURITY DEFINER STABLE` helpers (pinned `search_path`) read membership without tripping the caller's RLS. A route-level gate cloned from the existing `requireThreshingFloor` pattern returns 404 (not 403) to non-members. A default-deny RLS posture (no `anon` policy + `REVOKE ALL FROM anon`) plus an automated anon-leak test make "nothing leaks" verifiable.

**Tech Stack:** Next.js 15 App Router (RSC + route handlers), TypeScript, Supabase (Postgres + Auth + RLS), `@supabase/ssr` server/client helpers, Vitest (unit + the env-gated security test), `@supabase/supabase-js` (anon client in the leak test).

**Scope note:** This is plan **1 of the Phase 1a sequence**. It delivers the secure shell + the seeded superadmin only. Invites, member management, and onboarding UI are the next plan (1a.2) — see "Remaining Phase 1a plans" at the bottom. Reference spec: `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md`.

## Global Constraints

- **Roles:** enum `playtest_role` = `('superadmin','elder','playtester')`; hierarchical (elder ⊇ playtester). One `playtest_members` row per member.
- **Superadmin encoding:** a DB row keyed by `auth.users.id` (baboonytim = `6d30f6e3-838e-4f11-9416-95996da6e5b9`, from migration 044), seeded by migration resolving the UID — never a hardcoded username/email in policy/app code. A `BEFORE UPDATE/DELETE` trigger forbids removing/demoting the **last** superadmin.
- **RLS posture:** every Forge table has RLS enabled, policies `TO authenticated` only, **no `anon` policy**, plus explicit `REVOKE ALL … FROM anon`. Helpers are `SECURITY DEFINER STABLE` with `SET search_path = ''` (avoid the circular-RLS trap from migration 009; do not copy migration 005's self-referential policies).
- **Gate:** `requireForge()`/`requireElder()`/`requireForgeSuperadmin()` return `null` for unauthorized callers; callers respond **404, not 403** (keep the area secret). No reliance on Next.js middleware — `middleware.ts` excludes `api/` and only guards `/tracker`,`/admin`, so the in-route gate is the only defense.
- **Routing:** all `/forge` routes set `export const dynamic = "force-dynamic"` and `export const revalidate = 0`; never statically generated.
- **Migrations:** schema only, self-contained, **no real card data**. Next migration number is `048`.
- **Keystone guardrail:** an automated test asserts the public/anon role sees **zero rows** in every Forge table; it is the gate on "nothing leaks."

---

## File Structure

- `supabase/migrations/048_forge_access_foundation.sql` — **Create.** Role enum, `playtest_members`, SECURITY DEFINER helpers, last-superadmin trigger, RLS, grants/revokes, superadmin seed. One responsibility: the access data model + its security.
- `app/forge/lib/auth.ts` — **Create.** The gate: `requireForge`, `requireElder`, `requireForgeSuperadmin`, `notFoundResponse`. One responsibility: turn a request into an authorized Forge context (or null).
- `app/forge/lib/__tests__/auth.test.ts` — **Create.** Unit tests for the gate (mock the Supabase server client).
- `app/forge/layout.tsx` — **Create.** Gates the whole route group (`force-dynamic`, `notFound()` if not a member).
- `app/forge/page.tsx` — **Create.** Minimal role-aware landing ("desk").
- `__tests__/forge-anon-leak.test.ts` — **Create.** The keystone anon-leak security test (env-gated integration test).
- `package.json` — **Modify.** Add a `test:security` script.

---

## Task 1: Access-foundation migration (roles, members, helpers, seed, RLS)

**Files:**
- Create: `supabase/migrations/048_forge_access_foundation.sql`
- Verify: Supabase MCP `execute_sql` / `get_advisors` (no new file)

**Interfaces:**
- Produces (consumed by Task 2 + later plans):
  - SQL fn `public.my_forge_role() returns text` — current user's role or NULL.
  - SQL fn `public.forge_role_of(uid uuid) returns text`.
  - SQL fn `public.is_forge_member() returns boolean`.
  - SQL fn `public.is_forge_elder_or_super() returns boolean`.
  - Table `public.playtest_members(user_id uuid pk, role public.playtest_role, display_name text, avatar_url text, invited_by uuid, created_at timestamptz)`.
  - Enum `public.playtest_role` = `('superadmin','elder','playtester')`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/048_forge_access_foundation.sql`:

```sql
-- Forge (private card design & playtesting) — access & security foundation.
-- Role enum + membership table, SECURITY DEFINER helpers, superadmin seed,
-- last-superadmin protection, default-deny RLS. SCHEMA ONLY — no card data.

-- 1) Role enum
do $$ begin
  create type public.playtest_role as enum ('superadmin','elder','playtester');
exception when duplicate_object then null; end $$;

-- 2) Membership (one row per member; highest role)
create table if not exists public.playtest_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         public.playtest_role not null,
  display_name text,
  avatar_url   text,
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

alter table public.playtest_members enable row level security;

-- 3) SECURITY DEFINER helpers. search_path pinned; reads the table outside the
--    caller's RLS so policies that call them don't recurse (cf. migration 009).
create or replace function public.my_forge_role()
returns text language sql security definer stable set search_path = '' as $$
  select role::text from public.playtest_members where user_id = auth.uid();
$$;

create or replace function public.forge_role_of(uid uuid)
returns text language sql security definer stable set search_path = '' as $$
  select role::text from public.playtest_members where user_id = uid;
$$;

create or replace function public.is_forge_member()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists(select 1 from public.playtest_members where user_id = auth.uid());
$$;

create or replace function public.is_forge_elder_or_super()
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    (select role from public.playtest_members where user_id = auth.uid())
      in ('elder','superadmin'), false);
$$;

grant execute on function public.my_forge_role() to authenticated;
grant execute on function public.forge_role_of(uuid) to authenticated;
grant execute on function public.is_forge_member() to authenticated;
grant execute on function public.is_forge_elder_or_super() to authenticated;

-- 4) Last-superadmin protection
create or replace function public.forge_protect_last_superadmin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare remaining int;
begin
  select count(*) into remaining
  from public.playtest_members
  where role = 'superadmin'
    and user_id <> coalesce(old.user_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if tg_op = 'DELETE' then
    if old.role = 'superadmin' and remaining = 0 then
      raise exception 'cannot remove the last superadmin';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.role = 'superadmin' and new.role <> 'superadmin' and remaining = 0 then
      raise exception 'cannot demote the last superadmin';
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists forge_protect_last_superadmin on public.playtest_members;
create trigger forge_protect_last_superadmin
  before update or delete on public.playtest_members
  for each row execute function public.forge_protect_last_superadmin();

-- 5) RLS: members may read the membership list. No direct write policy — writes
--    land in plan 1a.2 via SECURITY DEFINER RPCs. anon gets nothing.
create policy "forge_members_select" on public.playtest_members
  for select to authenticated
  using (public.is_forge_member());

-- 6) Default-deny hardening for the public/anon role
revoke all on public.playtest_members from anon;
grant select on public.playtest_members to authenticated;

-- 7) Seed the superadmin (baboonytim). UID from migration 044. Fail loudly if
--    the auth.users row is missing. CONFIRM this UID is baboonytim before apply.
do $$
declare super uuid := '6d30f6e3-838e-4f11-9416-95996da6e5b9';
begin
  if not exists (select 1 from auth.users where id = super) then
    raise exception 'superadmin seed failed: no auth.users row for %', super;
  end if;
  insert into public.playtest_members (user_id, role, display_name)
  values (super, 'superadmin', 'baboonytim')
  on conflict (user_id) do update set role = 'superadmin';
end $$;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name: `forge_access_foundation`, the SQL above) or `supabase db push`.
Expected: success, no errors. If the seed raises `superadmin seed failed: no auth.users row for …`, stop and confirm baboonytim's real UID (query `select id, email from auth.users where email ilike '%baboony%' or email = 'landofredemption@gmail.com';`), correct the seed, and re-apply.

- [ ] **Step 3: Verify schema + seed via SQL**

Run via Supabase MCP `execute_sql`:
```sql
select public.forge_role_of('6d30f6e3-838e-4f11-9416-95996da6e5b9') as super_role,
       (select count(*) from public.playtest_members) as member_count;
```
Expected: `super_role = 'superadmin'`, `member_count = 1`.

- [ ] **Step 4: Verify the last-superadmin guard fires**

Run via Supabase MCP `execute_sql`:
```sql
do $$ begin
  begin
    delete from public.playtest_members where role = 'superadmin';
    raise exception 'GUARD FAILED: delete succeeded';
  exception when others then
    raise notice 'guard ok: %', sqlerrm;
  end;
end $$;
```
Expected: a notice `guard ok: cannot remove the last superadmin`; the row still exists (re-run Step 3 → `member_count = 1`).

- [ ] **Step 5: Run Supabase security advisors**

Run Supabase MCP `get_advisors` (type: `security`).
Expected: no new ERROR-level findings referencing `playtest_members` or the new functions (e.g., no "function search_path mutable", no "RLS disabled"). Fix any that appear before continuing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/048_forge_access_foundation.sql
git commit -m "feat(forge): access-foundation migration — roles, members, helpers, superadmin seed, RLS"
```

---

## Task 2: The Forge gate (`requireForge` / `requireElder` / `requireForgeSuperadmin`)

**Files:**
- Create: `app/forge/lib/auth.ts`
- Test: `app/forge/lib/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/utils/supabase/server`; RPC `my_forge_role` (Task 1).
- Produces (consumed by Tasks 3–4 + later plans):
  - `type ForgeRole = "superadmin" | "elder" | "playtester"`
  - `requireForge(): Promise<{ supabase: SupabaseClient; user: User; role: ForgeRole } | null>`
  - `requireElder(): Promise<…same… | null>` (null unless elder/superadmin)
  - `requireForgeSuperadmin(): Promise<…same… | null>` (null unless superadmin)
  - `notFoundResponse(): Response` (404)

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "@/utils/supabase/server";
import { requireForge, requireElder, requireForgeSuperadmin } from "../auth";

function mockClient({ user, role }: { user: any; role: string | null }) {
  (createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: user ? null : new Error("no session"),
      })),
    },
    rpc: vi.fn(async (fn: string) =>
      fn === "my_forge_role" ? { data: role, error: null } : { data: null, error: null }
    ),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("requireForge", () => {
  it("returns null when not signed in", async () => {
    mockClient({ user: null, role: null });
    expect(await requireForge()).toBeNull();
  });
  it("returns null when signed in but not a member", async () => {
    mockClient({ user: { id: "u1" }, role: null });
    expect(await requireForge()).toBeNull();
  });
  it("returns ctx with role for a member", async () => {
    mockClient({ user: { id: "u1" }, role: "playtester" });
    const ctx = await requireForge();
    expect(ctx?.role).toBe("playtester");
    expect(ctx?.user.id).toBe("u1");
  });
});

describe("requireElder", () => {
  it("null for a playtester", async () => {
    mockClient({ user: { id: "u1" }, role: "playtester" });
    expect(await requireElder()).toBeNull();
  });
  it("ok for an elder", async () => {
    mockClient({ user: { id: "u1" }, role: "elder" });
    expect((await requireElder())?.role).toBe("elder");
  });
  it("ok for a superadmin", async () => {
    mockClient({ user: { id: "u1" }, role: "superadmin" });
    expect((await requireElder())?.role).toBe("superadmin");
  });
});

describe("requireForgeSuperadmin", () => {
  it("null for an elder", async () => {
    mockClient({ user: { id: "u1" }, role: "elder" });
    expect(await requireForgeSuperadmin()).toBeNull();
  });
  it("ok for a superadmin", async () => {
    mockClient({ user: { id: "u1" }, role: "superadmin" });
    expect((await requireForgeSuperadmin())?.role).toBe("superadmin");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/forge/lib/__tests__/auth.test.ts`
Expected: FAIL — cannot resolve `../auth` (module does not exist yet).

- [ ] **Step 3: Write the gate**

Create `app/forge/lib/auth.ts`:

```ts
import { createClient } from "@/utils/supabase/server";

export type ForgeRole = "superadmin" | "elder" | "playtester";

type ForgeContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
  role: ForgeRole;
};

/**
 * Gate for everything under /forge. Returns the Supabase client, user, and the
 * caller's Forge role, or null when the caller is not a Forge member.
 * Callers respond 404 (not 401/403) so the area stays secret.
 */
export async function requireForge(): Promise<ForgeContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: role } = await supabase.rpc("my_forge_role");
  if (role !== "superadmin" && role !== "elder" && role !== "playtester") return null;

  return { supabase, user, role: role as ForgeRole };
}

export async function requireElder(): Promise<ForgeContext | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  return ctx.role === "elder" || ctx.role === "superadmin" ? ctx : null;
}

export async function requireForgeSuperadmin(): Promise<ForgeContext | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  return ctx.role === "superadmin" ? ctx : null;
}

export function notFoundResponse() {
  return new Response("Not Found", { status: 404 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/forge/lib/__tests__/auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/auth.ts app/forge/lib/__tests__/auth.test.ts
git commit -m "feat(forge): requireForge/requireElder/requireForgeSuperadmin gate (404-not-403)"
```

---

## Task 3: Gated `/forge` route group (layout + landing)

**Files:**
- Create: `app/forge/layout.tsx`
- Create: `app/forge/page.tsx`

**Interfaces:**
- Consumes: `requireForge` from `./lib/auth` (Task 2); `notFound` from `next/navigation`.
- Produces: the `/forge` route group shell that all later Forge pages nest under.

- [ ] **Step 1: Write the gated layout**

Create `app/forge/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "./lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  return <div className="min-h-screen">{children}</div>;
}
```

- [ ] **Step 2: Write the landing page**

Create `app/forge/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "./lib/auth";

export const dynamic = "force-dynamic";

export default async function ForgeDeskPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        The Forge
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {ctx.user.email ?? ctx.user.id} · role:{" "}
        <span className="font-medium">{ctx.role}</span>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck the new files**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `app/forge/layout.tsx` or `app/forge/page.tsx`. (Pre-existing errors elsewhere, if any, are out of scope — confirm none are in `app/forge/**`.)

- [ ] **Step 4: Manual verification in the running app**

Run `npm run dev`. Then:
1. **As the seeded superadmin** (sign in as baboonytim), visit `http://localhost:3000/forge` → the page renders with `role: superadmin`.
2. **As a signed-in non-member** (any other account), visit `/forge` → Next.js 404 page.
3. **Signed out**, visit `/forge` → 404.

Expected: only the superadmin sees the page; everyone else gets 404 (not a redirect or 403).

- [ ] **Step 5: Commit**

```bash
git add app/forge/layout.tsx app/forge/page.tsx
git commit -m "feat(forge): gated /forge route group shell + landing"
```

---

## Task 4: Keystone anon-leak security test

**Files:**
- Create: `__tests__/forge-anon-leak.test.ts`
- Modify: `package.json` (add `test:security` script)

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local`; the `playtest_members` table (Task 1).
- Produces: `npm run test:security` — fails the build if the public/anon role can read any Forge table. The `FORGE_TABLES` array is the extension point as later plans add tables.

- [ ] **Step 1: Write the test**

Create `__tests__/forge-anon-leak.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load local env (Next convention); CI provides these as secrets.
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Opt-in: only runs under `npm run test:security` so the default unit run stays
// hermetic (no network). Requires the Supabase env to be present.
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON;

// Every table that holds Forge secret data. EXTEND THIS as new Forge tables are
// added in later plans. The anon (public) role must see ZERO rows in each.
const FORGE_TABLES = ["playtest_members"];

describe.runIf(ENABLED)("Forge anon-leak guardrail", () => {
  const anon = createClient(URL!, ANON!);

  for (const table of FORGE_TABLES) {
    it(`anon sees zero rows in ${table}`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1000);
      const rows = data ?? [];
      // A permission error (REVOKE) or an empty result (RLS) is fine; a leak is not.
      expect(
        rows.length,
        `anon leaked ${rows.length} row(s) from ${table} (error: ${error?.message ?? "none"})`
      ).toBe(0);
    });
  }
});
```

- [ ] **Step 2: Add the `test:security` script**

Modify `package.json` — add to `"scripts"` (after `"test:e2e"`):

```json
    "test:security": "FORGE_LEAK_TEST=1 vitest run forge-anon-leak"
```

- [ ] **Step 3: Verify the default unit run still skips it (hermetic)**

Run: `npm test -- forge-anon-leak`
Expected: the suite is **skipped** (no `FORGE_LEAK_TEST=1`), so it does not hit the network. 0 failures.

- [ ] **Step 4: Run the security test against the real DB**

Run: `npm run test:security`
Expected: PASS — `anon sees zero rows in playtest_members` (the seeded superadmin row is NOT visible to anon). If it FAILS reporting leaked rows, the migration's `REVOKE`/RLS is wrong — fix Task 1 before proceeding.

- [ ] **Step 5: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts package.json
git commit -m "test(forge): keystone anon-leak guardrail + test:security script"
```

---

## Self-Review

**Spec coverage (for this plan's slice — the security/access foundation):**
- Dedicated `playtest_members` + role enum, not overloading `admin_users` → Task 1. ✅
- Superadmin = seeded UID row + last-superadmin trigger → Task 1 (Steps 1, 4). ✅
- SECURITY DEFINER helpers, pinned `search_path`, no circular RLS → Task 1. ✅
- Default-deny RLS (`TO authenticated` only, no anon policy, `REVOKE ALL FROM anon`) → Task 1. ✅
- 404-not-403 gate, no middleware reliance, role hierarchy → Task 2. ✅
- `force-dynamic`/`revalidate = 0` route group → Task 3. ✅
- Keystone anon-leak test (table surface) → Task 4. ✅
- **Deferred to later plans (not gaps):** invites/onboarding/member-management RPCs + UI (1a.2); the broadened leak-test surfaces (definer-grant assertion, route 404 checks, Realtime) wired in as those surfaces are built; art proxy, studio, ideas, sets, lifecycle, dashboard, print (1a.3+).

**Placeholder scan:** none — every step has runnable SQL/TS/commands.

**Type consistency:** `ForgeRole` and the `{ supabase, user, role }` context shape are defined in Task 2 and consumed unchanged in Tasks 3–4. RPC name `my_forge_role` matches between Task 1 (defined) and Task 2 (called). `FORGE_TABLES` references `playtest_members` from Task 1.

---

## Remaining Phase 1a plans (roadmap — written next, not in this plan)

1. **1a.2 — Invites, onboarding & member management:** `forge_invites` + `forge_audit` tables; `SECURITY DEFINER` mint/redeem/add-member/remove-member(+ownership reassignment)/change-role RPCs (role-capped); Resend invite emails; `/forge/invite/[token]` redemption + onboarding; `/forge/admin` roles UI. Extends the leak test with the new tables + definer-grant assertions.
2. **1a.3 — Private art pipeline:** private Vercel Blob (`access:'private'`) upload + UUID keys; the authed `/forge/api/art/[cardId]` proxy + `?download=1`; lint rule forbidding `<Image>` under `app/forge/**`; "download original."
3. **1a.4 — Card studio + ideas library:** `forge_cards` (+ `working_snapshot`), the DesignCard schema, quick-draft/full studio with live preview + placeholder art, `/forge/ideas`.
4. **1a.5 — Sets, lifecycle, dashboard, print:** `forge_sets`/`forge_set_elders`/`forge_set_grants`, set notes + 2-D targets, share-move/publish/approve/archive/delete/send-back lifecycle + `card_versions`, the Brigade×Type progress dashboard, "download all for printer."

Then Phase 1b (collaborative review) and Phase 2 (playtester play) as separate plan sets.
