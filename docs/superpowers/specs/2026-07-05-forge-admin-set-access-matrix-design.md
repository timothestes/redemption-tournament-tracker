# Forge Admin — Set Access Matrix

**Date:** 2026-07-05
**Status:** Design approved
**Scope:** UI-only. No migration, no RPC, no change to the security spine.

## Problem

Granting a playtester access to a set today requires either (a) setting it at
invite time via the set multiselect on a playtester invite, or (b) navigating to
each set's **Progress** tab and using its per-set "Playtesters" panel. There is no
single place to see and change, dynamically, who can access what across all sets.

## Goal

Add a **Set access** matrix to the Forge admin console (`/forge/admin`): playtesters
as rows, sets as columns, a checkbox at each intersection. Toggling a cell grants or
revokes that playtester's access to that set.

## Why this is UI-only

The backend already exists (Phase 2.1, migration 055) and its authorization is exactly
what the matrix needs:

- **Writes** — `forge_grant_set` / `forge_revoke_set` RPCs require
  `is_forge_set_elder(p_set_id) OR is_forge_superadmin()`. Wrapped by the elder-gated
  `grantSet(setId, userId)` / `revokeSet(setId, userId)` server actions in
  `app/forge/lib/sets.ts`. Reused unchanged.
- **Reads** — the `forge_set_grants` SELECT policy is
  `is_forge_set_elder(set_id) OR is_forge_superadmin() OR user_id = auth.uid()`, so a
  bulk read of grant rows is automatically scoped: a superadmin sees every grant, an
  elder sees only grants for sets they're an elder of.
- **Columns** — `listSets()` reads `forge_sets`, whose SELECT policy is
  `is_forge_set_elder(id) OR is_forge_set_granted(id) OR is_forge_superadmin()`. The
  `sets` prop already passed to `AdminConsole` is therefore already scoped to the sets
  the caller can manage. No new "manageable columns" query is required.

Because reads, writes, and the column list are all pre-scoped to what the caller may
manage, every rendered cell is actionable in the realistic cases (superadmin manages
all; an elder manages the sets they're an elder of).

## Design

### Rows and columns

- **Rows** = members with `role === 'playtester'`, derived in-component from the
  `members` prop already passed to `AdminConsole`. Elders/superadmins are excluded —
  they can already see every set, so a grant is meaningless for them (matches the
  existing Progress-tab convention).
- **Columns** = the `sets` prop already passed to `AdminConsole` (already scoped).

### Data loading

`app/forge/admin/page.tsx` gains one more fetch, run in the existing `Promise.all`:

```ts
listAllSetGrants(): Promise<{ setId: string; userId: string }[]>
```

New export in `app/forge/lib/sets.ts`: `requireForge`, then
`select set_id, user_id from forge_set_grants` (RLS scopes it), mapped to
`{ setId, userId }`. The result is passed to `AdminConsole` as a `grants` prop.

### Component

New client component `app/forge/admin/SetAccessMatrix.tsx`, rendered as a new
`<section>` inside `AdminConsole` below the Members table, only when there is at least
one playtester and at least one set.

- Grant state is a `Set<string>` of `grantKey(userId, setId)` keys, seeded from the
  `grants` prop.
- A cell is a checkbox. Toggling optimistically flips the key in local state, then
  calls `grantSet` / `revokeSet`. On success, `router.refresh()`. On failure, revert
  the key and show an inline `aria-live` message (mirrors the existing `run()` pattern
  in `AdminConsole` / `PlaytesterGrants`).
- Pending is tracked **per cell** (a `Set` of in-flight keys) so one toggle doesn't
  freeze the grid.
- The table is wrapped in `overflow-x-auto` so many columns scroll horizontally rather
  than break the `max-w-3xl` admin layout (mobile-first).

### Pure helper

`app/forge/lib/setAccess.ts`:

- `grantKey(userId, setId): string` — the `"${userId}|${setId}"` key.
- `buildGrantKeySet(pairs): Set<string>` — seed set from `{setId,userId}[]`.

Unit-tested. Keeps the component free of ad-hoc key string building.

### Result-narrowing note

`grantSet` / `revokeSet` return `{ ok: true } | { ok: false; error: string }`. The repo
has `strict: false`, which breaks `if (r.ok)` union narrowing, so the component uses
`r.ok === false` narrowing (same as the existing `run()` helpers).

## What stays

- The per-set "Playtesters" panel on each set's Progress tab (contextual, keep it).
- The invite-time set multiselect (grants at redemption, before the person is a
  member — the matrix can't cover that case).

## Non-goals

- No changes to migrations, RPCs, RLS, or the anon-leak test surface (unchanged).
- No bulk "grant all / revoke all" affordance in v1.
- No granting to elders/superadmins.

## Testing

- Unit tests for `grantKey` / `buildGrantKeySet`.
- `npm run build` (catches the strict:false narrowing gotcha and RSC prop wiring).
- Playwright smoke of the admin page rendering the matrix (optional, behind existing
  Forge e2e cookie recipe).
- No `test:security` change — leak surface unchanged.
