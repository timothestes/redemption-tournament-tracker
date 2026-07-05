# Forge Private Sets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an elder mark a Forge set "private" so it is visible/editable only to superadmins and an explicit designer roster — hidden from all other elders — while public sets keep today's all-elders-see-all behavior.

**Architecture:** A single `is_private boolean` column on `forge_sets`, and a redefinition of the one choke-point function `is_forge_set_elder(set_id)` that every set/card read policy, write RPC, realtime authz, and the review layer funnel through. For a private set the "any global elder" shortcut is withheld; access falls back to superadmin + explicit `forge_set_elders` roster. Two RPCs carry the flag (`forge_create_set` gains a `p_is_private` arg; new `forge_set_privacy` toggles it). Thin app/UI wiring surfaces the flag.

**Tech Stack:** Next.js 15 App Router (RSC + server actions), React 19, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), Tailwind + shadcn/ui, lucide-react icons, Vitest (security/anon-leak), Playwright (signed-in smoke).

## Global Constraints

- **Leak boundary is inviolable.** No Forge secret data may reach anon/non-members. Adding a column and redefining one function must keep the anon-leak keystone test green. Non-members/anon must remain `false` in `is_forge_set_elder`.
- **RPCs:** `language sql|plpgsql`, `security definer`, `set search_path = ''`, and **explicitly revoke EXECUTE from `public, anon`** then **grant to `authenticated`** (anon holds a direct default grant — revoking from PUBLIC alone is insufficient).
- **`tsconfig` has `strict: false`.** Discriminated-union narrowing on `if (r.ok) {…} else {…}` is broken; client consumers of `{ok:true}|{ok:false;error}` must narrow with `r.ok === false`. Only `npm run build` catches these — vitest/esbuild do not typecheck.
- **Design conventions:** reserve the primary green accent for CTAs/hover/active — do not color the Private badge green; use `text-muted-foreground`/border. No `focus:ring-2 focus:ring-ring` on new controls.
- **Every `/forge` page/route must call its own gate** (`requireForge`/`requireElder`) — there is no `/forge` middleware; the `forge-gate-first` guardrail test fails any page relying only on a layout. (This plan adds no new routes, but keep it in mind if one is added.)
- **Migrations are applied to live prod only in the final verification step**, via the Supabase MCP against project `dhxxsolhgvimxtusepht`. Do NOT apply from inside a build subagent.
- Existing accounts for the signed-in smoke: `baboonytim` = superadmin; a second member session is minted via the verify recipe (`.claude/skills/verify/SKILL.md`).

---

## File Structure

- `supabase/migrations/070_forge_private_sets.sql` — **new**. Column + `is_forge_set_elder` redefine + `forge_create_set(text,boolean)` + `forge_set_privacy(uuid,boolean)`.
- `__tests__/forge-anon-leak.test.ts` — **modify**. Add `forge_set_privacy` to the anon-cannot-execute probe list.
- `app/forge/lib/sets.ts` — **modify**. `isPrivate` on set types; `listSets`/`getSet` select+map; `createSet(name, isPrivate)`; new `setSetPrivacy`.
- `app/forge/components/PrivateBadge.tsx` — **new**. Shared lock badge (grid + set header + progress panel).
- `app/forge/sets/SetsIndex.tsx` — **modify**. Private checkbox in create dialog; badge on set rows.
- `app/forge/import/ImportWizard.tsx` — **modify**. Private checkbox in the new-set dialog.
- `app/forge/sets/[setId]/layout.tsx` — **modify**. Badge next to the set title.
- `app/forge/sets/[setId]/progress/SetPrivacyPanel.tsx` — **new**. Client toggle (Make private / Make visible) with confirm.
- `app/forge/sets/[setId]/progress/ProgressDashboard.tsx` — **modify**. Accept `isPrivate`, render `SetPrivacyPanel` above `SetEldersPanel`.
- `app/forge/sets/[setId]/progress/page.tsx` — **modify**. Pass `set.isPrivate` to `ProgressDashboard`.

---

## Task 1: Migration + anon-leak probe

**Files:**
- Create: `supabase/migrations/070_forge_private_sets.sql`
- Modify: `__tests__/forge-anon-leak.test.ts:78` (add one probe entry)

