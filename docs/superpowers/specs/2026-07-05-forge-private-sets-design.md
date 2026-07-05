# Forge: Private Sets — Design

**Date:** 2026-07-05
**Branch:** `forge-private-sets` (off `main`)
**Status:** Approved (approach + toggle-ability confirmed by user)

## Problem

All Forge elders currently see every set. A prod migration (`forge_elders_access_all_sets`, DB version `20260705221747`) folded a global-elder shortcut into the single `is_forge_set_elder` choke point so every elder can view/design in every set — great for shared work on EoT, but it means a pair of designers (e.g. Tyler & Chris starting set 27) cannot work on an early-stage set *without it appearing on every other elder's dashboard and distracting from EoT*.

We want **private sets**: a set visible and editable only to superadmins and an explicit designer roster, hidden from all other elders — while public sets keep the current all-elders-see-all behavior.

Decision (user-confirmed): implement this as an **`is_private` flag on a set**, not a new "Card Designer" role. A new role would not hide a set from elders, so it would not solve the stated need. Privacy is a property of the *set*.

Decision (user-confirmed): privacy is **togglable both ways** after creation.

## Current architecture (relevant facts)

- **Single choke point.** `is_forge_set_elder(p_set_id uuid)` is called by ~30 surfaces: the SELECT policies on `forge_sets`, `forge_set_elders`, `forge_set_grants`, `forge_cards`, `card_versions`; the read-guard functions `_forge_can_read_card` and `_forge_can_read_topic` (which in turn gate `card_proposals`/`card_comments` SELECT and `realtime.messages`); and every set-scoped write/lifecycle RPC (`forge_save_card`, `forge_publish_card`, `forge_approve_card`, `forge_delete_card`, `forge_add_set_elder`, `forge_grant_set`, `forge_delete_set`, `forge_accept_proposal`, …). Change this one function and every surface inherits the new rule.

- **Current body** (live DB, verbatim):
  ```sql
  create or replace function public.is_forge_set_elder(p_set_id uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
    select public.is_forge_elder_or_super()
        or exists(
      select 1 from public.forge_set_elders e
      where e.set_id = p_set_id and e.user_id = auth.uid()
    );
  $$;
  ```
  The `is_forge_elder_or_super()` disjunct is the entire "all elders see all sets" mechanism. Note this migration's file (`068_forge_elders_access_all_sets.sql`) was **never committed** — the repo's `052` still shows the old membership-only body. Our new migration supersedes the deployed body.

- **`forge_sets`** (`052`): `id, name, slug, notes, target_counts jsonb, status, created_by, created_at, updated_at`. RLS-enabled with **only a SELECT policy** (`is_forge_set_elder(id) or is_forge_set_granted(id) or is_forge_superadmin()`); all writes go through SECURITY DEFINER RPCs. No `is_private`/`visibility` column exists.

- **`forge_set_elders`** (`set_id, user_id`) is the designer roster. Creator is auto-enrolled by `forge_create_set`. After the elders-access-all change this roster became *attribution-only* (the Progress-tab "Designers" list). **For private sets it becomes the real access-control list again.**

- **Helpers:** `is_forge_superadmin()`, `is_forge_elder_or_super()` (role ∈ {elder,superadmin}), `is_forge_member()`, `is_forge_set_granted()` (playtester grants). All `SECURITY DEFINER` — so reads inside them bypass RLS (no recursion).

- **App layer** (`app/forge/lib/sets.ts`): `createSet(name)` → `rpc("forge_create_set",{p_name})`; `listSets()`/`getSet()` are RLS-scoped selects; `canDesignSet()` → `rpc("is_forge_set_elder",{p_set_id})`; designer management via `addSetElder`/`removeSetElder`/`listSetElders`. `ForgeSetSummary`/`ForgeSetDetail` types have no privacy field. `forge_create_set` has exactly one RPC call site (this lib); the lib `createSet` has two callers: `SetsIndex.tsx` (create dialog) and `ImportWizard.tsx` (Lackey import).

## Design

### 1. Data model

Add one column:

```sql
alter table public.forge_sets
  add column if not exists is_private boolean not null default false;
```

All existing sets default to public → **no behavior change on rollout**.

### 2. Choke-point redefinition (the entire security story)

Withhold the global-elder shortcut for private sets. Superadmin always retains access; an explicit roster designer always retains access; a global elder gets access **only when the set is not private**:

```sql
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
```

