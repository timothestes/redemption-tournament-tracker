# Superuser Admin Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superuser-only page at `/admin/permissions` where baboonytim manages every `admin_users` permission and every Forge member role, backed by SQL-enforced `super_*` RPCs.

**Architecture:** Migration 062 adds `is_superuser()` (hardcoded UUID) + four SECURITY DEFINER RPCs that re-check superuser inside SQL, and closes the legacy 005 hole where any admin could write `admin_users` directly. A server-only `requireSuperuser()` gate 404s the page; thin server actions wrap the RPCs; one client component renders both sections. Forge role management reuses the existing `app/forge/lib/members.ts` server actions unchanged.

**Tech Stack:** Next.js 15 App Router, Supabase (definer RPCs + RLS), Tailwind + existing `components/ui/*`, vitest live-probe security test.

**Spec:** `docs/superpowers/specs/2026-07-03-superuser-admin-portal-design.md`

## Global Constraints

- Superuser UUID (exact): `6d30f6e3-838e-4f11-9416-95996da6e5b9`
- Permission allowlist (exact 6): `manage_registrations`, `manage_tags`, `manage_spoilers`, `manage_cards`, `manage_rulings`, `threshing_floor`
- Every `super_*` RPC: `SECURITY DEFINER`, `set search_path = ''`, internal `is_superuser()` check, EXECUTE revoked from `anon` AND `PUBLIC`, granted to `authenticated` (revoking only PUBLIC is not enough — anon holds a direct default grant)
- Gate style: 404 via `notFound()`, never 403
- tsconfig has `strict:false` — never rely on `if (r.ok)/else` union narrowing in clients; use `r.ok === false`
- Do NOT modify any file under `app/forge/**` (other agents own that area; reuse is import-only)
- No `focus:ring-2 focus:ring-ring` on form controls; no green-at-rest links (project design feedback)
- Work happens in worktree `.claude/worktrees/superuser-admin-portal` (branch `worktree-superuser-admin-portal`, based on main `bf5de2b`). Use absolute paths in any subagent dispatch and tell subagents to ignore sibling checkouts.
- Test baseline: 1049 pass / 1 pre-existing fail (`app/threshingfloor/api/__tests__/store-route.test.ts`) — must not regress
- Migration number 062 is free on main as of `bf5de2b`; re-verify `ls supabase/migrations/ | tail` before the live apply and renumber if another PR claimed it

---

### Task 1: Migration 062 — is_superuser() + super_* RPCs + legacy lockdown

**Files:**
- Create: `supabase/migrations/062_superuser_admin_portal.sql`

**Interfaces:**
- Produces (for later tasks): RPCs `is_superuser()` → boolean; `super_list_admins()` → setof `(user_id uuid, username text, email text, permissions text[], created_at timestamptz)`; `super_search_users(p_query text)` → setof `(user_id uuid, username text, email text, is_admin boolean)`; `super_set_admin_permissions(p_user_id uuid, p_permissions text[])` → void; `super_remove_admin(p_user_id uuid)` → void.

- [ ] **Step 1: Write the migration file**

