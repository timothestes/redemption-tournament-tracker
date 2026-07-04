# Superuser Admin Portal — Design

**Date:** 2026-07-03
**Route:** `/admin/permissions`
**Audience:** exactly one user — baboonytim (`6d30f6e3-838e-4f11-9416-95996da6e5b9`), the app superuser.

## Goal

One page where the superuser manages every human's admin permissions across both permission systems:

1. **App admins** — `admin_users.permissions text[]` (`manage_registrations`, `manage_tags`, `manage_spoilers`, `manage_cards`, `manage_rulings`, `threshing_floor`). Today there is **no UI**; every grant is a hand-written SQL migration.
2. **Forge members** — `playtest_members.role` (`superadmin` / `elder` / `playtester`). Role changes and removals are managed here; invites and per-set grants stay in the existing `/forge/admin` console (linked).

## Current state & problems

- No global superuser concept exists. Forge has its own superadmin (seeded to baboonytim, last-superadmin-protected).
- **Pre-existing hole (migration 005):** `admin_users` has RLS policies + grants that let *any* existing admin INSERT/DELETE admin rows client-side. Nothing in app code uses this path (verified — only definer RPCs `check_admin_role()` / `get_my_admin_permissions()` read the table). The portal's premise is superuser-only management, so this hole is closed as part of this work.
- `admin_users.permissions` is not declared in migration 005's CREATE TABLE (it exists in prod; first referenced in 016). The new migration adds a defensive `ADD COLUMN IF NOT EXISTS`.

## Design

### 1. Superuser gate

Migration `062_superuser_admin_portal.sql`:

- `public.is_superuser() returns boolean` — `select auth.uid() = '6d30f6e3-838e-4f11-9416-95996da6e5b9'::uuid`. Plain `stable` SQL (invoker; no table read needed). EXECUTE granted to `authenticated`, revoked from `anon` and `PUBLIC` explicitly (anon holds a direct default grant on new functions; revoking only from PUBLIC is not enough).
- Changing the superuser requires a migration. This is deliberate: the gate is not data the portal itself can edit, so the portal can never lock the superuser out.

Server-side: `app/admin/permissions/lib/auth.ts` (server-only lib, **not** `"use server"`, mirroring `app/forge/lib/auth.ts`) exports `requireSuperuser()` → `getUser()` + `is_superuser` RPC → `null` when not superuser. The page calls it and renders `notFound()` (404-not-403, Forge convention).

### 2. Database RPCs (migration 062)

All four: `SECURITY DEFINER`, `set search_path = ''`, EXECUTE revoked from `anon`/`PUBLIC`, granted to `authenticated`, and each **re-checks `public.is_superuser()` internally** (raises on failure) — a compromised UI or direct PostgREST call cannot escalate.

| RPC | Behavior |
|---|---|
| `super_list_admins()` | All `admin_users` rows joined with `profiles.username` and `auth.users.email`. Returns `(user_id, username, email, permissions, created_at)`. |
| `super_search_users(p_query text)` | ILIKE search over `profiles.username` and `auth.users.email`, limit 20. Returns `(user_id, username, email, is_admin)`. Empty/short query (< 2 chars) returns nothing. |
| `super_set_admin_permissions(p_user_id uuid, p_permissions text[])` | Validates every entry against the SQL allowlist (the 6 known strings; raises on unknown), upserts the `admin_users` row (`ON CONFLICT (user_id) DO UPDATE`). Empty array is allowed (admin row with no permissions — same state migration 005 admins started in). Raises if `p_user_id` has no `auth.users` row. |
| `super_remove_admin(p_user_id uuid)` | Deletes the row. No self-protection needed at DB level (the portal gate is `is_superuser()`, not table membership), but the UI confirms when removing the superuser's own row. |

**Legacy RLS tightening (same migration):** drop the three 005 policies ("Admins can view admin list" / "Admins can add new admins" / "Admins can remove admins") and `REVOKE INSERT, DELETE ON admin_users FROM authenticated`. Reads stay possible only via the existing definer RPCs; writes only via the new `super_*` RPCs. Nothing in app code used the direct paths.

**Zero new Forge SQL.** Forge role management reuses existing definer RPCs via the already-exported server actions in `app/forge/lib/members.ts` (`listMembers`, `changeRole`, `removeMember`). The superuser passes their `requireElder` gates as Forge superadmin; the existing last-superadmin trigger keeps his Forge row safe.

### 3. Permission catalog (TS)

`app/admin/permissions/lib/permissions.ts` — plain constant, importable from client and server:

