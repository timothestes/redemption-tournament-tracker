# Forge Selective Release (per-card waves) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a forge superadmin promote a chosen subset of a set's cards to the public catalog (e.g. one promo at a time), keeping the set open for future cards unless explicitly closed.

**Architecture:** Selection lives entirely in the TS layer — `buildReport` scopes rows/blockers to a selected card-id list and returns a roster for the UI; `forge_promote_set` (migration 092) gains `p_close_set boolean default true` (close requires the release to cover every remaining card) plus an official-name consistency guard; the preflight UI adds a checkbox roster, a close-set toggle, and locks the set code/official name on follow-up waves. Everything downstream (images, overlay, verify, migrate) is already per-release and untouched.

**Tech Stack:** Next.js 15 server actions, Supabase (plpgsql SECURITY DEFINER RPCs), vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-forge-selective-release-design.md`

## Global Constraints

- Work in a dedicated worktree `../rtt-selective-release` (branch `feat/forge-selective-release` off `origin/main`), absolute paths only, never touch the main checkout; stage only your own files (never `git add -A`).
- `app/forge/lib/promote.ts` has `"use server"` — it may only export async functions as values. New pure helpers/types go in `app/forge/lib/releaseSelection.ts` (no directive).
- tsconfig has `strict: false` — narrow action results with `res.ok === false`, never `if (res.ok)/else` (existing PromoteClient pattern).
- Migration 092 must **drop the old `forge_promote_set(uuid, text, text, jsonb)` signature** before recreating (otherwise two overloads), copy the **091 body verbatim** as the base (redefine-from-latest rule), and re-issue revoke/grant for the new signature.
- Don't run `next build` (dev server may share `.next`); the type gate is `npx tsc --noEmit`.
- `npm run test:security` needs `.env.local`, which worktrees don't carry — copy it from the main checkout first.

---

### Task 1: Worktree + carry the docs

**Files:**
- Create: worktree `../rtt-selective-release` (branch `feat/forge-selective-release`)
- Copy in: `docs/superpowers/specs/2026-08-23-forge-selective-release-design.md`, `docs/superpowers/plans/2026-08-23-forge-selective-release.md`, `.env.local` (uncommitted)

**Interfaces:**
- Produces: the isolated workspace every later task runs in (absolute path `/Users/timestes/projects/rtt-selective-release`).

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/timestes/projects/redemption-tournament-tracker
git fetch origin
git worktree add ../rtt-selective-release -b feat/forge-selective-release origin/main
```

- [ ] **Step 2: Copy the uncommitted docs and env into the worktree**

```bash
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/specs/2026-08-23-forge-selective-release-design.md /Users/timestes/projects/rtt-selective-release/docs/superpowers/specs/
cp /Users/timestes/projects/redemption-tournament-tracker/docs/superpowers/plans/2026-08-23-forge-selective-release.md /Users/timestes/projects/rtt-selective-release/docs/superpowers/plans/
cp /Users/timestes/projects/redemption-tournament-tracker/.env.local /Users/timestes/projects/rtt-selective-release/.env.local
cd /Users/timestes/projects/rtt-selective-release && npm install
```

- [ ] **Step 3: Commit the docs**

```bash
cd /Users/timestes/projects/rtt-selective-release
git add docs/superpowers/specs/2026-08-23-forge-selective-release-design.md docs/superpowers/plans/2026-08-23-forge-selective-release.md
git commit -m "docs(forge): selective-release design spec + plan"
```

---

### Task 2: Pure selection helpers (`releaseSelection.ts`)

**Files:**
- Create: `app/forge/lib/releaseSelection.ts`
- Test: `__tests__/forge-release-selection.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 4 and 5):

```ts
export type RosterGroup = "approved" | "unapproved" | "promoted";
export type RosterEntry = { cardId: string; title: string; status: string; group: RosterGroup };
export type RosterCard = { id: string; title: string | null; status: string; approvedVersionId: string | null };

