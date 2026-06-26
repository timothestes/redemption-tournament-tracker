# Forge Phase 2.1 — Playtester Access Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a granted playtester sign in and browse the **approved** cards of sets shared with them (read-only, full card previews with frozen approved art), with elders able to grant/revoke that access via invite or a per-set panel — and a hard role boundary keeping playtesters out of the authoring workspace.

**Architecture:** The read-path RLS already shipped dormant in migration 052 (`forge_set_grants`, `is_forge_set_granted`, granted branches on `forge_sets`/`forge_cards`/`card_versions`). This plan adds the *write* path (grant/revoke RPCs + invite-time grants), a playtester-only UI under `/forge/play`, an elder-only lockdown of authoring routes, and approved-version art serving. No new tables.

**Tech Stack:** Next.js 15 App Router (RSC + server actions), Supabase (Postgres RLS + `SECURITY DEFINER` RPCs), TypeScript (`strict:false`), Vitest, Tailwind + shadcn/ui, Vercel Blob (private store).

**Spec:** `docs/superpowers/specs/2026-06-25-forge-phase-2-1-playtester-access-design.md`

## Global Constraints

- **Secret leak boundary:** every Forge surface carries only opaque UUIDs or streams bytes after a server-side gate. Blob keys (`art_key`/`art_original_key`/`working_art_key`) **never** cross to a client component — derive a boolean/URL instead. (`setArtwork.ts` is the precedent.)
- **Every `/forge` page/layout/route.ts must call a gate itself** (`requireForge`/`requireElder`/`requireForgeSuperadmin`) — there is no `/forge` middleware. The `__tests__/forge-gate-first.test.ts` guardrail fails any route file lacking a literal gate call.
- **All new RPCs:** `SECURITY DEFINER`, `SET search_path = ''`, `revoke execute ... from public, anon`, `grant execute ... to authenticated`. Mirror migration 052's style.
- **404, never 401/403** for non-members (`requireForge` → `notFound()` / `notFoundResponse()`). Playtesters hitting authoring routes get `redirect('/forge/play')`, distinct from the non-member 404.
- **`strict:false` gotcha:** `strictNullChecks` is off, so `if (r.ok)/else` union narrowing is broken. Client consumers of `{ok:true;...}|{ok:false;error}` must narrow with `r.ok === false`. Only `npm run build` catches this — vitest/esbuild does not typecheck.
- **Migration number:** `055` (054 was the last; the set-artwork download added none).
- **Approved-only:** a playtester sees `status='approved'` cards/versions only — never `draft`/`playtesting`/`archived`, never working-draft art.

---

## File Structure

**New files:**
- `supabase/migrations/055_forge_set_grants_write.sql` — grant/revoke RPCs, redeem consumes `set_ids`, grants_select own-row widen.
- `app/forge/lib/play.ts` — `listSetApprovedCards(setId)` server-only reader (carries no blob keys to client).
- `app/forge/play/page.tsx` — granted-sets landing.
- `app/forge/play/[setId]/page.tsx` — approved-card reveal grid.
- `app/forge/play/[setId]/RevealGrid.tsx` — client reveal grid (preview + enlarge overlay).
- `app/forge/sets/[setId]/progress/PlaytesterGrants.tsx` — elder grant/revoke panel.

**Modified files:**
- `app/forge/api/art/[cardId]/route.ts` — `?v=approved` branch.
- `app/forge/api/art/[cardId]/__tests__/route.test.ts` — approved-art branch tests.
- `app/forge/lib/sets.ts` — `grantSet` / `revokeSet` / `listSetGrants`.
- `app/forge/lib/members.ts` — `mintInvite` passes selected `set_ids`.
- `app/forge/page.tsx` — role-aware desk.
- `app/forge/admin/AdminConsole.tsx` — playtester-invite set selector.
- `app/forge/admin/page.tsx` — pass mintable sets to the console.
- `app/forge/sets/[setId]/layout.tsx` — playtester redirect (covers cards/notes/progress/review subtree).
- `app/forge/sets/page.tsx`, `app/forge/ideas/page.tsx`, `app/forge/cards/[cardId]/page.tsx` — playtester redirect.
- `app/forge/sets/[setId]/progress/page.tsx` — fetch grants + grantable playtesters, render `<PlaytesterGrants>`.
- `__tests__/forge-anon-leak.test.ts` — grant/revoke RPC probes + boundary tests.

---

## Task 1: Migration 055 — grant write plumbing

**Files:**
- Create: `supabase/migrations/055_forge_set_grants_write.sql`

**Interfaces:**
- Consumes (already in DB): `is_forge_set_elder(uuid)`, `is_forge_superadmin()`, `forge_set_grants(set_id,user_id,granted_by)`, `forge_invites.set_ids uuid[]`, `forge_audit(actor,action,target)`.
- Produces: RPCs `forge_grant_set(p_set_id uuid, p_user_id uuid) -> void`, `forge_revoke_set(p_set_id uuid, p_user_id uuid) -> void`; replaced `forge_redeem_invite(p_token_hash text, p_nda_agreed boolean) -> text` that also inserts `forge_set_grants` from the invite's `set_ids`; widened `forge_set_grants_select` policy (adds `OR user_id = auth.uid()`).

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/055_forge_set_grants_write.sql`:

```sql
-- 055_forge_set_grants_write.sql
-- Phase 2.1: activate the dormant forge_set_grants plumbing (shipped read-only in 052).
-- Adds grant/revoke RPCs (set-elder or superadmin), makes invite redemption consume the
-- invite's stored set_ids, and lets a playtester read their own grant rows.
-- All functions: SECURITY DEFINER, SET search_path='', anon-revoked (cf. 052).