**Interfaces:**
- Produces (SQL): `forge_sets.is_private boolean not null default false`; `is_forge_set_elder(uuid)` private-aware; `forge_create_set(p_name text, p_is_private boolean default false) returns uuid`; `forge_set_privacy(p_set_id uuid, p_is_private boolean) returns void`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/070_forge_private_sets.sql` with exactly:

```sql
-- Forge: private sets.
-- A private set (forge_sets.is_private = true) is visible/editable only to
-- superadmins and its explicit forge_set_elders designer roster. It withholds
-- the "any global elder" shortcut that is_forge_set_elder normally grants (see
-- the uncommitted prod migration forge_elders_access_all_sets, DB version
-- 20260705221747, which THIS migration supersedes). Public sets (is_private =
-- false, the default) keep the all-elders-see-all behavior. Because every
-- set/card read policy, write/lifecycle RPC, realtime topic authz, and the
-- review layer funnel through is_forge_set_elder, this single redefinition
-- hides a private set everywhere at once. Non-members/anon remain false.
--
-- ROLLBACK: to restore all-elders-see-all, redefine is_forge_set_elder to
--   select public.is_forge_elder_or_super()
--       or exists(select 1 from public.forge_set_elders e
--                 where e.set_id = p_set_id and e.user_id = auth.uid());

-- 1. Privacy flag. Default false → every existing set stays public (no change).
alter table public.forge_sets
  add column if not exists is_private boolean not null default false;