export function groupRoster(cards: RosterCard[]): RosterEntry[];
export function defaultSelection(roster: RosterEntry[]): string[];
export function isCloseEligible(roster: RosterEntry[], selectedIds: string[]): boolean;
export function sameSelection(a: string[], b: string[]): boolean;
```

- [ ] **Step 1: Write the failing test**

`__tests__/forge-release-selection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  groupRoster, defaultSelection, isCloseEligible, sameSelection,
  type RosterCard,
} from "@/app/forge/lib/releaseSelection";

const card = (id: string, status: string, approved = false): RosterCard => ({
  id, title: `Card ${id}`, status, approvedVersionId: approved ? `v-${id}` : null,
});

describe("groupRoster", () => {
  it("groups approved / unapproved / promoted and excludes archived", () => {
    const roster = groupRoster([
      card("a", "approved", true),
      card("b", "draft"),
      card("c", "playtesting"),
      card("d", "promoted"),
      card("e", "archived"),
    ]);
    expect(roster.map((r) => [r.cardId, r.group])).toEqual([
      ["a", "approved"], ["b", "unapproved"], ["c", "unapproved"], ["d", "promoted"],
    ]);
  });

  it("treats approved-without-version as unapproved (not selectable)", () => {
    const roster = groupRoster([card("a", "approved", false)]);
    expect(roster[0].group).toBe("unapproved");
  });

  it("falls back to Untitled for a null title", () => {
    const roster = groupRoster([{ id: "a", title: null, status: "draft", approvedVersionId: null }]);
    expect(roster[0].title).toBe("Untitled");
  });
});

describe("defaultSelection", () => {
  it("selects exactly the approved group", () => {
    const roster = groupRoster([card("a", "approved", true), card("b", "draft"), card("d", "promoted")]);
    expect(defaultSelection(roster)).toEqual(["a"]);
  });
});

describe("isCloseEligible", () => {
  const roster = groupRoster([
    card("a", "approved", true), card("b", "approved", true), card("d", "promoted"),
  ]);
  it("true when every non-promoted card is selected", () => {
    expect(isCloseEligible(roster, ["a", "b"])).toBe(true);
  });
  it("false on a partial selection", () => {
    expect(isCloseEligible(roster, ["a"])).toBe(false);
  });
  it("false whenever an unapproved card exists (it can never be selected)", () => {
    const withDraft = groupRoster([card("a", "approved", true), card("b", "draft")]);
    expect(isCloseEligible(withDraft, ["a"])).toBe(false);
  });
});