-- 1) Grant a member read access to a set's approved cards.
create or replace function public.forge_grant_set(p_set_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not authorized to grant this set';
  end if;
  if not exists (select 1 from public.playtest_members where user_id = p_user_id) then
    raise exception 'not a member';
  end if;
  insert into public.forge_set_grants (set_id, user_id, granted_by)
  values (p_set_id, p_user_id, auth.uid())
  on conflict (set_id, user_id) do nothing;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_granted', p_set_id::text || ' -> ' || p_user_id::text);
end; $$;

-- 2) Revoke a member's access to a set.
create or replace function public.forge_revoke_set(p_set_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not authorized to revoke this set';
  end if;
  delete from public.forge_set_grants where set_id = p_set_id and user_id = p_user_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_revoked', p_set_id::text || ' -> ' || p_user_id::text);
end; $$;

-- 3) Redeem now also consumes the invite's stored set_ids (grants in the same txn).
--    Unchanged from 049 except the set-grant loop. Defends against a since-deleted set
--    (the EXISTS guard) so a stale set_id can't abort an otherwise-valid redemption.
create or replace function public.forge_redeem_invite(p_token_hash text, p_nda_agreed boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_invite public.forge_invites; v_set_id uuid;
begin
  if not coalesce(p_nda_agreed, false) then return null; end if;  -- must accept the NDA
  select * into v_invite from public.forge_invites
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   for update;
  if not found then return null; end if;
  if v_invite.email is not null and v_invite.email is distinct from auth.email() then
    return null;  -- email-bound to someone else; same not-found result
  end if;
  insert into public.playtest_members (user_id, role, invited_by, nda_agreed_at)
  values (auth.uid(), v_invite.role, v_invite.invited_by, now())
  on conflict (user_id) do nothing;
  foreach v_set_id in array coalesce(v_invite.set_ids, '{}') loop
    insert into public.forge_set_grants (set_id, user_id, granted_by)
    select v_set_id, auth.uid(), v_invite.invited_by
    where exists (select 1 from public.forge_sets s where s.id = v_set_id)
    on conflict (set_id, user_id) do nothing;
  end loop;
  update public.forge_invites set used_at = now() where id = v_invite.id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'member_added', v_invite.id::text);
  return v_invite.role::text;
end; $$;

-- 4) Let a member read their own grant rows (resolves the 1a.5 "own-row read" follow-up).
drop policy if exists "forge_set_grants_select" on public.forge_set_grants;
create policy "forge_set_grants_select" on public.forge_set_grants
  for select to authenticated
  using (public.is_forge_set_elder(set_id)
         or public.is_forge_superadmin()
         or user_id = auth.uid());

-- 5) Lock down execute on the new functions (anon default-grant stripped; cf. 052).
revoke execute on function public.forge_grant_set(uuid, uuid) from public, anon;
revoke execute on function public.forge_revoke_set(uuid, uuid) from public, anon;
grant execute on function public.forge_grant_set(uuid, uuid) to authenticated;
grant execute on function public.forge_revoke_set(uuid, uuid) to authenticated;
-- forge_redeem_invite keeps its 049 grant (CREATE OR REPLACE preserves it); re-grant defensively.
grant execute on function public.forge_redeem_invite(text, boolean) to authenticated;
```

- [ ] **Step 2: Apply the migration to the live project**

Apply via the Supabase MCP `apply_migration` tool, name `forge_set_grants_write`, with the SQL above. (Per project history, applying a Forge migration needs explicit user authorization — if running headless without it, stop and surface the SQL for the user to apply, then continue.)

Verify it applied:

Run (Supabase MCP `execute_sql`):
```sql
select proname from pg_proc where proname in ('forge_grant_set','forge_revoke_set') order by proname;
```
Expected: two rows — `forge_grant_set`, `forge_revoke_set`.

- [ ] **Step 3: Verify advisors are clean**

Run the Supabase MCP `get_advisors` (type `security`). Expected: no **new** problematic findings beyond the pre-existing benign "function is SECURITY DEFINER / search_path" notices that already apply to the 052 functions.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/055_forge_set_grants_write.sql
git commit -m "feat(forge): migration 055 — set-grant write RPCs + invite-time grants"
```

---