-- 2. Choke point: withhold the global-elder shortcut for private sets.
create or replace function public.is_forge_set_elder(p_set_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_forge_superadmin()
      or exists(
        select 1 from public.forge_set_elders e
        where e.set_id = p_set_id and e.user_id = auth.uid()
      )
      or (
        public.is_forge_elder_or_super()
        and not exists(
          select 1 from public.forge_sets s
          where s.id = p_set_id and s.is_private
        )
      );
$$;
revoke execute on function public.is_forge_set_elder(uuid) from public, anon;
grant  execute on function public.is_forge_set_elder(uuid) to authenticated;

-- 3. Create-set accepts privacy. Drop the 1-arg form so the 2-arg (with a
--    default) resolves for both existing single-arg callers and new ones.
drop function if exists public.forge_create_set(text);
create or replace function public.forge_create_set(p_name text, p_is_private boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_base text; v_slug text; v_n int := 1;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'only elders may create sets';
  end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'set name required'; end if;
  v_base := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then v_base := 'set'; end if;
  v_slug := v_base;
  while exists(select 1 from public.forge_sets where slug = v_slug) loop
    v_n := v_n + 1; v_slug := v_base || '-' || v_n;
  end loop;
  insert into public.forge_sets (name, slug, created_by, is_private)
  values (btrim(p_name), v_slug, auth.uid(), coalesce(p_is_private, false))
  returning id into v_id;
  insert into public.forge_set_elders (set_id, user_id) values (v_id, auth.uid());
  return v_id;
end; $$;
revoke execute on function public.forge_create_set(text, boolean) from public, anon;
grant  execute on function public.forge_create_set(text, boolean) to authenticated;

-- 4. Toggle privacy. Gated STRICTER than is_forge_set_elder: superadmin or an
--    EXPLICIT roster designer only — so a global elder (who passes
--    is_forge_set_elder for any public set) can't privatize a shared set out
--    from under its collaborators.
create or replace function public.forge_set_privacy(p_set_id uuid, p_is_private boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_forge_superadmin() or exists(
    select 1 from public.forge_set_elders e
    where e.set_id = p_set_id and e.user_id = auth.uid()
  )) then
    raise exception 'not a designer on this set';
  end if;
  update public.forge_sets
     set is_private = coalesce(p_is_private, false), updated_at = now()
   where id = p_set_id;
end; $$;
revoke execute on function public.forge_set_privacy(uuid, boolean) from public, anon;
grant  execute on function public.forge_set_privacy(uuid, boolean) to authenticated;
```

- [ ] **Step 2: Add the anon-cannot-execute probe**

In `__tests__/forge-anon-leak.test.ts`, in the `FORGE_RPCS` array, immediately after the `forge_delete_set` line (currently line 78), add:

```ts
    ["forge_set_privacy", { p_set_id: "00000000-0000-0000-0000-000000000000", p_is_private: true }],
```

(The existing `["forge_create_set", { p_name: "x" }]` probe stays as-is — PostgREST still resolves it to the 2-arg function via the default, and anon still lacks EXECUTE.)

- [ ] **Step 3: Verify the test file still compiles / hermetic suite green**

Run: `npx vitest run __tests__/forge-anon-leak.test.ts`
Expected: the live-only `describe` is SKIPPED without `FORGE_LEAK_TEST=1` (0 failures). This confirms the probe array is syntactically valid. (The live probe runs in Task 6 after the migration is applied.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/070_forge_private_sets.sql __tests__/forge-anon-leak.test.ts
git commit -m "feat(forge): migration 070 — private sets (is_private + choke-point + RPCs)"
```

---

## Task 2: `sets.ts` data layer

**Files:**
- Modify: `app/forge/lib/sets.ts:9-10` (types), `:15-22` (createSet), `:24-48` (listSets), `:60-70` (getSet); add `setSetPrivacy` after `revokeSet` (`:164`).

**Interfaces:**
- Consumes: RPCs `forge_create_set(p_name, p_is_private)`, `forge_set_privacy(p_set_id, p_is_private)` from Task 1.
- Produces: `ForgeSetSummary.isPrivate: boolean`, `ForgeSetDetail.isPrivate: boolean`; `createSet(name: string, isPrivate?: boolean)`; `setSetPrivacy(setId: string, isPrivate: boolean): Promise<{ok:true}|{ok:false;error:string}>`.

- [ ] **Step 1: Add `isPrivate` to the set types**

Replace lines 9-10:

```ts
export type ForgeSetSummary = { id: string; name: string; slug: string; status: string; total: number; targetTotal: number; statusCounts: Record<string, number>; isPrivate: boolean };
export type ForgeSetDetail = { id: string; name: string; slug: string; notes: string | null; targetCounts: TargetCounts; status: string; isPrivate: boolean };
```

- [ ] **Step 2: Thread `isPrivate` through `createSet`**

Replace the `createSet` function (lines 15-22) with:

```ts
export async function createSet(name: string, isPrivate = false): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_create_set", { p_name: name, p_is_private: isPrivate });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create set" };
  revalidatePath("/forge/sets");
  return { ok: true, id: data };
}
```

- [ ] **Step 3: Select + map `is_private` in `listSets`**

In `listSets`, change the select (line 30) to include `is_private`:

```ts
    .select("id, name, slug, status, target_counts, is_private")
```

and add `isPrivate` to the mapped object (inside the `return (sets ?? []).map(...)`, alongside `statusCounts`):

```ts
    statusCounts: statusCounts.get(s.id) ?? {},
    isPrivate: !!s.is_private,
```

- [ ] **Step 4: Select + map `is_private` in `getSet`**

In `getSet`, change the select (line 65) to:

```ts
    .select("id, name, slug, notes, target_counts, status, is_private")
```

and the return (line 69) to:

```ts
  return { id: data.id, name: data.name, slug: data.slug, notes: data.notes ?? null, targetCounts: (data.target_counts ?? {}) as TargetCounts, status: data.status, isPrivate: !!data.is_private };
```

- [ ] **Step 5: Add `setSetPrivacy`**

Insert immediately after `revokeSet` (after line 164):

```ts
export async function setSetPrivacy(setId: string, isPrivate: boolean): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_set_privacy", { p_set_id: setId, p_is_private: isPrivate });
  if (error) return { ok: false, error: "Could not change set privacy" };
  revalidatePath(`/forge/sets/${setId}/progress`);
  revalidatePath("/forge/sets");
  return { ok: true };
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: compiles clean (no type errors from the new `isPrivate` field or `setSetPrivacy`). Note: the build also surfaces any consumer that constructs a `ForgeSetSummary`/`ForgeSetDetail` literal missing `isPrivate` — there should be none (all sets come from `listSets`/`getSet`), but fix any that appear.

- [ ] **Step 7: Commit**

```bash
git add app/forge/lib/sets.ts
git commit -m "feat(forge): isPrivate on set types + createSet(isPrivate) + setSetPrivacy"
```

---

## Task 3: Create-set + import privacy toggles

**Files:**
- Modify: `app/forge/sets/SetsIndex.tsx` (create dialog)
- Modify: `app/forge/import/ImportWizard.tsx` (new-set dialog)

**Interfaces:**
- Consumes: `createSet(name, isPrivate)` from Task 2.

- [ ] **Step 1: Add private state + reset in `SetsIndex.tsx`**

After the `total`/`perType` state (after line 32), add:

```tsx
  const [isPrivate, setIsPrivate] = useState(false);
```

In `openCreate` (lines 115-120), add a reset so re-opening starts public:

```tsx
    setIsPrivate(false);
```

- [ ] **Step 2: Pass the flag from `confirmCreate`**

In `confirmCreate` (line 126), change:

```tsx
    const r = await createSet(name.trim(), isPrivate);
```

- [ ] **Step 3: Add the checkbox to the create dialog**

In the create `DialogBody` (after the "Set name" `<label>` block that ends at line 342, before the "How many cards total?" label), insert:

```tsx
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span>
                <span className="font-medium">Private set</span>
                <span className="block text-xs text-muted-foreground">
                  Only you and designers you add can see this set. Hidden from other elders.
                </span>
              </span>
            </label>
```

- [ ] **Step 4: Add private state to `ImportWizard.tsx`**

Find the existing state declarations near `newSetName` and add alongside them:

```tsx
  const [newSetPrivate, setNewSetPrivate] = useState(false);
```

- [ ] **Step 5: Pass the flag when the import creates a new set**

In `runImport`, change the create call (line 247) to:

```tsx
        const r = await createSet(name, newSetPrivate);
```

- [ ] **Step 6: Add the checkbox to the import new-set dialog**

In the "New set for this import" `DialogBody` (after the set-name `<label>` block ending at line 420), insert:

```tsx
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox checked={newSetPrivate} onCheckedChange={(v) => setNewSetPrivate(v === true)} className="mt-0.5" />
              <span>
                <span className="font-medium">Private set</span>
                <span className="block text-xs text-muted-foreground">
                  Only you and designers you add can see it. Hidden from other elders.
                </span>
              </span>
            </label>
```

(`Checkbox` is already imported in `ImportWizard.tsx`.)

- [ ] **Step 7: Typecheck + commit**

Run: `npm run build`
Expected: clean.

```bash
git add app/forge/sets/SetsIndex.tsx app/forge/import/ImportWizard.tsx
git commit -m "feat(forge): private-set toggle in create + import dialogs"
```

---

## Task 4: Private badge (grid + set header)

**Files:**
- Create: `app/forge/components/PrivateBadge.tsx`
- Modify: `app/forge/sets/SetsIndex.tsx` (set rows), `app/forge/sets/[setId]/layout.tsx` (title)

**Interfaces:**
- Produces: `PrivateBadge` default export (no props).

- [ ] **Step 1: Create the shared badge**

Create `app/forge/components/PrivateBadge.tsx`:

```tsx
import { Lock } from "lucide-react";

// Neutral (non-green) lock chip marking a private set. Kept DRY across the sets
// grid, the set header, and the progress privacy panel.
export default function PrivateBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${className}`}
      title="Private set — hidden from other elders"
    >
      <Lock size={10} aria-hidden />
      Private
    </span>
  );
}
```

- [ ] **Step 2: Show the badge on set rows in `SetsIndex.tsx`**

Add the import at the top (with the other imports):

```tsx
import PrivateBadge from "@/app/forge/components/PrivateBadge";
```

Both the selecting-mode `<button>` (line 208) and the `<Link>` (line 215) render `<span className="font-medium">{s.name}</span>`. In BOTH places, replace that single span with a name+badge group:

```tsx
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.isPrivate && <PrivateBadge />}
                  </span>
```

- [ ] **Step 3: Show the badge in the set header**

In `app/forge/sets/[setId]/layout.tsx`, add the import:

```tsx
import PrivateBadge from "@/app/forge/components/PrivateBadge";
```

Replace the title line (line 25) with:

```tsx
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{set.name}</h1>
          {set.isPrivate && <PrivateBadge />}
        </div>
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run build`
Expected: clean.

```bash
git add app/forge/components/PrivateBadge.tsx app/forge/sets/SetsIndex.tsx app/forge/sets/[setId]/layout.tsx
git commit -m "feat(forge): Private badge on set grid rows + set header"
```

---

## Task 5: Progress-tab privacy toggle

**Files:**
- Create: `app/forge/sets/[setId]/progress/SetPrivacyPanel.tsx`
- Modify: `app/forge/sets/[setId]/progress/ProgressDashboard.tsx` (props + render), `app/forge/sets/[setId]/progress/page.tsx` (pass `isPrivate`)

**Interfaces:**
- Consumes: `setSetPrivacy(setId, isPrivate)` from Task 2; `ForgeSetDetail.isPrivate` from Task 2.
- Produces: `SetPrivacyPanel` (props `{ setId: string; isPrivate: boolean }`); `ProgressDashboard` gains a required `isPrivate: boolean` prop.

- [ ] **Step 1: Create the privacy panel**

Create `app/forge/sets/[setId]/progress/SetPrivacyPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Globe } from "lucide-react";
import { setSetPrivacy } from "@/app/forge/lib/sets";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

export default function SetPrivacyPanel({ setId, isPrivate }: { setId: string; isPrivate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: boolean) {
    setBusy(true);
    setError(null);
    const r = await setSetPrivacy(setId, next);
    setBusy(false);
    if (r.ok === false) { setError(r.error); return; }
    router.refresh();
  }

  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        {isPrivate ? <Lock size={14} aria-hidden /> : <Globe size={14} aria-hidden />}
        {isPrivate ? "Private set" : "Visible to all elders"}
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        {isPrivate
          ? "Only superadmins and the designers listed below can see or edit this set."
          : "Every elder can see and design in this set."}
      </p>
      {isPrivate ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => apply(false)}
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          Make visible to all elders
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          Make private
        </button>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => apply(true)}
        title="Make this set private?"
        description="Other elders will lose access to this set unless you add them as designers below. Superadmins keep access."
        confirmLabel="Make private"
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `ProgressDashboard`**

In `app/forge/sets/[setId]/progress/ProgressDashboard.tsx`:

Add the import (with the other imports at the top):

```tsx
import SetPrivacyPanel from "./SetPrivacyPanel";
```

Add `isPrivate` to the props type and destructure. Change the signature block (lines 21-26) to:

```tsx
export default function ProgressDashboard({
  setId, model, targets, elders, addable, canEdit, hasApprovedArt, isPrivate,
}: {
  setId: string; model: ProgressModel; targets: TargetCounts; elders: SetElder[];
  addable: { userId: string; displayName: string | null }[]; canEdit: boolean; hasApprovedArt: boolean; isPrivate: boolean;
}) {
```

Replace the final designers line (line 123) so the privacy panel renders directly above it:

```tsx
      {canEdit && <SetPrivacyPanel setId={setId} isPrivate={isPrivate} />}
      {canEdit && <SetEldersPanel setId={setId} elders={elders} addable={addable} />}
```

- [ ] **Step 3: Pass `isPrivate` from the page**

In `app/forge/sets/[setId]/progress/page.tsx`, update the `<ProgressDashboard .../>` call (line 48) to pass `isPrivate={set.isPrivate}`:

```tsx
      <ProgressDashboard setId={setId} model={model} targets={set.targetCounts} elders={elders} addable={addable} canEdit={canEdit} hasApprovedArt={hasApprovedArt} isPrivate={set.isPrivate} />
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run build`
Expected: clean.

```bash
git add app/forge/sets/[setId]/progress/SetPrivacyPanel.tsx app/forge/sets/[setId]/progress/ProgressDashboard.tsx app/forge/sets/[setId]/progress/page.tsx
git commit -m "feat(forge): privacy toggle on the set Progress tab"
```

---

## Task 6: Integration verification (apply + smoke)

**Files:** none (verification only).

This task is performed by the orchestrator with authorization to touch prod — NOT by a build subagent.

- [ ] **Step 1: Apply migration 070 to prod**

Apply `supabase/migrations/070_forge_private_sets.sql` via the Supabase MCP `apply_migration` against project `dhxxsolhgvimxtusepht` (name: `forge_private_sets`).

- [ ] **Step 2: Verify the function bodies + grants live**

Via MCP `execute_sql`:
- `select pg_get_functiondef('public.is_forge_set_elder(uuid)'::regprocedure);` → contains the `is_private` clause.
- `select proname, pronargs from pg_proc where proname = 'forge_create_set';` → exactly one row, `pronargs = 2`.
- `select has_function_privilege('anon', 'public.forge_set_privacy(uuid,boolean)', 'execute');` → `false`.
- `select column_name from information_schema.columns where table_name='forge_sets' and column_name='is_private';` → one row.

- [ ] **Step 3: Run the live anon-leak suite**

Run: `FORGE_LEAK_TEST=1 npm run test:security`
Expected: all pass (incl. the new `anon cannot execute forge_set_privacy`, `anon sees zero rows in forge_sets`, and the private forge:set/forge:card channel rejections). Zero failures.

- [ ] **Step 4: Full hermetic suite + build**

Run: `npm test` (Forge pure + gate-first + no-next-image green; ignore the known pre-existing unrelated `store-route`/`threshingfloor` failures) and `npm run build` (clean).

- [ ] **Step 5: Signed-in elder-exclusion smoke (the core guarantee)**

Using the verify recipe (`.claude/skills/verify/SKILL.md`) against the running dev server, with standalone Playwright + minted `sb-` cookies:

1. As `baboonytim` (superadmin): create a set via `/forge/sets` with **Private** checked (e.g. "Priv Smoke <timestamp>"). Confirm it shows a Private badge and is reachable.
2. Mint a session for a **second member whose role is `elder`** and who is NOT on that set's roster. If no such account exists, promote a throwaway test account: `update playtest_members set role='elder' where user_id=<test uid>` via service role (record the prior role to restore in cleanup).
3. As that elder: load `/forge/sets` → the private set is **absent** from the grid. Load `/forge/sets/<id>/cards` → **404**. Confirm `rpc('is_forge_set_elder', { p_set_id: <id> })` returns `false` for this session.
4. As superadmin: on the set's Progress tab, add the second elder as a Designer.
5. As that elder again: the set now **appears** in the grid and `/forge/sets/<id>/cards` loads. Confirm `is_forge_set_elder` now returns `true`.
6. As a designer: toggle the set to public on the Progress tab; confirm a THIRD non-roster elder (or the same one after removal) can now see it. Toggle back to private.
7. **Cleanup:** delete the smoke set (bulk-delete on `/forge/sets`), remove any added designer, and restore any promoted test account's original role. Verify no smoke rows remain.

- [ ] **Step 6: Record results**

Summarize applied migration + all verification outcomes for the PR body. If the elder-exclusion smoke fails, STOP and debug before any merge — that is the feature's whole point.

---

## Self-Review (completed by plan author)

**Spec coverage:** ✅ Every spec section maps to a task — data model + choke point + RPCs (Task 1); app layer types/actions (Task 2); create + import UI (Task 3); badges (Task 4); progress toggle (Task 5); security tests + apply + signed-in smoke + housekeeping note (Task 1 probe + Task 6). Out-of-scope items (no role, no per-card privacy, playtester grants unchanged, admin matrix untouched) require no task — confirmed.

**Placeholder scan:** ✅ No TBD/TODO; every code step shows complete code and exact insertion points.

**Type consistency:** ✅ `isPrivate` used identically across `ForgeSetSummary`/`ForgeSetDetail` (Task 2), `s.isPrivate`/`set.isPrivate` consumers (Tasks 3-5), and `ProgressDashboard`'s new prop (Task 5). `setSetPrivacy` signature matches its consumer in `SetPrivacyPanel`. RPC arg names (`p_set_id`, `p_is_private`, `p_name`) match between the migration (Task 1) and the lib calls (Task 2) and the anon-leak probe (Task 1).

**Housekeeping note:** the orphaned `068_forge_elders_access_all_sets.sql` file is intentionally NOT recreated (its numeric slot is taken); migration 070's `create or replace` makes the repo's function body correct. Documented in the migration header and the spec.