Truth table for the third clause (`not exists(private row)`):
- set public → no private row → `true` (global elder allowed, unchanged from today)
- set private → private row exists → `false` (global elder excluded; must be on roster)
- set missing → `true` (harmless; there is no set to read — matches today's behavior)

Safe against recursion: the function is `SECURITY DEFINER` running as owner, so the `select … from forge_sets` inside it bypasses the `forge_sets_select` RLS policy (same pattern as `is_forge_set_granted` reading `forge_set_grants`).

Because this function is the sole choke point, a private set is automatically hidden from: the sets grid (`listSets`), card pages, `card_versions`, comments/proposals, the art proxy, realtime channels (`forge:set:*`, `forge:card:*`), and every write/lifecycle RPC — for every non-designer elder. Non-members/anon stay `false` throughout (leak boundary unchanged).

### 3. RPCs

**`forge_create_set` — accept privacy.** Drop the 1-arg form and recreate with a defaulted second arg so both existing single-arg callers and new callers resolve to it:

```sql
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
```

The creator is still auto-enrolled in `forge_set_elders` — for a private set that seeds the access list, which the creator then extends via the existing "Add a designer" control.

**`forge_set_privacy` — toggle.** Gated **stricter** than `is_forge_set_elder`: superadmin OR an explicit roster designer only. This prevents a global elder (who currently passes `is_forge_set_elder` for any public set) from privatizing a shared set out from under its collaborators.

```sql
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

### 4. App layer (`app/forge/lib/sets.ts`)

- Add `isPrivate: boolean` to `ForgeSetSummary` and `ForgeSetDetail`.
- `listSets`: select `is_private`, map to `isPrivate` on each summary.
- `getSet`: select `is_private`, map to `isPrivate`.
- `createSet(name: string, isPrivate = false)`: pass `p_is_private: isPrivate`.
- New `setSetPrivacy(setId: string, isPrivate: boolean)` action: `requireElder()` → `rpc("forge_set_privacy", { p_set_id: setId, p_is_private: isPrivate })`, returns `{ ok } | { ok:false, error }`, revalidate the sets + progress paths.

### 5. UI

- **Create-set dialog** (`app/forge/sets/SetsIndex.tsx`): a "Private set" checkbox (default off) with helper copy — *"Only you and designers you add can see this set. Hidden from other elders."* Thread the boolean into `confirmCreate` → `createSet(name, isPrivate)`.
- **Import wizard** (`app/forge/import/ImportWizard.tsx`): the same "Private set" checkbox on the *create-new-destination-set* path (not shown when importing into an existing set). This is the real Tyler/Chris workflow — importing set 27 from a Lackey base plugin. Pass through to `createSet(name, isPrivate)`.
- **Badges**: a small "Private" badge (lock icon) on private set cards in `SetsIndex.tsx` and in the set header/breadcrumb area for `sets/[setId]`. Drive off the new `isPrivate` field. Follow existing badge styling (no new colors; reserve green per design conventions).
- **Progress tab** (`app/forge/sets/[setId]/progress/`): a privacy toggle placed with the existing Designers panel (`SetEldersPanel.tsx`), or a sibling `SetPrivacyPanel`. Shows current state and a **Make private / Make public** button gated on `canEdit` (role ∈ {elder,superadmin}), calling `setSetPrivacy`. Confirm dialog on **Make private** warns: *"Other elders will lose access to this set unless you add them as designers."* When private, copy clarifies the Designers list below is the access list.

### 6. Security & tests

- No new table → the anon-leak keystone test (`__tests__/forge-anon-leak.test.ts`) already asserts anon/non-member see zero rows on `forge_sets`/`forge_cards`/`card_versions`; private sets inherit this. Add `forge_set_privacy` and the re-signatured `forge_create_set(text, boolean)` to the `FORGE_RPCS` anon-cannot-execute probe list.
- **New correctness guarantee** (the point of the feature): a *member* elder who is **not** on a private set's roster must see zero rows for that set and its cards, while a roster elder and superadmin see it; `is_forge_set_elder(privateSetId)` returns `false` for the non-roster elder and `true` for a roster elder + superadmin. Verify with the signed-in Playwright/verify recipe (`.claude/skills/verify/SKILL.md`, two real member sessions), because SQL impersonation through the pooled MCP connection is known-flaky for top-level STABLE-function scalars.
- Keep `npm run build`, `npm test` (Forge pure + gate-first), and `FORGE_LEAK_TEST=1 npm run test:security` green.

### 7. Migration & housekeeping

- One migration file: `supabase/migrations/071_forge_private_sets.sql` containing §1–§3 (070 is taken by a concurrent `070_forge_playtester_comments.sql`). Header comment documents that its `is_forge_set_elder` redefinition supersedes the uncommitted prod migration `forge_elders_access_all_sets` (DB version `20260705221747`).
- Applying to prod is done by the user (or with explicit per-migration authorization) via the Supabase MCP — not autonomously.
- **Follow-up (non-blocking):** the orphaned `068_forge_elders_access_all_sets.sql` file was never committed; its numeric slot is now taken by `068_forge_invite_email_case_insensitive.sql`. Recreating it for an honest history is optional and left as a noted follow-up; migration 071 makes the repo's function body correct regardless.

## Out of scope

- No new role/enum. No change to playtester grants (`forge_set_grants` stays orthogonal — a granted playtester still only ever sees *approved* cards; granting into a private set is allowed and leaks nothing for an in-progress set with no approved cards).
- No per-card privacy (privacy is a set-level property; private sketches with `set_id IS NULL` are already owner-only).
- No bulk "make N sets private" action; per-set toggle only.
- Admin set-access matrix (`/forge/admin`) needs no change — its columns come from RLS-scoped `listSets()`, so private sets simply don't appear for elders who can't see them, and appear for superadmin.

## Success criteria

1. An elder can create a private set (via dialog and via import); it appears for them + superadmin, and **not** for other elders (grid, card pages, realtime, art).
2. A designer added to a private set gains full access; removing them revokes it.
3. `setSetPrivacy` flips visibility both ways; making public restores all-elder access.
4. Anon/non-member leak boundary unchanged (leak test green).
5. Build, unit, and security suites green; signed-in two-account smoke confirms the non-roster-elder-can't-see guarantee.