```ts
export const ADMIN_PERMISSIONS = [
  { key: "manage_registrations", label: "Registrations" },
  { key: "manage_tags",          label: "Tags" },
  { key: "manage_spoilers",      label: "Spoilers" },
  { key: "manage_cards",         label: "Cards" },
  { key: "manage_rulings",       label: "Rulings" },
  { key: "threshing_floor",      label: "Threshing Floor" },
] as const;
```

Mirrored by the SQL allowlist in 062. Divergence risk is accepted and documented in both places (add a permission = touch both).

### 4. Server actions

`app/admin/permissions/actions.ts` (`"use server"`): thin wrappers — `listAdmins`, `searchUsers(q)`, `setAdminPermissions(userId, permissions)`, `removeAdmin(userId)` — each calls `requireSuperuser()` first (returns `{ ok: false, error }` when null), then the RPC, then `revalidatePath("/admin/permissions")`. Result shapes use the loose `{ ok: boolean; error?: string }` convention; any client narrowing uses `=== false` (strict:false tsconfig gotcha).

### 5. UI

`app/admin/permissions/page.tsx` — server component: `requireSuperuser()` → `notFound()` if null; fetches `super_list_admins()` + Forge `listMembers()` server-side; renders one client component `PermissionsPortal.tsx` with initial data.

Two sections (consistent with the app's data-dense, mobile-first shadcn/Tailwind style):

- **App admins** — table/cards: username, email, one checkbox per `ADMIN_PERMISSIONS` entry, Save (enabled when dirty), Remove (confirm dialog; extra warning when the target row is the superuser's own). **Add admin**: search input (debounced, `searchUsers`) → result list → pick user → new row with all boxes unchecked → Save creates the row.
- **Forge members** — table/cards: display name, role. Role `<select>` (elder ⇄ playtester) wired to `changeRole`; the superadmin row renders locked (no select, no remove — DB trigger enforces anyway). Remove (confirm) wired to `removeMember`. Section header links to `/forge/admin` for invites and per-set playtester grants.

Route protection layers: middleware already covers `/admin` prefix (auth required) → page 404s non-superuser → actions re-gate → RPCs re-check in SQL.

### 6. Navigation

- `components/providers/AdminProvider.tsx`: after the existing `check_admin_role` success path, also call `is_superuser` RPC; add `isSuperuser: boolean` to `AdminState` (default false everywhere else).
- `components/top-nav.tsx`: one "Permissions" link in the existing admin dropdown, rendered only when `isSuperuser`.

### 7. Edge cases

- **Lockout-proof:** the portal gate is the hardcoded-UUID function, not the data being edited. Removing his own `admin_users` row only drops page permissions (confirm dialog warns).
- **Forge last-superadmin:** existing DB trigger blocks demote/remove of the last superadmin; UI additionally locks the row.
- **Unknown permission strings** in existing prod rows (if any): Save writes exactly the checked catalog keys — non-catalog strings are dropped on save, and the row shows a visible warning chip beforehand so the drop is never silent. (Prod audit expected to find none; the allowlist RPC rejects writing them anyway.)
- **Email search privacy:** `super_search_users` exposes emails — acceptable, callable only by the superuser (SQL-enforced).

### 8. Testing

- New `__tests__/superuser-anon-leak.test.ts` following the `forge-anon-leak.test.ts` pattern (runs under `FORGE_LEAK_TEST=1` live probes): anon cannot execute any `super_*` RPC or `is_superuser`; anon sees zero `admin_users` rows. Add the file to the `test:security` script glob.
- Authenticated-non-superuser rejection is enforced in SQL and code-reviewed; live two-account probes need creds (same limitation as existing ISO skips).
- Build + full vitest suite must stay at baseline (1049 pass / 1 known pre-existing store-route fail).

### 9. Files

**New:** migration `062_superuser_admin_portal.sql`; `app/admin/permissions/{page.tsx, actions.ts, PermissionsPortal.tsx, lib/auth.ts, lib/permissions.ts}`; `__tests__/superuser-anon-leak.test.ts`; this spec.
**Modified (small):** `components/providers/AdminProvider.tsx`, `components/top-nav.tsx`, `package.json` (test:security glob), possibly `hooks/useIsAdmin.ts` (type re-export only).
**Untouched:** all `app/forge/**` (other agents active there) — Forge reuse is import-only.

## Out of scope

- Managing Forge invites / per-set grants (stays in `/forge/admin`).
- Audit log for admin changes (Forge has `forge_audit`; main system has none — can be added later if wanted).
- Creating new permission *types* from the UI (permissions map to code-gated routes; adding one is inherently a code change).
- Multiple superusers / transferring superuser (migration-only by design).