```sql
-- 062_superuser_admin_portal.sql
-- Superuser-only management of admin_users permissions (spec:
-- docs/superpowers/specs/2026-07-03-superuser-admin-portal-design.md).
-- The app superuser is ONE hardcoded auth.users id (baboonytim); changing it
-- requires a migration by design, so the portal can never lock him out.

-- 1) Superuser identity check -----------------------------------------------
create or replace function public.is_superuser()
returns boolean
language sql
stable
as $$
  select auth.uid() = '6d30f6e3-838e-4f11-9416-95996da6e5b9'::uuid
$$;

revoke execute on function public.is_superuser() from public, anon;
grant execute on function public.is_superuser() to authenticated;

-- 2) Defensive: permissions column exists in prod but was never declared in
--    migration 005; declare it for fresh environments.
alter table public.admin_users
  add column if not exists permissions text[] not null default '{}';

-- 3) Close the 005 hole: any admin could INSERT/DELETE admin_users rows
--    directly. Nothing in app code uses direct table access (reads go via the
--    definer RPCs check_admin_role / get_my_admin_permissions); from now on
--    writes go ONLY via the super_* RPCs below.
drop policy if exists "Admins can view admin list" on public.admin_users;
drop policy if exists "Admins can add new admins" on public.admin_users;
drop policy if exists "Admins can remove admins" on public.admin_users;
revoke select, insert, update, delete on table public.admin_users from anon, authenticated;

-- 4) super_list_admins -------------------------------------------------------
create or replace function public.super_list_admins()
returns table (
  user_id uuid,
  username text,
  email text,
  permissions text[],
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  return query
    select au.user_id,
           p.username,
           u.email::text,
           coalesce(au.permissions, '{}'),
           au.created_at
    from public.admin_users au
    join auth.users u on u.id = au.user_id
    left join public.profiles p on p.id = au.user_id
    order by au.created_at;
end;
$$;

-- 5) super_search_users ------------------------------------------------------
create or replace function public.super_search_users(p_query text)
returns table (
  user_id uuid,
  username text,
  email text,
  is_admin boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  if length(q) < 2 then
    return;
  end if;
  return query
    select u.id,
           p.username,
           u.email::text,
           exists (select 1 from public.admin_users au where au.user_id = u.id)
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.email ilike '%' || q || '%'
       or p.username ilike '%' || q || '%'
    order by u.email
    limit 20;
end;
$$;

-- 6) super_set_admin_permissions ----------------------------------------------
-- Allowlist MIRRORS app/admin/permissions/lib/permissions.ts — update both together.
create or replace function public.super_set_admin_permissions(p_user_id uuid, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed constant text[] := array[
    'manage_registrations','manage_tags','manage_spoilers',
    'manage_cards','manage_rulings','threshing_floor'
  ];
  perm text;
  perms text[] := coalesce(p_permissions, '{}');
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  foreach perm in array perms loop
    if not (perm = any(allowed)) then
      raise exception 'unknown permission: %', perm;
    end if;
  end loop;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'no such user';
  end if;
  insert into public.admin_users (user_id, permissions, created_by)
  values (p_user_id, perms, auth.uid())
  on conflict (user_id) do update set permissions = excluded.permissions;
end;
$$;

-- 7) super_remove_admin -------------------------------------------------------
create or replace function public.super_remove_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_superuser() then
    raise exception 'not authorized';
  end if;
  delete from public.admin_users where user_id = p_user_id;
end;
$$;

-- 8) Lock down EXECUTE on the definer RPCs ------------------------------------
revoke execute on function public.super_list_admins() from public, anon;
revoke execute on function public.super_search_users(text) from public, anon;
revoke execute on function public.super_set_admin_permissions(uuid, text[]) from public, anon;
revoke execute on function public.super_remove_admin(uuid) from public, anon;
grant execute on function public.super_list_admins() to authenticated;
grant execute on function public.super_search_users(text) to authenticated;
grant execute on function public.super_set_admin_permissions(uuid, text[]) to authenticated;
grant execute on function public.super_remove_admin(uuid) to authenticated;
```

- [ ] **Step 2: Sanity-check every RPC body is guarded**

Run: `grep -c "if not public.is_superuser() then" supabase/migrations/062_superuser_admin_portal.sql`
Expected: `4` (one guard per `super_*` RPC body).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/062_superuser_admin_portal.sql
git commit -m "feat(admin): migration 062 — is_superuser() + super_* admin RPCs, close 005 write hole"
```

(Live apply happens in Task 7, after the app code exists.)

---

### Task 2: Permission catalog + requireSuperuser gate

**Files:**
- Create: `app/admin/permissions/lib/permissions.ts`
- Create: `app/admin/permissions/lib/auth.ts`

**Interfaces:**
- Consumes: `is_superuser` RPC (Task 1), `createClient` from `utils/supabase/server.ts`
- Produces: `ADMIN_PERMISSIONS: readonly {key,label}[]`; `requireSuperuser(): Promise<{supabase, user} | null>`

- [ ] **Step 1: Write the catalog**

```ts
// app/admin/permissions/lib/permissions.ts
// Permission catalog for the superuser portal. MIRROR of the SQL allowlist in
// supabase/migrations/062_superuser_admin_portal.sql — update both together.
export const ADMIN_PERMISSIONS = [
  { key: "manage_registrations", label: "Registrations" },
  { key: "manage_tags", label: "Tags" },
  { key: "manage_spoilers", label: "Spoilers" },
  { key: "manage_cards", label: "Cards" },
  { key: "manage_rulings", label: "Rulings" },
  { key: "threshing_floor", label: "Threshing Floor" },
] as const;

export const ADMIN_PERMISSION_KEYS: string[] = ADMIN_PERMISSIONS.map((p) => p.key);
```

- [ ] **Step 2: Write the gate (mirrors `app/forge/lib/auth.ts`)**

```ts
// app/admin/permissions/lib/auth.ts
// Server-only: do not import from "use client" files.
import { createClient } from "@/utils/supabase/server";

type SuperuserContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string | null };
};

/**
 * Gate for the superuser portal. Returns null unless the caller is THE app
 * superuser (hardcoded uid checked in SQL by public.is_superuser()).
 * Callers respond 404 (not 401/403) so the page stays invisible.
 */
export async function requireSuperuser(): Promise<SuperuserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: isSuper } = await supabase.rpc("is_superuser");
  if (isSuper !== true) return null;

  return { supabase, user };
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/permissions/lib/permissions.ts app/admin/permissions/lib/auth.ts
git commit -m "feat(admin): permission catalog + requireSuperuser gate"
```

---

### Task 3: Server actions

**Files:**
- Create: `app/admin/permissions/actions.ts`

**Interfaces:**
- Consumes: `requireSuperuser()` (Task 2), `super_*` RPCs (Task 1)
- Produces: `listAdmins(): Promise<AdminRow[]>`, `searchUsers(query: string): Promise<UserHit[]>`, `setAdminPermissions(userId: string, permissions: string[]): Promise<{ok: boolean; error?: string}>`, `removeAdmin(userId: string): Promise<{ok: boolean; error?: string}>`, plus exported types `AdminRow`, `UserHit`.

- [ ] **Step 1: Write the actions**

```ts
// app/admin/permissions/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";

export type AdminRow = {
  user_id: string;
  username: string | null;
  email: string | null;
  permissions: string[];
  created_at: string;
};

export type UserHit = {
  user_id: string;
  username: string | null;
  email: string | null;
  is_admin: boolean;
};

export async function listAdmins(): Promise<AdminRow[]> {
  const ctx = await requireSuperuser();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("super_list_admins");
  return (data as AdminRow[] | null) ?? [];
}

export async function searchUsers(query: string): Promise<UserHit[]> {
  const ctx = await requireSuperuser();
  if (!ctx) return [];
  const { data } = await ctx.supabase.rpc("super_search_users", { p_query: query });
  return (data as UserHit[] | null) ?? [];
}