## Task 2: Extend the anon-leak guardrail + RLS boundary probes

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts`

**Interfaces:**
- Consumes: `forge_grant_set`, `forge_revoke_set` (Task 1). `forge_set_grants` is already in `FORGE_TABLES`.
- Produces: nothing consumed downstream — this is a security regression guard.

- [ ] **Step 1: Add the grant/revoke RPC probes**

In `__tests__/forge-anon-leak.test.ts`, append two entries to the `FORGE_RPCS` array (the anon-cannot-execute probe list), after the existing `forge_remove_set_elder` line:

```ts
    ["forge_grant_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_revoke_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_user_id: "00000000-0000-0000-0000-000000000000" }],
```

- [ ] **Step 2: Run the security suite**

Run:
```bash
FORGE_LEAK_TEST=1 npm run test:security
```
Expected: PASS. Every `FORGE_RPCS` probe (including the two new ones) confirms anon cannot execute the function; `forge_set_grants` continues to leak zero rows to anon. (If the env lacks Supabase creds, the suite is `describe.runIf(ENABLED)`-skipped — note that and rely on CI.)

- [ ] **Step 3: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): anon cannot execute forge_grant_set/forge_revoke_set"
```

---

## Task 3: Approved-version art serving (`?v=approved`)

**Files:**
- Modify: `app/forge/api/art/[cardId]/route.ts`
- Test: `app/forge/api/art/[cardId]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireForge()` (returns `{supabase,user,role}|null`), `readForgeArt(key)` (returns `{statusCode,stream,blob:{contentType}}|null`).
- Produces: `GET` serves the **approved version's** art (`art_original_key ?? art_key`) when the request URL has `?v=approved`; default (no param) is unchanged (working-draft art). Reveal `<img>` consumes `/forge/api/art/<cardId>?v=approved`.

- [ ] **Step 1: Write the failing tests**

Add to `app/forge/api/art/[cardId]/__tests__/route.test.ts`. First extend the mock context helper to dispatch by table, then add cases. Add this helper below the existing `memberCtx`:

```ts
// Dispatches forge_cards (approved_version_id) then card_versions (art keys) for ?v=approved.
function approvedCtx(opts: {
  approvedVersionId: string | null;
  version?: { art_original_key: string | null; art_key: string | null; art_is_placeholder: boolean } | null;
}) {
  const from = vi.fn((table: string) => {
    if (table === "forge_cards") {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: opts.approvedVersionId === null ? null : { approved_version_id: opts.approvedVersionId },
      });
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) };
    }
    // card_versions
    const maybeSingle = vi.fn().mockResolvedValue({ data: opts.version ?? null });
    return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) };
  });
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { supabase: { from, rpc }, user: { id: "u1", email: "e@x" }, role: "playtester" };
}
```

Add these test cases inside the `describe`:

```ts
  it("404 when ?v=approved but the card has no approved version", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(approvedCtx({ approvedVersionId: null }));
    const req = new Request("http://localhost/forge/api/art/abc?v=approved") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("404 when the approved version's art is a placeholder", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(approvedCtx({
      approvedVersionId: "v1",
      version: { art_original_key: null, art_key: null, art_is_placeholder: true },
    }));
    const req = new Request("http://localhost/forge/api/art/abc?v=approved") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("streams the approved version's original art for ?v=approved", async () => {
    (requireForge as ReturnType<typeof vi.fn>).mockResolvedValue(approvedCtx({
      approvedVersionId: "v1",
      version: { art_original_key: "forge-art/orig", art_key: "forge-art/disp", art_is_placeholder: false },
    }));
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200, stream: new ReadableStream(), blob: { contentType: "image/webp" },
    });
    const req = new Request("http://localhost/forge/api/art/abc?v=approved") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(200);
    expect(readForgeArt).toHaveBeenCalledWith("forge-art/orig"); // original preferred over display key
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npx vitest run "app/forge/api/art/[cardId]/__tests__/route.test.ts"
```
Expected: the three new cases FAIL (the route ignores `?v=approved`, so it reads `working_art_key` → `approvedCtx` has no such field → 404 or wrong call).

- [ ] **Step 3: Implement the `?v=approved` branch**

Replace the card-lookup block in `app/forge/api/art/[cardId]/route.ts` (the lines from `const { cardId } = await params;` through the `if (!card?.working_art_key) return notFoundResponse();`) with key resolution that branches on the query param:

```ts
  const { cardId } = await params;
  const url = new URL(req.url);
  const wantApproved = url.searchParams.get("v") === "approved";

  // RLS-checked: non-members are already rejected above. Playtesters can SELECT only
  // approved cards/versions of granted sets — so the approved branch is leak-safe.
  let artKey: string | null = null;
  if (wantApproved) {
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select("approved_version_id")
      .eq("id", cardId)
      .maybeSingle();
    if (!card?.approved_version_id) return notFoundResponse();
    const { data: version } = await ctx.supabase
      .from("card_versions")
      .select("art_original_key, art_key, art_is_placeholder")
      .eq("id", card.approved_version_id)
      .maybeSingle();
    if (!version || version.art_is_placeholder) return notFoundResponse();
    artKey = version.art_original_key ?? version.art_key ?? null;
  } else {
    const { data: card } = await ctx.supabase
      .from("forge_cards")
      .select("working_art_key")
      .eq("id", cardId)
      .maybeSingle();
    artKey = card?.working_art_key ?? null;
  }
  if (!artKey) return notFoundResponse();
```

Then replace the two later references to `card.working_art_key`/`readForgeArt(card.working_art_key)` with `artKey`:

```ts
  let result;
  try {
    result = await readForgeArt(artKey);
  } catch {
    return notFoundResponse();
  }
```

(The rest — the `?download=1` audit branch, the headers, and the `new Response(result.stream, ...)` — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx vitest run "app/forge/api/art/[cardId]/__tests__/route.test.ts"
```
Expected: PASS (all old + new cases).

- [ ] **Step 5: Commit**

```bash
git add "app/forge/api/art/[cardId]/route.ts" "app/forge/api/art/[cardId]/__tests__/route.test.ts"
git commit -m "feat(forge): serve approved-version art via ?v=approved on the art proxy"
```

---

## Task 4: `play.ts` — approved-card reveal reader (server-only)

**Files:**
- Create: `app/forge/lib/play.ts`

**Interfaces:**
- Consumes: `requireForge()`; `DesignCard` from `@/app/forge/lib/designCard`; tables `forge_cards`, `card_versions` (RLS already returns approved-only for granted playtesters).
- Produces: `type RevealCard = { cardId: string; data: DesignCard; hasApprovedArt: boolean }`; `async function listSetApprovedCards(setId: string): Promise<RevealCard[]>` — server-only, carries **no** blob keys to the client (only the boolean).

- [ ] **Step 1: Write the reader**

Create `app/forge/lib/play.ts` (mirrors `setArtwork.ts`'s server-only shape — read approved cards → their approved versions → derive a boolean, never expose the key):

```ts
// Playtester reveal reader. SERVER-ONLY: it reads under the caller's RLS (a granted
// playtester can SELECT a granted set's approved cards/versions). It exposes only the
// DesignCard payload + a hasApprovedArt boolean — never a blob key (use the
// /forge/api/art/<id>?v=approved proxy to render the image).
import { requireForge } from "@/app/forge/lib/auth";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type RevealCard = { cardId: string; data: DesignCard; hasApprovedArt: boolean };

export async function listSetApprovedCards(setId: string): Promise<RevealCard[]> {
  const ctx = await requireForge();
  if (!ctx) return [];

  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, approved_version_id")
    .eq("set_id", setId)
    .eq("status", "approved")
    .not("approved_version_id", "is", null);

  const byVersion = new Map<string, string>(); // version_id -> card_id
  for (const c of cards ?? []) {
    if (c.approved_version_id) byVersion.set(c.approved_version_id, c.id);
  }
  if (byVersion.size === 0) return [];

  const { data: versions } = await ctx.supabase
    .from("card_versions")
    .select("id, card_id, data, art_key, art_original_key, art_is_placeholder")
    .eq("status", "approved") // self-defend: don't lean solely on the approve RPC keeping these in lockstep
    .in("id", Array.from(byVersion.keys()));

  return (versions ?? []).map((v: any): RevealCard => ({
    cardId: v.card_id as string,
    data: (v.data ?? {}) as DesignCard,
    hasApprovedArt: !!(v.art_original_key ?? v.art_key) && !v.art_is_placeholder,
  }));
}
```

- [ ] **Step 2: Typecheck via build of just this module's consumers later**

No unit test (server-only RLS reader; `setArtwork.ts`'s `listSetApprovedArt` set the precedent of no hermetic test). Verify it compiles in Task 5's build. For now:

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "play.ts" || echo "no play.ts type errors"
```
Expected: `no play.ts type errors`.

- [ ] **Step 3: Commit**

```bash
git add app/forge/lib/play.ts
git commit -m "feat(forge): listSetApprovedCards server-only reveal reader"
```

---

## Task 5: Playtester reveal — `/forge/play` + `/forge/play/[setId]`

**Files:**
- Create: `app/forge/play/page.tsx`
- Create: `app/forge/play/[setId]/page.tsx`
- Create: `app/forge/play/[setId]/RevealGrid.tsx`

**Interfaces:**
- Consumes: `requireForge()`; `listSets()` → `ForgeSetSummary[]`; `getSet(setId)` → `ForgeSetDetail|null`; `listSetApprovedCards(setId)` → `RevealCard[]`; `ForgeCardPreview` (`{card:DesignCard, artUrl?:string|null, className?}`).
- Produces: routes `/forge/play` (landing) and `/forge/play/[setId]` (reveal). Each calls a gate (gate-first guardrail).

- [ ] **Step 1: Write the landing page**

Create `app/forge/play/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";

export const dynamic = "force-dynamic";

export default async function ForgePlayPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  // RLS returns only sets the caller may see — for a playtester, exactly their granted sets.
  const sets = await listSets();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Playtest</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sets shared with you.</p>
      {sets.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No sets have been shared with you yet.</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`/forge/play/${s.id}`} className="block rounded-lg border p-4 hover:bg-muted/50">
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-muted-foreground">{s.total} card{s.total === 1 ? "" : "s"}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write the reveal grid component**

Create `app/forge/play/[setId]/RevealGrid.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { DesignCard } from "@/app/forge/lib/designCard";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";

export type RevealItem = { cardId: string; data: DesignCard; artUrl: string | null };

export default function RevealGrid({ items }: { items: RevealItem[] }) {
  const [active, setActive] = useState<RevealItem | null>(null);

  if (items.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground">No approved cards in this set yet.</p>;
  }

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it) => (
          <button key={it.cardId} onClick={() => setActive(it)} className="block w-full text-left">
            <ForgeCardPreview card={it.data} artUrl={it.artUrl} className="w-full rounded-md" />
          </button>
        ))}
      </div>
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setActive(null)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <ForgeCardPreview card={active.data} artUrl={active.artUrl} className="w-full" />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Write the reveal page**