describe("sameSelection", () => {
  it("is order-insensitive and exact", () => {
    expect(sameSelection(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSelection(["a"], ["a", "b"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/timestes/projects/rtt-selective-release && npx vitest run forge-release-selection`
Expected: FAIL — module `app/forge/lib/releaseSelection` not found.

- [ ] **Step 3: Implement**

`app/forge/lib/releaseSelection.ts`:

```ts
// Pure selection logic for selective ("wave") releases. Lives outside
// promote.ts because that file's "use server" directive forbids non-async
// exports. Design: docs/superpowers/specs/2026-08-23-forge-selective-release-design.md

export type RosterGroup = "approved" | "unapproved" | "promoted";

export type RosterEntry = { cardId: string; title: string; status: string; group: RosterGroup };

export type RosterCard = {
  id: string;
  title: string | null;
  status: string;
  approvedVersionId: string | null;
};

// Archived cards are invisible to the release flow; promoted cards render for
// context only; approved-with-version cards are the selectable pool.
export function groupRoster(cards: RosterCard[]): RosterEntry[] {
  return cards
    .filter((c) => c.status !== "archived")
    .map((c) => ({
      cardId: c.id,
      title: (c.title ?? "").trim() || "Untitled",
      status: c.status,
      group:
        c.status === "promoted"
          ? ("promoted" as const)
          : c.status === "approved" && c.approvedVersionId
            ? ("approved" as const)
            : ("unapproved" as const),
    }));
}

export function defaultSelection(roster: RosterEntry[]): string[] {
  return roster.filter((r) => r.group === "approved").map((r) => r.cardId);
}

// A release may close the set only when it covers EVERY remaining releasable
// card — an unapproved card can never be selected, so its presence alone
// makes closing ineligible.
export function isCloseEligible(roster: RosterEntry[], selectedIds: string[]): boolean {
  const selected = new Set(selectedIds);
  const releasable = roster.filter((r) => r.group !== "promoted");
  return releasable.length > 0 && releasable.every((r) => selected.has(r.cardId));
}

export function sameSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((id) => bs.has(id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/timestes/projects/rtt-selective-release && npx vitest run forge-release-selection`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-selective-release
git add app/forge/lib/releaseSelection.ts __tests__/forge-release-selection.test.ts
git commit -m "feat(forge): pure roster/selection helpers for selective release"
```

---

### Task 3: Migration 092 — `p_close_set` + official-name consistency

**Files:**
- Create: `supabase/migrations/092_forge_selective_release.sql`

**Interfaces:**
- Produces: `public.forge_promote_set(p_set_id uuid, p_set_code text, p_official_set text, p_rows jsonb, p_close_set boolean default true) returns uuid` — consumed by Task 4's `promoteSet` and probed by Task 6.

- [ ] **Step 1: Write the migration**

The function body below is the **091 body verbatim** except the three commented `-- 092:` blocks. Full file:

```sql
-- 092_forge_selective_release.sql
-- Selective ("wave") releases: forge_promote_set gains p_close_set. A partial
-- release leaves the set open (new promo cards + future waves); closing
-- requires the release to cover every remaining releasable card. Also guards
-- official-name consistency across waves of the same set code.
-- Design: docs/superpowers/specs/2026-08-23-forge-selective-release-design.md
--
-- The old 4-arg signature is DROPPED first — create or replace with an added
-- parameter would otherwise leave two overloads. p_close_set defaults true so
-- the currently-deployed server action (which omits it) keeps the shipped
-- close-on-promote behavior until the app deploys.
--
-- SCHEMA + FUNCTIONS ONLY — no data.

drop function if exists public.forge_promote_set(uuid, text, text, jsonb);

create or replace function public.forge_promote_set(
  p_set_id uuid, p_set_code text, p_official_set text, p_rows jsonb,
  p_close_set boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_release_id uuid;
  v_row jsonb;
  v_card public.forge_cards%rowtype;
  v_card_id uuid; v_version_id uuid; v_name text; v_img text;
  v_count int;
  v_remaining int;
begin
  if not public.is_forge_superadmin() then
    raise exception 'only a forge superadmin may promote a set';
  end if;
  if btrim(coalesce(p_set_code, '')) = '' then raise exception 'set code required'; end if;
  if length(p_set_code) > 16 then raise exception 'set code too long'; end if;
  if p_set_code ~ '\(AB\)' then
    raise exception 'set code must not match the alternate-art (AB) pattern';
  end if;
  if btrim(coalesce(p_official_set, '')) = '' then raise exception 'official set name required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then raise exception 'row count out of range'; end if;

  perform 1 from public.forge_sets where id = p_set_id for update;
  if not found then raise exception 'set not found'; end if;

  -- A set code belongs to exactly one forge set across all releases (waves reuse it).
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_code = p_set_code and r.set_id <> p_set_id
  ) then
    raise exception 'set code % is already used by another released set', p_set_code;
  end if;
  -- 092: waves of one set code must never fork the catalog display name.
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_code = btrim(p_set_code)
      and r.official_set <> btrim(p_official_set)
  ) then
    raise exception 'set code % was already released as a different official set name', p_set_code;
  end if;
  -- One release in flight per set; waves start only after the previous release
  -- fully lands (or is aborted, which deletes its manifest).
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_id = p_set_id and r.status <> 'decks_migrated'
  ) then
    raise exception 'a release is already in progress for this set';
  end if;

  insert into public.forge_public_releases (set_id, set_code, official_set, card_count, created_by)
  values (p_set_id, btrim(p_set_code), btrim(p_official_set), v_count, auth.uid())
  returning id into v_release_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_card_id    := (v_row->>'card_id')::uuid;
    v_version_id := (v_row->>'version_id')::uuid;
    v_name       := btrim(coalesce(v_row->>'name', ''));
    v_img        := btrim(coalesce(v_row->>'img_file', ''));
    if v_name = '' then raise exception 'a row is missing its card name'; end if;
    if v_img  = '' then raise exception 'row % is missing its image file', v_name; end if;

    select * into v_card from public.forge_cards where id = v_card_id for update;
    if not found then raise exception 'card % not found', v_name; end if;
    if v_card.set_id is distinct from p_set_id then
      raise exception 'card % is not in this set', v_name;
    end if;
    if v_card.status <> 'approved' then
      raise exception 'card % is not approved', v_name;
    end if;
    if v_card.approved_version_id is distinct from v_version_id then
      raise exception 'card % approved version changed — re-run preflight', v_name;
    end if;
    if exists (select 1 from public.forge_public_release_cards c where c.card_id = v_card_id) then
      raise exception 'card % is already part of a release', v_name;
    end if;
    -- Global (set_code, name) uniqueness across all prior releases (waves included).
    if exists (
      select 1 from public.forge_public_release_cards c
      where c.set_code = btrim(p_set_code) and c.name = v_name
    ) then
      raise exception 'a card named % was already released under set code %', v_name, p_set_code;
    end if;

    insert into public.forge_public_release_cards (
      release_id, card_id, version_id, name, set_code, img_file, official_set,
      type, brigade, strength, toughness, class, identifier, special_ability,
      rarity, reference, alignment, legality
    ) values (
      v_release_id, v_card_id, v_version_id, v_name, btrim(p_set_code), v_img, btrim(p_official_set),
      coalesce(v_row->>'type',''), coalesce(v_row->>'brigade',''),
      coalesce(v_row->>'strength',''), coalesce(v_row->>'toughness',''),
      coalesce(v_row->>'class',''), coalesce(v_row->>'identifier',''),
      coalesce(v_row->>'special_ability',''), coalesce(v_row->>'rarity',''),
      coalesce(v_row->>'reference',''), coalesce(v_row->>'alignment',''),
      coalesce(v_row->>'legality','')
    );

    update public.forge_cards set status = 'promoted', updated_at = now()
     where id = v_card_id;
  end loop;

  -- 092: closing is explicit. A close must cover every remaining releasable
  -- card (selected cards were flipped 'promoted' above, so they no longer
  -- count as remaining). A partial release leaves forge_sets.status alone —
  -- the set keeps taking new cards and future waves.
  if p_close_set then
    select count(*) into v_remaining
      from public.forge_cards c
     where c.set_id = p_set_id and c.status not in ('archived', 'promoted');
    if v_remaining > 0 then
      raise exception 'cannot close the set: % card(s) remain unreleased', v_remaining;
    end if;
    update public.forge_sets set status = 'released', updated_at = now() where id = p_set_id;
  end if;

  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_promoted', p_set_id::text);

  return v_release_id;
end; $$;

-- Lock down EXECUTE on the new signature (anon stripped explicitly; cf. 048/091).
revoke execute on function public.forge_promote_set(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.forge_promote_set(uuid, text, text, jsonb, boolean) to authenticated;
```

- [ ] **Step 2: Sanity-check the diff against 091**

Run: `diff <(sed -n '107,209p' /Users/timestes/projects/rtt-selective-release/supabase/migrations/091_forge_promote_set.sql) <(sed -n '/^create or replace function public.forge_promote_set/,/^end; \$\$;/p' /Users/timestes/projects/rtt-selective-release/supabase/migrations/092_forge_selective_release.sql)`
Expected: differences ONLY at — the signature line (added `p_close_set`), the `v_remaining` declaration, the added official-name consistency block, and the `update public.forge_sets` line replaced by the `if p_close_set` block. Anything else means the 091 body wasn't copied verbatim — fix before proceeding.

- [ ] **Step 3: Commit**

```bash
cd /Users/timestes/projects/rtt-selective-release
git add supabase/migrations/092_forge_selective_release.sql
git commit -m "feat(forge): migration 092 — forge_promote_set p_close_set + wave name consistency"
```

(The migration is applied to the live DB in Task 7, after the suite passes locally.)

---

### Task 4: Server actions — selection-scoped preflight + promote

**Files:**
- Modify: `app/forge/lib/promote.ts` (buildReport ~lines 73-265, getPromoteReport ~267-273, promoteSet ~280-321)

**Interfaces:**
- Consumes: Task 2's `groupRoster`, `defaultSelection`, `isCloseEligible`, `RosterEntry`; Task 3's RPC signature.
- Produces (consumed by Task 5):

```ts
export type PromoteReport = {
  setName: string;
  setStatus: string;
  roster: RosterEntry[];          // NEW
  selectedCardIds: string[];      // NEW — the selection this report was built for
  totalReleasable: number;        // NEW — non-archived, non-promoted count
  closeEligible: boolean;         // NEW
  eligibleCount: number;          // rows.length, as before
  excludedArchived: number;
  excludedPromoted: number;
  blockers: PromoteIssue[];
  warnings: PromoteIssue[];
  rows: PromotePreviewRow[];
};
getPromoteReport(setId, setCode, officialSet, selectedCardIds?: string[]): Promise<PromoteReport | null>
promoteSet(setId, setCode, officialSet, selectedCardIds: string[] | undefined, closeSet: boolean): Promise<{ok:true; releaseId:string} | {ok:false; error:string}>
```

- [ ] **Step 1: Add imports and extend the report type**

In `app/forge/lib/promote.ts` add to the imports:

```ts
import {
  groupRoster, defaultSelection, isCloseEligible, type RosterEntry,
} from "@/app/forge/lib/releaseSelection";
```

Replace the `PromoteReport` type with the shape in **Interfaces** above (keep `PromoteIssue` / `PromotePreviewRow` as-is).

- [ ] **Step 2: Scope buildReport to a selection**

Change the signature:

```ts
async function buildReport(
  ctx: Ctx, setId: string, setCode: string, officialSet: string,
  selectedCardIds?: string[],
): Promise<PromoteReport | null> {
```

Replace the block from `const all = cards ?? [];` through the original `const approved = releasable.filter((c: any) => c.status === "approved" && c.approved_version_id);` line inclusive (i.e. the excluded counters, the `releasable` definition, the `not_approved` sweep, and the old `approved` definition) with:

```ts
  const all = cards ?? [];
  const excludedArchived = all.filter((c: any) => c.status === "archived").length;
  const excludedPromoted = all.filter((c: any) => c.status === "promoted").length;

  const roster = groupRoster(
    all.map((c: any) => ({
      id: c.id as string,
      title: (c.title as string | null) ?? null,
      status: c.status as string,
      approvedVersionId: (c.approved_version_id as string | null) ?? null,
    })),
  );
  const selection = selectedCardIds ?? defaultSelection(roster);
  const selectedSet = new Set(selection);
  const totalReleasable = roster.filter((r) => r.group !== "promoted").length;

  // Only SELECTED cards are validated and released; an unapproved card in the
  // set is simply not part of this wave (never a blocker unless selected).
  const byId = new Map(all.map((c: any) => [c.id as string, c]));
  for (const id of selection) {
    const c: any = byId.get(id);
    if (!c || c.status === "archived" || c.status === "promoted") {
      blockers.push({
        code: "not_releasable", cardId: id,
        message: "A selected card is no longer releasable — refresh and re-select.",
      });
    } else if (c.status !== "approved" || !c.approved_version_id) {
      blockers.push({
        code: "not_approved", cardId: c.id,
        message: `"${c.title ?? "Untitled"}" is ${c.status} — a card must be marked final to be released.`,
      });
    }
  }

  const approved = all.filter(
    (c: any) => selectedSet.has(c.id) && c.status === "approved" && c.approved_version_id,
  );
```

Everything downstream of the versions query already iterates `approved`, so rows, per-card checks, and warnings are now selection-scoped with no further change.

- [ ] **Step 3: Add the wave-identity blocker**

Immediately after the existing `release_in_flight` check (which uses the `prior` array), add:

```ts
  // Waves must keep the identity of the set's earlier releases (§3.3).
  const priorForSet = prior.find((r: any) => r.set_id === setId);
  if (priorForSet && (priorForSet.set_code !== code || priorForSet.official_set !== official)) {
    blockers.push({
      code: "wave_identity_mismatch",
      message: `This set already released as "${priorForSet.official_set}" (${priorForSet.set_code}) — follow-up waves must keep that identity.`,
    });
  }
```

- [ ] **Step 4: Return the new report fields**

Replace the return object with:

```ts
  return {
    setName: set.name,
    setStatus: set.status,
    roster,
    selectedCardIds: selection,
    totalReleasable,
    closeEligible: blockers.length === 0 && isCloseEligible(roster, selection),
    eligibleCount: rows.length,
    excludedArchived,
    excludedPromoted,
    blockers,
    warnings,
    rows,
  };
```

- [ ] **Step 5: Thread selection through the exported actions**

```ts
export async function getPromoteReport(
  setId: string, setCode: string, officialSet: string, selectedCardIds?: string[],
): Promise<PromoteReport | null> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return null;
  return buildReport(ctx, setId, setCode, officialSet, selectedCardIds);
}
```

In `promoteSet`, change the signature and the report/RPC calls:

```ts
export async function promoteSet(
  setId: string, setCode: string, officialSet: string,
  selectedCardIds: string[] | undefined, closeSet: boolean,
): Promise<{ ok: true; releaseId: string } | { ok: false; error: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const report = await buildReport(ctx, setId, setCode, officialSet, selectedCardIds);
  if (!report) return { ok: false, error: "Set not found" };
  if (report.blockers.length > 0) {
    return { ok: false, error: `Preflight has ${report.blockers.length} blocker(s) — refresh the report.` };
  }
  if (closeSet && !report.closeEligible) {
    return { ok: false, error: "Cannot close the set — this release does not cover every remaining card." };
  }
```

…and in the `.rpc("forge_promote_set", …)` call add `p_close_set: closeSet,` after `p_rows: rows,`.

- [ ] **Step 6: Type gate**

Run: `cd /Users/timestes/projects/rtt-selective-release && npx tsc --noEmit`
Expected: errors ONLY in `PromoteClient.tsx` (call sites updated in Task 5: `getPromoteReport` still called with 3 args is fine — the 4th is optional — but `promoteSet` now needs 5). If `promote.ts` itself errors, fix before proceeding.

- [ ] **Step 7: Commit**

```bash
cd /Users/timestes/projects/rtt-selective-release
git add app/forge/lib/promote.ts
git commit -m "feat(forge): selection-scoped promote preflight + closeSet threading"
```

---

### Task 5: Preflight UI — roster checkboxes, close toggle, identity lock

**Files:**
- Modify: `app/forge/sets/[setId]/promote/PromoteClient.tsx` (PromoteClient ~lines 24-63, PreflightSection ~127-295)
- Modify: `app/forge/sets/[setId]/promote/page.tsx` (pass `setStatus`)

**Interfaces:**
- Consumes: Task 4's `PromoteReport` fields + `promoteSet(setId, setCode, officialSet, selectedCardIds, closeSet)`; Task 2's `sameSelection` + `RosterEntry`.

- [ ] **Step 1: Thread `setStatus` and the identity lock**

`page.tsx`: pass `setStatus={set.status}` to `<PromoteClient>`.

`PromoteClient.tsx`: add `setStatus: string` to `Props`; pass through to `PreflightSection` along with `identityLocked={done}` (preflight renders only when there is no release at all — no priors possible — or when `done && newWave`, where the identity must match the finished release):

```tsx
        <PreflightSection
          setId={setId}
          setName={setName}
          setStatus={setStatus}
          identityLocked={done}
          defaultSetCode={done ? release!.setCode : ""}
          defaultOfficialSet={done ? release!.officialSet : setName}
          onPromoted={refresh}
        />
```

Add the import: `import { sameSelection, type RosterEntry } from "@/app/forge/lib/releaseSelection";`

- [ ] **Step 2: Selection + close state in PreflightSection**

New props: `setStatus: string; identityLocked: boolean`. New state:

```tsx
  const [selected, setSelected] = useState<string[] | null>(null); // null → server default
  const [closeSet, setCloseSet] = useState(false);
```

`runPreflight` passes the selection and adopts the report's echo:

```tsx
      const r = await getPromoteReport(setId, setCode, officialSet, selected ?? undefined);
      setReport(r);
      if (!r) setError("Could not read the set.");
      else {
        setSelected(r.selectedCardIds);
        setCloseSet(r.closeEligible && setStatus !== "released");
      }
```

Staleness + readiness (replace `const ready = …`):

```tsx
  const dirty =
    report !== null && selected !== null && !sameSelection(selected, report.selectedCardIds);
  const ready = report !== null && report.blockers.length === 0 && !dirty;
```

When `identityLocked`, render both identity inputs with `readOnly disabled` and `className={… + " opacity-70"}`, and swap the helper copy to: *"Locked to this set's earlier release — waves keep one catalog identity."*

- [ ] **Step 3: Roster panel**

Inside the report panel (after the excluded-counts paragraph, before the issues), render the roster; toggling only marks the report stale — the re-run recomputes everything:

```tsx
          <div className="mt-3 space-y-1">
            {report.roster.map((r) => {
              const isSel = (selected ?? report.selectedCardIds).includes(r.cardId);
              return (
                <label key={r.cardId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={r.group === "approved" ? isSel : false}
                    disabled={r.group !== "approved" || busy}
                    onChange={() => {
                      const cur = selected ?? report.selectedCardIds;
                      setSelected(isSel ? cur.filter((id) => id !== r.cardId) : [...cur, r.cardId]);
                    }}
                  />
                  <span className={r.group === "approved" ? "" : "text-muted-foreground"}>{r.title}</span>
                  {r.group === "unapproved" && (
                    <span className="text-xs text-muted-foreground">not final — can’t be included</span>
                  )}
                  {r.group === "promoted" && (
                    <span className="text-xs text-muted-foreground">already released</span>
                  )}
                </label>
              );
            })}
            <button
              type="button" className={`${btn} mt-1`} disabled={busy}
              onClick={() =>
                setSelected(report.roster.filter((r) => r.group === "approved").map((r) => r.cardId))
              }
            >
              Select all final cards
            </button>
            {dirty && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Selection changed — run preflight again to refresh the report.
              </p>
            )}
          </div>
```

- [ ] **Step 4: Close-set toggle + confirm copy**

Inside the red promote panel (`{ready && …}`), before the confirm input row, add:

```tsx
          <p className="mt-2 text-sm">
            Releasing <span className="font-semibold">{report.selectedCardIds.length}</span> of{" "}
            <span className="font-semibold">{report.totalReleasable}</span> remaining card
            {report.totalReleasable === 1 ? "" : "s"}.
          </p>
          {setStatus !== "released" && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={closeSet}
                disabled={!report.closeEligible || busy}
                onChange={(e) => setCloseSet(e.target.checked)}
              />
              Close the set after this release (no new cards)
              {!report.closeEligible && (
                <span className="text-xs text-muted-foreground">
                  — {report.totalReleasable - report.selectedCardIds.length} card(s) not in this release; the set stays open
                </span>
              )}
            </label>
          )}
```

Update the promote handler call: `await promoteSet(setId, setCode, officialSet, selected ?? undefined, closeSet)` (keep the `res.ok === false` narrowing). Update the button label to `Promote ${report.selectedCardIds.length} card${report.selectedCardIds.length === 1 ? "" : "s"}`.

- [ ] **Step 5: Type gate + unit tests**

Run: `cd /Users/timestes/projects/rtt-selective-release && npx tsc --noEmit && npm test`
Expected: tsc clean; vitest suite passes (anon-leak specs skip without `FORGE_LEAK_TEST=1`).

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-selective-release
git add app/forge/sets/\[setId\]/promote/PromoteClient.tsx app/forge/sets/\[setId\]/promote/page.tsx
git commit -m "feat(forge): roster selection + close-set toggle + wave identity lock in promote UI"
```

---

### Task 6: Anon-leak probe for the new signature

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts:98`

**Interfaces:**
- Consumes: Task 3's RPC signature. (Assertion is only `error not null`, so this passes before AND after the migration is applied — no ordering hazard.)

- [ ] **Step 1: Update the probe args**

Change line 98 to:

```ts
    ["forge_promote_set", { p_set_id: "00000000-0000-0000-0000-000000000000", p_set_code: "X", p_official_set: "X", p_rows: [], p_close_set: true }],
```

- [ ] **Step 2: Commit**

```bash
cd /Users/timestes/projects/rtt-selective-release
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): probe forge_promote_set with p_close_set"
```

---

### Task 7: Apply migration 092, run the security suite, open the PR

**Files:**
- None new — live-DB apply + verification + PR.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Apply migration 092 to the live project**

Via Supabase MCP `apply_migration` with name `092_forge_selective_release` and the exact contents of the file. Safe pre-merge: `p_close_set default true` makes the currently-deployed action behave exactly as shipped (its promotes always cover every remaining card — old preflight blocks otherwise — so the close check passes).

- [ ] **Step 2: Run the security suite from the worktree**

Run: `cd /Users/timestes/projects/rtt-selective-release && npm run test:security`
Expected: PASS (needs the `.env.local` copied in Task 1).

- [ ] **Step 3: Full local gate**

Run: `cd /Users/timestes/projects/rtt-selective-release && npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 4: Push and open the PR**

```bash
cd /Users/timestes/projects/rtt-selective-release
git push -u origin feat/forge-selective-release
gh pr create --base main --title "feat(forge): selective releases — promote chosen cards, keep the set open" --body "$(cat <<'EOF'
## Summary
- Promote a chosen subset of a set's cards (checkbox roster in preflight); drafts no longer block a wave
- Closing the set is explicit: only a release covering every remaining card may close it — partial releases leave the set open for future promos/waves (migration 092: `p_close_set`, applied to live DB)
- Wave identity locked: set code + official name can't fork across waves (UI lock, preflight blocker, RPC guard)
- Design: docs/superpowers/specs/2026-08-23-forge-selective-release-design.md

## Test plan
- [x] `npx tsc --noEmit`
- [x] `npm test` (new forge-release-selection unit tests)
- [x] `npm run test:security` (updated forge_promote_set probe)
- [ ] Post-deploy: two-card test set — release card 1 (toggle off) → set stays open, card 2 editable → release card 2 (toggle on) → set flips released

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Clean up the worktree** (after the PR is up; the branch lives on the remote)

```bash
cd /Users/timestes/projects/redemption-tournament-tracker
git worktree remove ../rtt-selective-release
```