export async function setAdminPermissions(
  userId: string,
  permissions: string[]
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("super_set_admin_permissions", {
    p_user_id: userId,
    p_permissions: permissions,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/permissions");
  return { ok: true };
}

export async function removeAdmin(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireSuperuser();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("super_remove_admin", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/permissions");
  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/permissions/actions.ts
git commit -m "feat(admin): superuser portal server actions"
```

---

### Task 4: Portal page + client component

**Files:**
- Create: `app/admin/permissions/page.tsx`
- Create: `app/admin/permissions/PermissionsPortal.tsx`

**Interfaces:**
- Consumes: `requireSuperuser` (Task 2), actions + types (Task 3), `listMembers`, `changeRole`, `removeMember` and type `ForgeRole` from `@/app/forge/lib/members` / `@/app/forge/lib/auth` (existing, DO NOT EDIT), `ADMIN_PERMISSIONS` (Task 2).
- Produces: route `/admin/permissions`; exported type `ForgeMemberRow` from `PermissionsPortal.tsx`.

- [ ] **Step 1: Write the page (server component)**

```tsx
// app/admin/permissions/page.tsx
import { notFound } from "next/navigation";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { listMembers } from "@/app/forge/lib/members";
import { listAdmins } from "./actions";
import PermissionsPortal, { type ForgeMemberRow } from "./PermissionsPortal";

export const metadata = { title: "Permissions" };
export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const ctx = await requireSuperuser();
  if (!ctx) notFound();

  const [admins, forgeMembers] = await Promise.all([listAdmins(), listMembers()]);

  return (
    <PermissionsPortal
      initialAdmins={admins}
      forgeMembers={forgeMembers as ForgeMemberRow[]}
      selfId={ctx.user.id}
    />
  );
}
```

- [ ] **Step 2: Write the client component**

```tsx
// app/admin/permissions/PermissionsPortal.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ADMIN_PERMISSIONS, ADMIN_PERMISSION_KEYS } from "./lib/permissions";
import {
  removeAdmin,
  searchUsers,
  setAdminPermissions,
  type AdminRow,
  type UserHit,
} from "./actions";
import { changeRole, removeMember } from "@/app/forge/lib/members";

export type ForgeMemberRow = {
  user_id: string;
  role: "superadmin" | "elder" | "playtester";
  display_name: string | null;
  created_at: string;
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export default function PermissionsPortal({
  initialAdmins,
  forgeMembers,
  selfId,
}: {
  initialAdmins: AdminRow[];
  forgeMembers: ForgeMemberRow[];
  selfId: string;
}) {
  const router = useRouter();
  const [admins, setAdmins] = useState<AdminRow[]>(initialAdmins);
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-admin search
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const results = await searchUsers(q);
      setHits(results);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const rowPerms = (row: AdminRow): string[] => edits[row.user_id] ?? row.permissions;
  const isDirty = (row: AdminRow): boolean =>
    edits[row.user_id] !== undefined && !sameSet(edits[row.user_id], row.permissions);

  const toggle = (row: AdminRow, key: string) => {
    const current = rowPerms(row);
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    setEdits((e) => ({ ...e, [row.user_id]: next }));
  };

  const save = async (row: AdminRow) => {
    setBusyId(row.user_id);
    setError(null);
    // Save writes exactly the checked catalog keys; unknown strings are dropped
    // (the row shows a warning chip beforehand so the drop is never silent).
    const next = rowPerms(row).filter((k) => ADMIN_PERMISSION_KEYS.includes(k));
    const r = await setAdminPermissions(row.user_id, next);
    if (r.ok === false) {
      setError(r.error ?? "Save failed");
    } else {
      setAdmins((rows) =>
        rows.map((a) => (a.user_id === row.user_id ? { ...a, permissions: next } : a))
      );
      setEdits((e) => {
        const { [row.user_id]: _, ...rest } = e;
        return rest;
      });
    }
    setBusyId(null);
  };

  const remove = async (row: AdminRow) => {
    const warning =
      row.user_id === selfId
        ? "This is YOUR admin row — removing it drops your own page permissions (the portal itself stays accessible). Remove?"
        : `Remove all admin permissions for ${row.username ?? row.email ?? row.user_id}?`;
    if (!window.confirm(warning)) return;
    setBusyId(row.user_id);
    setError(null);
    const r = await removeAdmin(row.user_id);
    if (r.ok === false) {
      setError(r.error ?? "Remove failed");
    } else {
      setAdmins((rows) => rows.filter((a) => a.user_id !== row.user_id));
    }
    setBusyId(null);
  };

  const addAdmin = (hit: UserHit) => {
    setQuery("");
    setHits([]);
    if (admins.some((a) => a.user_id === hit.user_id)) return;
    setAdmins((rows) => [
      ...rows,
      {
        user_id: hit.user_id,
        username: hit.username,
        email: hit.email,
        permissions: [],
        created_at: "",
      },
    ]);
    setEdits((e) => ({ ...e, [hit.user_id]: [] }));
  };

  // Forge section --------------------------------------------------------------
  const [forgeBusyId, setForgeBusyId] = useState<string | null>(null);

  const changeForgeRole = async (m: ForgeMemberRow, newRole: "elder" | "playtester") => {
    setForgeBusyId(m.user_id);
    setError(null);
    const r = await changeRole(m.user_id, newRole);
    if (r.ok === false) setError(r.error ?? "Role change failed");
    router.refresh();
    setForgeBusyId(null);
  };

  const removeForgeMember = async (m: ForgeMemberRow) => {
    if (
      !window.confirm(
        `Remove ${m.display_name ?? m.user_id} from the Forge? Their cards are reassigned per Forge rules.`
      )
    )
      return;
    setForgeBusyId(m.user_id);
    setError(null);
    const r = await removeMember(m.user_id);
    if (r.ok === false) setError(r.error ?? "Remove failed");
    router.refresh();
    setForgeBusyId(null);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Permissions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Superuser portal — manage app admins and Forge member roles.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* App admins ---------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">App admins</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">User</th>
                {ADMIN_PERMISSIONS.map((p) => (
                  <th key={p.key} className="px-2 py-2 font-medium text-center whitespace-nowrap">
                    {p.label}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {admins.map((row) => {
                const unknown = row.permissions.filter(
                  (k) => !ADMIN_PERMISSION_KEYS.includes(k)
                );
                return (
                  <tr key={row.user_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.username ?? "(no username)"}</div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                      {unknown.length > 0 && (
                        <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          unknown: {unknown.join(", ")} (dropped on save)
                        </div>
                      )}
                    </td>
                    {ADMIN_PERMISSIONS.map((p) => (
                      <td key={p.key} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={rowPerms(row).includes(p.key)}
                          onChange={() => toggle(row, p.key)}
                          disabled={busyId === row.user_id}
                          aria-label={`${p.label} for ${row.username ?? row.email}`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => save(row)}
                        disabled={!isDirty(row) || busyId === row.user_id}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => remove(row)}
                        disabled={busyId === row.user_id}
                        className="ml-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-red-600 hover:border-red-300"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              {admins.length === 0 && (
                <tr>
                  <td
                    colSpan={ADMIN_PERMISSIONS.length + 2}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No admins.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add admin */}
        <div className="max-w-md space-y-2">
          <label className="text-sm font-medium" htmlFor="admin-search">
            Add admin
          </label>
          <input
            id="admin-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username or email…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          {hits.length > 0 && (
            <ul className="rounded-md border border-border divide-y divide-border">
              {hits.map((h) => (
                <li key={h.user_id}>
                  <button
                    onClick={() => addAdmin(h)}
                    disabled={h.is_admin}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <span>
                      <span className="font-medium">{h.username ?? "(no username)"}</span>{" "}
                      <span className="text-muted-foreground">{h.email}</span>
                    </span>
                    {h.is_admin && <span className="text-xs text-muted-foreground">already admin</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Forge members ------------------------------------------------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Forge members</h2>
          <Link
            href="/forge/admin"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Invites &amp; set grants → Forge admin
          </Link>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Member</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {forgeMembers.map((m) => (
                <tr key={m.user_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {m.display_name ?? "(no name)"}
                  </td>
                  <td className="px-3 py-2">
                    {m.role === "superadmin" ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                        superadmin (locked)
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          changeForgeRole(m, e.target.value as "elder" | "playtester")
                        }
                        disabled={forgeBusyId === m.user_id}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      >
                        <option value="elder">elder</option>
                        <option value="playtester">playtester</option>
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {m.role !== "superadmin" && (
                      <button
                        onClick={() => removeForgeMember(m)}
                        disabled={forgeBusyId === m.user_id}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-red-600 hover:border-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {forgeMembers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    No Forge members.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck via build**

Run: `npm run build 2>&1 | tail -20`
Expected: compiles; `/admin/permissions` appears in the route list. (The build is the only typecheck — vitest doesn't typecheck.)

- [ ] **Step 4: Commit**

```bash
git add app/admin/permissions/page.tsx app/admin/permissions/PermissionsPortal.tsx
git commit -m "feat(admin): /admin/permissions superuser portal UI"
```

---

### Task 5: AdminProvider isSuperuser + top-nav links

**Files:**
- Modify: `components/providers/AdminProvider.tsx` (add `isSuperuser` to state)
- Modify: `components/top-nav.tsx` (desktop dropdown ~line 292-301 after Manage Rulings; mobile section ~line 677-686 after Manage Rulings)

**Interfaces:**
- Consumes: `is_superuser` RPC (Task 1)
- Produces: `useIsAdmin()` now returns `{ isAdmin, isSuperuser, permissions, loading }` (`hooks/useIsAdmin.ts` needs no edit — it re-exports the context)

- [ ] **Step 1: Extend AdminProvider**

In `components/providers/AdminProvider.tsx`:
- Add `isSuperuser: boolean;` to `interface AdminState`.
- Add `isSuperuser: false` to: the initial `useState`, the `!user` branch, the `adminError || !isAdminData` branch, the `catch` branch, and the `useAdminContext` fallback object.
- In the success path, after the permissions RPC:

```ts
const { data: superData } = await supabase.rpc("is_superuser");

setState({
  isAdmin: true,
  isSuperuser: superData === true,
  permissions: permsError ? [] : (permsData || []),
  loading: false,
});
```

(If the migration isn't applied in an environment, the RPC errors → `superData` undefined → `false`. Fail-closed.)

- [ ] **Step 2: Add nav links**

In `components/top-nav.tsx`:
- Destructure: `const { isAdmin, isSuperuser, permissions, loading: adminLoading } = useIsAdmin();`
- Add `HiKey` to the existing `react-icons/hi` import.
- Desktop dropdown — immediately after the `manage_rulings` block (closes at ~line 301):

```tsx
{isSuperuser && (
  <Link
    href="/admin/permissions"
    onClick={() => setIsAdminOpen(false)}
    className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
  >
    <HiKey className="w-4 h-4" />
    Permissions
  </Link>
)}
```

- Mobile section — immediately after the mobile `manage_rulings` block (closes at ~line 686):

```tsx
{isSuperuser && (
  <Link
    href="/admin/permissions"
    onClick={closeMobileMenu}
    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
  >
    <HiKey className="w-4 h-4" />
    Permissions
  </Link>
)}
```

- [ ] **Step 3: Build check**

Run: `npm run build 2>&1 | tail -5`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add components/providers/AdminProvider.tsx components/top-nav.tsx
git commit -m "feat(nav): isSuperuser flag + Permissions link (superuser only)"
```

---

### Task 6: Security test — anon probes for the portal

**Files:**
- Create: `__tests__/superuser-anon-leak.test.ts`
- Modify: `package.json` line 72 (`test:security` script)

**Interfaces:**
- Consumes: RPC names from Task 1. Mirrors the structure of `__tests__/forge-anon-leak.test.ts` (read its RPC-probe assertion at lines ~90-100 and use the identical assertion style).

- [ ] **Step 1: Write the test**

```ts
// __tests__/superuser-anon-leak.test.ts
import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load local env (Next convention); CI provides these as secrets.
config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Opt-in: only runs under `npm run test:security` (same switch as the forge suite).
const ENABLED = process.env.FORGE_LEAK_TEST === "1" && !!URL && !!ANON;

describe.runIf(ENABLED)("Superuser portal anon-leak guardrail", () => {
  const anon = createClient(URL!, ANON!);

  it("anon sees zero rows in admin_users", async () => {
    const { data, error } = await anon.from("admin_users").select("*").limit(1000);
    const rows = data ?? [];
    expect(
      rows.length,
      `anon leaked ${rows.length} row(s) from admin_users (error: ${error?.message ?? "none"})`
    ).toBe(0);
  });

  const SUPER_RPCS: Array<[string, Record<string, unknown>]> = [
    ["is_superuser", {}],
    ["super_list_admins", {}],
    ["super_search_users", { p_query: "xx" }],
    ["super_set_admin_permissions", { p_user_id: "00000000-0000-0000-0000-000000000000", p_permissions: [] }],
    ["super_remove_admin", { p_user_id: "00000000-0000-0000-0000-000000000000" }],
  ];

  for (const [fn, args] of SUPER_RPCS) {
    it(`anon cannot execute ${fn}`, async () => {
      const { error } = await anon.rpc(fn, args);
      // match the assertion style used in __tests__/forge-anon-leak.test.ts
      expect(error, `anon executed ${fn} without an error`).not.toBeNull();
    });
  }
});
```

- [ ] **Step 2: Update the security script**

`package.json` line 72, change:

```json
"test:security": "FORGE_LEAK_TEST=1 vitest run forge-anon-leak superuser-anon-leak",
```

- [ ] **Step 3: Hermetic run (should skip cleanly)**

Run: `npx vitest run superuser-anon-leak`
Expected: suite is skipped (no `.env.local` in the worktree → `ENABLED` false). No failures.

- [ ] **Step 4: Commit**

```bash
git add __tests__/superuser-anon-leak.test.ts package.json
git commit -m "test(security): anon probes for superuser portal RPCs + admin_users"
```

---

### Task 7: Verification, live migration apply, live security run

**Files:** none new (verification only)

- [ ] **Step 1: Full hermetic suite + build**

Run: `npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -5`
Expected: 1049+ pass, only the pre-existing `store-route.test.ts` failure; build clean with `/admin/permissions` in the route list.

- [ ] **Step 2: Re-verify migration number is still free**

Run: `git fetch origin main --quiet && git ls-tree origin/main supabase/migrations/ | grep -o '06[0-9]_[a-z_]*' | sort | tail -3`
Expected: nothing numbered 062. If taken, renumber the file and the references in it/tests.

- [ ] **Step 3: Apply migration 062 to prod via Supabase MCP** (`apply_migration`, name `superuser_admin_portal`)

Expected: `{"success": true}`. Then run `get_advisors` (security) — expect no NEW problematic findings (the `super_*` functions will appear under the benign by-design "authenticated-definer-executable" WARN like every other definer RPC; the pre-existing unrelated `security_definer_view` ERROR remains).

- [ ] **Step 4: Live security probes**

Copy env into the worktree (gitignored), then run:

```bash
cp /Users/timestes/projects/redemption-tournament-tracker/.env.local .env.local
npm run test:security
```

Expected: all forge probes still green PLUS 6 new tests green (1 admin_users row probe + 5 RPC probes).

- [ ] **Step 5: Manual smoke (user)** — sign in as baboonytim → `/admin/permissions` renders both sections; a non-superuser account (e.g. landofredemption@gmail.com) gets 404 and sees no nav link.