Create `app/forge/play/[setId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { listSetApprovedCards } from "@/app/forge/lib/play";
import RevealGrid, { type RevealItem } from "./RevealGrid";

export const dynamic = "force-dynamic";

export default async function ForgePlaySetPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId); // RLS hides sets the caller can't see → 404
  if (!set) notFound();
  const cards = await listSetApprovedCards(setId);
  const items: RevealItem[] = cards.map((c) => ({
    cardId: c.cardId,
    data: c.data,
    artUrl: c.hasApprovedArt ? `/forge/api/art/${c.cardId}?v=approved` : null,
  }));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-semibold">{set.name}</h1>
      <p className="text-sm text-muted-foreground">Approved cards</p>
      <RevealGrid items={items} />
    </main>
  );
}
```

- [ ] **Step 4: Run the gate-first guardrail + build**

Run:
```bash
npx vitest run __tests__/forge-gate-first.test.ts
npm run build
```
Expected: gate-first PASS (the two new pages each call `requireForge`); build clean.

- [ ] **Step 5: Commit**

```bash
git add app/forge/play
git commit -m "feat(forge): playtester reveal — /forge/play landing + approved-card grid"
```

---

## Task 6: Role-aware desk

**Files:**
- Modify: `app/forge/page.tsx`

**Interfaces:**
- Consumes: `requireForge()` (`ctx.role`).
- Produces: playtesters see a "Your sets" tile (→ `/forge/play`) + disabled "Build a deck" / "Find a game" coming-soon tiles; elders/superadmins see the existing Ideas/Sets/Admin desk.

- [ ] **Step 1: Implement the role split**

Replace the `<nav>...</nav>` block in `app/forge/page.tsx` with a role branch. For `ctx.role === "playtester"`:

```tsx
      <nav className="mt-6 grid gap-3 sm:grid-cols-2">
        {ctx.role === "playtester" ? (
          <>
            <Link href="/forge/play" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Your sets</div>
              <div className="text-sm text-muted-foreground">Browse the cards shared with you.</div>
            </Link>
            <div className="rounded-lg border border-dashed p-4 opacity-60" aria-disabled="true">
              <div className="font-medium">Build a deck</div>
              <div className="text-sm text-muted-foreground">Coming soon.</div>
            </div>
            <div className="rounded-lg border border-dashed p-4 opacity-60" aria-disabled="true">
              <div className="font-medium">Find a game</div>
              <div className="text-sm text-muted-foreground">Coming soon.</div>
            </div>
          </>
        ) : (
          <>
            <Link href="/forge/ideas" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Ideas</div>
              <div className="text-sm text-muted-foreground">Your private sketchbook.</div>
            </Link>
            <Link href="/forge/sets" className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="font-medium">Sets</div>
              <div className="text-sm text-muted-foreground">Collective work, lifecycle & progress.</div>
            </Link>
            {ctx.role === "superadmin" && (
              <Link href="/forge/admin" className="rounded-lg border p-4 hover:bg-muted/50">
                <div className="font-medium">Admin</div>
                <div className="text-sm text-muted-foreground">Invites & roles.</div>
              </Link>
            )}
          </>
        )}
      </nav>
```

(The `admin` tile currently shows only for superadmin even though `/forge/admin` is `requireElder`-gated; preserve that existing behavior — not in scope to change.)

- [ ] **Step 2: Verify build + gate-first**

Run:
```bash
npx vitest run __tests__/forge-gate-first.test.ts && npm run build
```
Expected: PASS + clean.

- [ ] **Step 3: Commit**

```bash
git add app/forge/page.tsx
git commit -m "feat(forge): role-aware desk — playtester landing with coming-soon CTAs"
```

---

## Task 7: Elder-page lockdown

**Files:**
- Modify: `app/forge/sets/[setId]/layout.tsx`
- Modify: `app/forge/sets/page.tsx`
- Modify: `app/forge/ideas/page.tsx`
- Modify: `app/forge/cards/[cardId]/page.tsx`

**Interfaces:**
- Consumes: `requireForge()` (`ctx.role`), `redirect` from `next/navigation`.
- Produces: a playtester hitting any authoring route is redirected to `/forge/play`; non-members still get 404. The set layout redirect covers the `cards/notes/progress/review` subtree.

- [ ] **Step 1: Gate the set subtree at the layout**

In `app/forge/sets/[setId]/layout.tsx`, add the `redirect` import and the playtester check right after the existing `if (!ctx) notFound();`:

```tsx
import { notFound, redirect } from "next/navigation";
```
```tsx
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
```

- [ ] **Step 2: Gate the sets index, ideas, and card studio pages**

Apply the same two-line pattern to each of these three pages — add `redirect` to the `next/navigation` import and insert the check after `if (!ctx) notFound();`:

`app/forge/sets/page.tsx`:
```tsx
import { notFound, redirect } from "next/navigation";
```
```tsx
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
```

`app/forge/ideas/page.tsx`: same import change + same two-line insert after `if (!ctx) notFound();`.

`app/forge/cards/[cardId]/page.tsx`: same import change + same two-line insert after `if (!ctx) notFound();`.

- [ ] **Step 3: Verify the gate-first guardrail still passes**

Run:
```bash
npx vitest run __tests__/forge-gate-first.test.ts
```
Expected: PASS (each modified file still has its literal `requireForge(` call; `redirect` is additive).

- [ ] **Step 4: Build**

Run:
```bash
npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/forge/sets/[setId]/layout.tsx app/forge/sets/page.tsx app/forge/ideas/page.tsx "app/forge/cards/[cardId]/page.tsx"
git commit -m "feat(forge): redirect playtesters out of the authoring workspace to /forge/play"
```

---

## Task 8: Grant/revoke/list server actions

**Files:**
- Modify: `app/forge/lib/sets.ts`
- Test: `app/forge/lib/__tests__/sets.test.ts`

**Interfaces:**
- Consumes: `requireElder()`, `requireForge()`; RPCs `forge_grant_set` / `forge_revoke_set` (Task 1).
- Produces:
  - `type SetGrant = { userId: string; displayName: string | null }`
  - `async function grantSet(setId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `async function revokeSet(setId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `async function listSetGrants(setId: string): Promise<SetGrant[]>`

- [ ] **Step 1: Write the failing test**

`app/forge/lib/__tests__/sets.test.ts` **already** mocks `@/app/forge/lib/auth` (`{ requireForge, requireElder }`) and `next/cache`, has a top-level `beforeEach(() => vi.clearAllMocks())`, and a `ctx()` helper whose `supabase.rpc` returns `{ data: "set-1", error: null }` by default (override via `ctx({ rpc })`). Do **not** add new `vi.mock` calls — reuse the existing harness.

First, add `grantSet, revokeSet` to the existing import:
```ts
import { createSet, saveSetNotes, listSets, grantSet, revokeSet } from "../sets";
```

Then append this describe block (uses the file's existing `ctx()` and the already-imported `requireElder`):
```ts
describe("grantSet / revokeSet", () => {
  it("grantSet rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await grantSet("s1", "u1")).ok).toBe(false);
  });

  it("grantSet calls forge_grant_set and returns ok", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: null }) });
    (requireElder as any).mockResolvedValue(c);
    expect((await grantSet("s1", "u1")).ok).toBe(true);
    expect(c.supabase.rpc).toHaveBeenCalledWith("forge_grant_set", { p_set_id: "s1", p_user_id: "u1" });
  });

  it("revokeSet surfaces an RPC error", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: { message: "boom" } }) });
    (requireElder as any).mockResolvedValue(c);
    expect((await revokeSet("s1", "u1")).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run app/forge/lib/__tests__/sets.test.ts
```
Expected: FAIL — `grantSet`/`revokeSet` are not exported yet.

- [ ] **Step 3: Implement the actions**

Append to `app/forge/lib/sets.ts` (the file already imports `requireForge, requireElder` and `revalidatePath`):

```ts
export type SetGrant = { userId: string; displayName: string | null };

export async function grantSet(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_grant_set", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not grant access" };
  revalidatePath(`/forge/sets/${setId}/progress`);
  return { ok: true };
}

export async function revokeSet(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_revoke_set", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not revoke access" };
  revalidatePath(`/forge/sets/${setId}/progress`);
  return { ok: true };
}

export async function listSetGrants(setId: string): Promise<SetGrant[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: rows } = await ctx.supabase.from("forge_set_grants").select("user_id").eq("set_id", setId);
  const ids = (rows ?? []).map((r: any) => r.user_id);
  if (ids.length === 0) return [];
  const { data: members } = await ctx.supabase.from("playtest_members").select("user_id, display_name").in("user_id", ids);
  return (members ?? []).map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
}
```

(`Result` = `{ ok: true } | { ok: false; error: string }`, already declared at the top of `sets.ts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run app/forge/lib/__tests__/sets.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/sets.ts app/forge/lib/__tests__/sets.test.ts
git commit -m "feat(forge): grantSet/revokeSet/listSetGrants server actions"
```

---

## Task 9: Per-set "Playtesters" grant panel

**Files:**
- Create: `app/forge/sets/[setId]/progress/PlaytesterGrants.tsx`
- Modify: `app/forge/sets/[setId]/progress/page.tsx`

**Interfaces:**
- Consumes: `listSetGrants(setId)` → `SetGrant[]`; `grantSet` / `revokeSet` actions; `playtest_members` (role `playtester`) for the picker.
- Produces: an elder-only panel on the progress page listing current grants with revoke controls and a member picker to grant.

- [ ] **Step 1: Write the panel component**

Create `app/forge/sets/[setId]/progress/PlaytesterGrants.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { grantSet, revokeSet, type SetGrant } from "@/app/forge/lib/sets";

export default function PlaytesterGrants({
  setId,
  grants,
  grantable,
}: {
  setId: string;
  grants: SetGrant[];
  grantable: { userId: string; displayName: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok === false ? r.error : okMsg);
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">Playtesters</h2>
      <p className="text-sm text-muted-foreground">Members who can view this set's approved cards.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {grants.length === 0 && <li className="text-muted-foreground">None yet.</li>}
        {grants.map((g) => (
          <li key={g.userId} className="flex items-center justify-between border-t py-2">
            <span>{g.displayName ?? <span className="text-muted-foreground">—</span>}</span>
            <button
              className="text-xs text-red-500 hover:underline"
              onClick={() => run(() => revokeSet(setId, g.userId), "Access revoked")}
              disabled={pending}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {grantable.length > 0 && (
        <div className="mt-3 flex items-end gap-2">
          <label className="text-sm">
            Grant a playtester
            <select
              className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Select…</option>
              {grantable.map((m) => (
                <option key={m.userId} value={m.userId}>{m.displayName ?? m.userId}</option>
              ))}
            </select>
          </label>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            disabled={pending || !pick}
            onClick={() => run(() => grantSet(setId, pick), "Access granted")}
          >
            Grant
          </button>
        </div>
      )}
      {msg && <p aria-live="polite" className="mt-2 text-sm">{msg}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the progress page**

In `app/forge/sets/[setId]/progress/page.tsx`, import `listSetGrants` and the panel, fetch grants + grantable playtesters when `canEdit`, and render the panel after the dashboard. Change the import line and the return.

Add imports:
```tsx
import { getSet, listSetCards, listSetElders, listSetGrants } from "@/app/forge/lib/sets";
import PlaytesterGrants from "./PlaytesterGrants";
```

After the existing `addable` block (before the `return`), add:
```tsx
  let grants: Awaited<ReturnType<typeof listSetGrants>> = [];
  let grantablePlaytesters: { userId: string; displayName: string | null }[] = [];
  if (canEdit) {
    grants = await listSetGrants(setId);
    const { data: pts } = await ctx.supabase
      .from("playtest_members")
      .select("user_id, display_name, role")
      .eq("role", "playtester");
    const granted = new Set(grants.map((g) => g.userId));
    grantablePlaytesters = (pts ?? [])
      .filter((m: any) => !granted.has(m.user_id))
      .map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
  }
```

Replace the single-element `return` with a fragment that also renders the panel for elders:
```tsx
  return (
    <>
      <ProgressDashboard setId={setId} model={model} targets={set.targetCounts} elders={elders} addable={addable} canEdit={canEdit} hasApprovedArt={hasApprovedArt} />
      {canEdit && <PlaytesterGrants setId={setId} grants={grants} grantable={grantablePlaytesters} />}
    </>
  );
```

- [ ] **Step 3: Build + gate-first**

Run:
```bash
npx vitest run __tests__/forge-gate-first.test.ts && npm run build
```
Expected: PASS + clean. (Note the `strict:false` narrowing rule — `PlaytesterGrants`'s `run` callback narrows with `r.ok === false`, already correct above.)

- [ ] **Step 4: Commit**

```bash
git add "app/forge/sets/[setId]/progress/PlaytesterGrants.tsx" "app/forge/sets/[setId]/progress/page.tsx"
git commit -m "feat(forge): per-set Playtesters grant/revoke panel on the progress page"
```

---

## Task 10: Invite-time set selector

**Files:**
- Modify: `app/forge/lib/members.ts`
- Modify: `app/forge/admin/AdminConsole.tsx`
- Modify: `app/forge/admin/page.tsx`

**Interfaces:**
- Consumes: `listSets()` (sets the minter runs, via RLS); `forge_mint_invite(p_set_ids uuid[])` (already accepts the array); redeem consumes them (Task 1).
- Produces: `mintInvite` accepts an optional `setIds: string[]`; the admin console shows a set multiselect for a **playtester** invite.

- [ ] **Step 1: Thread `setIds` through `mintInvite`**

In `app/forge/lib/members.ts`, change the `mintInvite` input type and the RPC call:

```ts
export async function mintInvite(input: {
  role: ForgeRole;
  email?: string | null;
  expiresInDays?: number;
  setIds?: string[];
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
```

And change the `p_set_ids` argument in the `forge_mint_invite` call from `[]` to:
```ts
    p_set_ids: input.role === "playtester" ? (input.setIds ?? []) : [],
```

(Grants only make sense for playtester invites; elder/superadmin invites stay set-less.)

- [ ] **Step 2: Add the set multiselect to the console**

In `app/forge/admin/AdminConsole.tsx`:

Add a `sets` prop:
```tsx
export default function AdminConsole({
  callerRole,
  members,
  invites,
  sets,
}: {
  callerRole: ForgeRole;
  members: Member[];
  invites: Invite[];
  sets: { id: string; name: string }[];
}) {
```

Add grant-selection state near the other `useState`s:
```tsx
  const [inviteSetIds, setInviteSetIds] = useState<string[]>([]);
```

Pass them when minting (in `submitInvite`):
```tsx
    const r = await mintInvite({ role: inviteRole, email: inviteEmail || null, setIds: inviteSetIds });
```

Render a multiselect, shown only for a playtester invite, inside the invite `<form>` after the Email label:
```tsx
          {inviteRole === "playtester" && sets.length > 0 && (
            <label className="text-sm">
              Sets (grants access)
              <select
                multiple
                className="mt-1 block min-w-40 rounded-md border bg-background px-2 py-1.5 text-sm"
                value={inviteSetIds}
                onChange={(e) => setInviteSetIds(Array.from(e.target.selectedOptions, (o) => o.value))}
              >
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
```

- [ ] **Step 3: Pass sets from the admin page**

In `app/forge/admin/page.tsx`, import `listSets`, fetch it alongside members/invites, and pass a trimmed `{id,name}[]`:

```tsx
import { listSets } from "@/app/forge/lib/sets";
```
```tsx
  const [members, invites, sets] = await Promise.all([listMembers(), listInvites(), listSets()]);
```
```tsx
  <AdminConsole callerRole={ctx.role} members={members} invites={invites} sets={sets.map((s) => ({ id: s.id, name: s.name }))} />
```

- [ ] **Step 4: Build**

Run:
```bash
npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/members.ts app/forge/admin/AdminConsole.tsx app/forge/admin/page.tsx
git commit -m "feat(forge): scope a playtester invite to sets (invite-time grants)"
```

---

## Task 11: Full-suite verification + manual smoke note

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run:
```bash
npm test
```
Expected: PASS, except the one pre-existing unrelated `store-route.test.ts` failure noted in prior slices. No new failures.

- [ ] **Step 2: Run the security suite**

Run:
```bash
FORGE_LEAK_TEST=1 npm run test:security
```
Expected: PASS — anon sees zero rows in every `FORGE_TABLES` entry (incl. `forge_set_grants`); anon cannot execute any `FORGE_RPCS` entry (incl. `forge_grant_set`/`forge_revoke_set`). (Skipped if no Supabase creds in env.)

- [ ] **Step 3: Production build**

Run:
```bash
npm run build
```
Expected: clean — all new routes (`/forge/play`, `/forge/play/[setId]`) compile; no `strict:false` union-narrowing errors.

- [ ] **Step 4: Record the manual smoke checklist (deferred — needs two accounts)**

The signed-in browser smoke is the usual deferred manual step. On a Vercel preview, as superadmin (`baboonytim`):
1. Create/open a set with at least one **approved** card (with real art) and one non-approved card.
2. Mint a **playtester** invite scoped to that set → redeem on the `landofredemption@gmail.com` account.
3. Confirm the playtester lands on the role-aware desk → "Your sets" → `/forge/play` shows the set → reveal shows **only** the approved card with its frozen art, not the non-approved one.
4. Confirm `/forge/sets`, `/forge/sets/<id>/notes`, `/forge/cards/<id>`, `/forge/ideas` all redirect the playtester to `/forge/play`.
5. As the elder, open the set's progress page → "Playtesters" panel → revoke → confirm the set disappears from the playtester's `/forge/play`.
6. Re-grant from the panel → confirm it reappears.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(forge): phase 2.1 verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §3.1 `forge_grant_set` → Task 1. §3.2 `forge_revoke_set` → Task 1. §3.3 redeem consumes `set_ids` → Task 1. §3.4 `forge_set_grants_select` own-row → Task 1. §3.5 grants/revokes → Task 1.
- §4 approved-version art (`?v=approved`) → Task 3.
- §5.1 role-aware desk → Task 6. §5.2 `/forge/play` → Task 5. §5.3 `/forge/play/[setId]` + `listSetApprovedCards` → Tasks 4–5. §5.4 per-set grant panel → Tasks 8–9. §5.5 invite set selector → Task 10. §5.6 elder-page lockdown → Task 7. §5.7 onboarding (reuse existing welcome) → no code change needed (verified: `/forge/welcome` already runs for any role and redirects to the role-aware desk).
- §6 leak-test + boundary → Task 2 (probes) + Task 11 (full security run). §7 testing → Tasks 3, 8 (unit), 11 (suite + manual).
- §8 file-touch summary → matches the File Structure section above.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. The two server-only readers (`play.ts`, the art proxy approved branch) are covered by the hermetic proxy test (Task 3) and the build/manual smoke (the `setArtwork.ts` precedent for not unit-testing RLS readers).

**Type consistency:** `RevealCard` (Task 4) → mapped to `RevealItem` (Task 5) with `artUrl` added — names distinct and intentional. `SetGrant {userId, displayName}` consistent across Tasks 8–9. `grantSet`/`revokeSet` return `Result` (`{ok:true}|{ok:false;error}`) — `PlaytesterGrants.run` narrows with `r.ok === false` (strict:false rule). `mintInvite` `setIds?: string[]` consistent between Task 10 steps. RPC arg names (`p_set_id`,`p_user_id`,`p_set_ids`) match Task 1's SQL.

**Note on Task 1 testability:** the migration has no red→green unit test (SQL applied to a live DB); its correctness is verified by the Task 2 anon-exec probes, the Task 11 security run, and the manual smoke. This mirrors every prior Forge migration in the project.
