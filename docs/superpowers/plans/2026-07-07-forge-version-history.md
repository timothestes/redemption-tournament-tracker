# Forge Version History, Set Changelog & Complete Reasons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-card version-history timeline (who/what/when/why), a set-level "updated since <date>" filter, and first-class reasons on every release path — per the approved spec `docs/superpowers/specs/2026-07-06-forge-version-history-design.md`.

**Architecture:** One migration (072) makes the underivable data durable (version notes stamped atomically, lifecycle audit events, undeletable proposal reasons); everything else is read-only over existing tables: new server-action readers (`versions.ts`), pure merge/derivation helpers (`historyView.ts`), a `CardHistory` timeline in the studio's ReviewPanel, era dividers in the comment thread, and a client-side date filter on the set cards page.

**Tech Stack:** Next.js 15 App Router server actions, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), vitest, Tailwind/shadcn.

## Global Constraints

- `tsconfig` has `strict: false`: union narrowing via `if (r.ok)`/`else` DOES NOT WORK. Always write `if (r.ok === false)`. (Established project gotcha.)
- All DB writes go through SECURITY DEFINER RPCs; never write tables directly from server actions.
- Server actions: files start with `"use server"`; gate reads with `requireForge()`, elder writes with `requireElder()` from `@/app/forge/lib/auth`.
- Never use `focus:ring-2` / `focus:ring-ring` on form controls. Reserve the primary green for hover/active/CTAs.
- In JSX copy use typographic apostrophes (`’`) like the surrounding code.
- Migration file MUST be numbered `072` (063–071 are taken). Deploy order: migration applies before the client change ships (Task 7 handles application; Tasks 2+ may merge only after 072 is applied).
- Run unit tests with `npx vitest run <file>`; typecheck with `npx tsc --noEmit` (10 pre-existing errors in `app/forge/lib/__tests__/playDecksAuthorize.test.ts` are NOT yours — ignore them; any other error is yours).
- Work on branch `forge-version-history`. Commit after each task with the message given in the task.

---

### Task 1: Migration 072

**Files:**
- Create: `supabase/migrations/072_forge_version_history.sql`

**Interfaces:**
- Produces: `card_versions.note text` column; `forge_publish_card(p_card_id uuid, p_note text default null)`; `forge_audit` rows with actions `card_approved | card_unapproved | card_archived | card_unarchived | card_returned_to_ideas`; `forge_delete_comment` refusing proposal-anchored comments.

This task is SQL-only; it is verified by application to the live project in Task 7. Bodies below are verbatim copies of the current live definitions (from migrations 052/053/061) with the marked additions — do not "improve" anything else in them.

- [ ] **Step 1: Write the migration file**

Write `supabase/migrations/072_forge_version_history.sql` with exactly this content:

```sql
-- 072: Forge version history — version notes, lifecycle audit events,
-- undeletable proposal reasons.
-- (1) card_versions.note: the "why" of a release, stamped atomically.
-- (2) forge_publish_card gains p_note. SIGNATURE CHANGE: the old 1-arg
--     function must be DROPPED first — CREATE OR REPLACE would create an
--     overload and PostgREST rpc() calls would fail with PGRST203 ambiguity.
--     Dropping loses grants: re-revoke/re-grant explicitly (cf. 048/052).
-- (3) Five lifecycle RPCs gain a one-line forge_audit insert (pattern:
--     forge_delete_card in 052) — approve/unapprove/archive/unarchive/return
--     flip or destroy state that is otherwise unrecoverable.
-- (4) forge_delete_comment refuses proposal-anchored comments: deny reasons
--     and accept notes are records, not chatter.

-- 1) Version note column
alter table public.card_versions add column if not exists note text;

-- 2) forge_publish_card with p_note (body = 061 verbatim + note)
drop function if exists public.forge_publish_card(uuid);

create or replace function public.forge_publish_card(p_card_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_next int; v_version_id uuid;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to publish this card';
  end if;
  if v_card.set_id is null then raise exception 'only cards in a set can be published'; end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'only a draft or playtesting card can be published';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = p_card_id;
  update public.card_versions set status = 'superseded'
    where card_id = p_card_id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by, note)
  values
    (p_card_id, v_next, 'published', v_card.working_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id, status = 'playtesting', updated_at = now()
   where id = p_card_id;
  return v_version_id;
end; $$;

revoke execute on function public.forge_publish_card(uuid, text) from public, anon;
grant execute on function public.forge_publish_card(uuid, text) to authenticated;

-- 3) Lifecycle audit events (bodies = 052 verbatim + one insert each;
--    same signatures, so CREATE OR REPLACE preserves existing grants)

create or replace function public.forge_approve_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to approve this card';
  end if;
  if v_card.status <> 'playtesting' or v_card.published_version_id is null then
    raise exception 'only a playtesting card with a published version can be approved';
  end if;
  update public.card_versions set status = 'approved' where id = v_card.published_version_id;
  update public.forge_cards
     set approved_version_id = published_version_id, status = 'approved', updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_approved', p_card_id::text);
end; $$;

create or replace function public.forge_unapprove_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status <> 'approved' then raise exception 'card is not approved'; end if;
  update public.card_versions set status = 'published' where id = v_card.approved_version_id;
  update public.forge_cards
     set approved_version_id = null, status = 'playtesting', updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_unapproved', p_card_id::text);
end; $$;

create or replace function public.forge_archive_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status not in ('draft','playtesting','approved') then
    raise exception 'card cannot be archived from its current state';
  end if;
  update public.card_versions set status = 'superseded'
   where card_id = p_card_id and status <> 'superseded';
  update public.forge_cards
     set status = 'archived', published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_archived', p_card_id::text);
end; $$;

create or replace function public.forge_unarchive_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status <> 'archived' then raise exception 'card is not archived'; end if;
  update public.forge_cards set status = 'draft', updated_at = now() where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_unarchived', p_card_id::text);
end; $$;

create or replace function public.forge_send_card_to_private(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.set_id is null then raise exception 'card is not in a set'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or public.is_forge_set_elder(v_card.set_id)) then
    raise exception 'not authorized';
  end if;
  update public.card_versions set status = 'superseded'
   where card_id = p_card_id and status <> 'superseded';
  update public.forge_cards
     set set_id = null, status = 'private_idea',
         published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_returned_to_ideas', p_card_id::text);
end; $$;

-- 4) Proposal-anchored comments are records of decisions — not deletable
--    (body = 053 verbatim + the proposal_id guard)
create or replace function public.forge_delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  if v_c.proposal_id is not null then
    raise exception 'comments attached to a proposal are part of its history and cannot be deleted';
  end if;
  select * into v_card from public.forge_cards where id = v_c.card_id;
  if not (v_c.created_by = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  delete from public.card_comments where id = p_comment_id;
end; $$;
```

- [ ] **Step 2: Sanity-check the file**

Run: `grep -c "create or replace function" supabase/migrations/072_forge_version_history.sql`
Expected: `7`

Run: `grep -n "drop function" supabase/migrations/072_forge_version_history.sql`
Expected: exactly one line, dropping `public.forge_publish_card(uuid)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/072_forge_version_history.sql
git commit -m "feat(forge): migration 072 — version notes, lifecycle audit events, undeletable proposal reasons"
```

---

### Task 2: Atomic release note (`publish(cardId, note?)`)

**Files:**
- Modify: `app/forge/lib/lifecycle.ts` (the `publish` function, ~line 25)
- Modify: `app/forge/cards/[cardId]/LifecycleControls.tsx` (`doRelease`, ~line 47; imports ~line 6-7)
- Test: `app/forge/lib/__tests__/lifecycle.test.ts`

**Interfaces:**
- Consumes: `forge_publish_card(p_card_id, p_note)` from Task 1.
- Produces: `publish(cardId: string, note?: string): Promise<{ ok: boolean; error?: string }>` — Tasks 5/6 do not depend on this, but the UI release dialog does.

- [ ] **Step 1: Update the existing test and add the note test**

In `app/forge/lib/__tests__/lifecycle.test.ts`, replace the `"publish calls forge_publish_card"` test with:

```ts
  it("publish calls forge_publish_card with a null note by default", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await publish("c1");
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_publish_card", { p_card_id: "c1", p_note: null }]);
  });
  it("publish passes a trimmed note and blanks become null", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await publish("c1", "  fixed toughness typo  ");
    expect((c.supabase.rpc as any).mock.calls[0][1]).toEqual({ p_card_id: "c1", p_note: "fixed toughness typo" });
    await publish("c2", "   ");
    expect((c.supabase.rpc as any).mock.calls[1][1]).toEqual({ p_card_id: "c2", p_note: null });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run app/forge/lib/__tests__/lifecycle.test.ts`
Expected: FAIL — the calls carry no `p_note` key.

- [ ] **Step 3: Implement**

In `app/forge/lib/lifecycle.ts`, replace the `publish` function:

```ts
export async function publish(cardId: string, note?: string): Promise<Result> {
  return call(
    "forge_publish_card",
    { p_card_id: cardId, p_note: note?.trim() || null },
    "Could not release card",
  );
}
```

(Bulk release in `BULK_RPC` calls `supabase.rpc(fn, { p_card_id: id })` directly — the SQL default covers it; do not change it.)

In `app/forge/cards/[cardId]/LifecycleControls.tsx`:
1. Delete the line `import { addComment } from "@/app/forge/lib/comments";`
2. Replace `doRelease` (and its stale comment about the comment thread) with:

```ts
  // Release freezes a new version; the optional note is stamped on the version
  // row inside the same transaction (migration 072).
  const doRelease = () =>
    start(async () => {
      const r = await publish(card.id, releaseNote);
      if (r.ok === false) { alert(r.error ?? "Could not release card"); return; }
      setReleaseOpen(false);
      setReleaseNote("");
      router.refresh();
    });
```

3. In the release dialog, change the textarea `placeholder` from `"Recorded in the card’s comments…"` to `"Shown in the card’s history…"`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run app/forge/lib/__tests__/lifecycle.test.ts` — Expected: PASS (all).
Run: `npx tsc --noEmit` — Expected: only the 10 pre-existing `playDecksAuthorize.test.ts` errors.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/lifecycle.ts "app/forge/cards/[cardId]/LifecycleControls.tsx" app/forge/lib/__tests__/lifecycle.test.ts
git commit -m "feat(forge): release notes stamped atomically on the version row"
```

---

### Task 3: Data readers (`versions.ts`) + proposal columns

**Files:**
- Create: `app/forge/lib/versions.ts`
- Modify: `app/forge/lib/proposals.ts` (`COLS` ~line 24, `ProposalRow` type ~line 10, `toProposal` ~line 27)
- Test: `app/forge/lib/__tests__/versions.test.ts` (create)

**Interfaces:**
- Produces (consumed by Tasks 4/5/6):

```ts
export type VersionRow = {
  id: string; versionNumber: number; status: "published" | "approved" | "superseded";
  data: DesignCard; note: string | null; createdBy: string; createdAt: string; authorName: string | null;
};
export type CardEventRow = { id: number; action: string; actor: string; actorName: string | null; at: string };
export type ReleaseInfo = { versionNumber: number; releasedAt: string };
export async function listVersions(cardId: string): Promise<VersionRow[]>            // newest first
export async function listCardEvents(cardId: string): Promise<CardEventRow[]>       // oldest first
export async function listSetActivity(cardIds: string[]): Promise<Record<string, ReleaseInfo>> // latest release per card
```
- Produces on `ProposalRow`: `resultingVersionId: string | null; closedBy: string | null;`

Note: the spec names `listSetActivity(setId, sinceISO)`; the implementation takes `cardIds` and returns every card's latest release, with the date cutoff applied client-side — this matches the established reader pattern (`listUnresolvedCommentCounts` / `listOpenProposalCounts` on the same page) and keeps the filter interactive without refetching. Same §6 outcome.

- [ ] **Step 1: Write failing tests**

Create `app/forge/lib/__tests__/versions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));

import { requireForge } from "@/app/forge/lib/auth";
import { listVersions, listCardEvents, listSetActivity } from "../versions";

// Chainable query stub: every method returns the builder; awaiting it yields
// the row payload for its table (thenable, like the supabase-js builder).
function table(rows: any[]) {
  const b: any = {};
  for (const m of ["select", "eq", "in", "is", "order"]) b[m] = vi.fn(() => b);
  b.then = (res: any) => Promise.resolve({ data: rows, error: null }).then(res);
  return b;
}
function ctxWith(tables: Record<string, any[]>) {
  return {
    role: "elder", user: { id: "u1" },
    supabase: { from: vi.fn((name: string) => table(tables[name] ?? [])) },
  };
}
beforeEach(() => vi.clearAllMocks());

describe("listVersions", () => {
  it("returns [] for a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await listVersions("c1")).toEqual([]);
  });
  it("maps rows and resolves author names", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({
      card_versions: [{
        id: "v2", card_id: "c1", version_number: 2, status: "published",
        data: { name: "Goliath" }, note: "buffed", created_by: "u9",
        created_at: "2026-07-02T00:00:00Z",
      }],
      playtest_members: [{ user_id: "u9", display_name: "Tim" }],
    }));
    const rows = await listVersions("c1");
    expect(rows).toEqual([{
      id: "v2", versionNumber: 2, status: "published", data: { name: "Goliath" },
      note: "buffed", createdBy: "u9", createdAt: "2026-07-02T00:00:00Z", authorName: "Tim",
    }]);
  });
});

describe("listCardEvents", () => {
  it("maps audit rows with actor names", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({
      forge_audit: [{ id: 7, actor: "u9", action: "card_approved", target: "c1", at: "2026-07-03T00:00:00Z" }],
      playtest_members: [{ user_id: "u9", display_name: "Tim" }],
    }));
    expect(await listCardEvents("c1")).toEqual([
      { id: 7, action: "card_approved", actor: "u9", actorName: "Tim", at: "2026-07-03T00:00:00Z" },
    ]);
  });
});

describe("listSetActivity", () => {
  it("returns {} for no ids without querying", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({}));
    expect(await listSetActivity([])).toEqual({});
  });
  it("keeps only the latest release per card", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({
      card_versions: [
        { card_id: "c1", version_number: 3, created_at: "2026-07-05T00:00:00Z" },
        { card_id: "c1", version_number: 2, created_at: "2026-07-01T00:00:00Z" },
        { card_id: "c2", version_number: 1, created_at: "2026-06-20T00:00:00Z" },
      ],
    }));
    expect(await listSetActivity(["c1", "c2"])).toEqual({
      c1: { versionNumber: 3, releasedAt: "2026-07-05T00:00:00Z" },
      c2: { versionNumber: 1, releasedAt: "2026-06-20T00:00:00Z" },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/versions.test.ts`
Expected: FAIL — `../versions` does not exist.

- [ ] **Step 3: Implement `app/forge/lib/versions.ts`**

```ts
"use server";

import { requireForge } from "@/app/forge/lib/auth";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type VersionRow = {
  id: string;
  versionNumber: number;
  status: "published" | "approved" | "superseded";
  data: DesignCard;
  note: string | null;
  createdBy: string;
  createdAt: string;
  authorName: string | null;
};

export type CardEventRow = {
  id: number;
  action: string;
  actor: string;
  actorName: string | null;
  at: string;
};

export type ReleaseInfo = { versionNumber: number; releasedAt: string };

// The lifecycle actions written by migration 072 (see forge_audit inserts).
const CARD_EVENT_ACTIONS = [
  "card_approved",
  "card_unapproved",
  "card_archived",
  "card_unarchived",
  "card_returned_to_ideas",
];

// Resolve user UUIDs -> display names (member-readable). Same pattern as comments.ts.
async function nameMap(
  ctx: NonNullable<Awaited<ReturnType<typeof requireForge>>>,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, display_name")
    .in("user_id", [...new Set(ids)]);
  return new Map((data ?? []).map((m: any) => [m.user_id, m.display_name]));
}

// Full release history for a card, newest first. Elder/owner RLS applies;
// playtesters see only approved rows (and never reach the studio anyway).
export async function listVersions(cardId: string): Promise<VersionRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_versions")
    .select("id, card_id, version_number, status, data, note, created_by, created_at")
    .eq("card_id", cardId)
    .order("version_number", { ascending: false });
  const rows = data ?? [];
  const names = await nameMap(ctx, rows.map((r: any) => r.created_by));
  return rows.map((r: any) => ({
    id: r.id,
    versionNumber: r.version_number,
    status: r.status,
    data: (r.data ?? {}) as DesignCard,
    note: r.note ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    authorName: names.get(r.created_by) ?? "Forge member",
  }));
}

// Lifecycle events (post-072 only), oldest first. forge_audit is elder-read
// RLS-gated; non-elders simply get [].
export async function listCardEvents(cardId: string): Promise<CardEventRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_audit")
    .select("id, actor, action, target, at")
    .eq("target", cardId)
    .in("action", CARD_EVENT_ACTIONS)
    .order("at", { ascending: true });
  const rows = data ?? [];
  const names = await nameMap(ctx, rows.map((r: any) => r.actor));
  return rows.map((r: any) => ({
    id: r.id,
    action: r.action,
    actor: r.actor,
    actorName: names.get(r.actor) ?? "Forge member",
    at: r.at,
  }));
}

// Latest release per card for a set's grid — mirrors listOpenProposalCounts:
// takes cardIds, runs under the caller's RLS, returns a compact record.
export async function listSetActivity(
  cardIds: string[]
): Promise<Record<string, ReleaseInfo>> {
  const ctx = await requireForge();
  if (!ctx || cardIds.length === 0) return {};
  const { data } = await ctx.supabase
    .from("card_versions")
    .select("card_id, version_number, created_at")
    .in("card_id", cardIds)
    .order("created_at", { ascending: false });
  const out: Record<string, ReleaseInfo> = {};
  for (const r of data ?? []) {
    const id = (r as any).card_id as string;
    if (!out[id]) out[id] = { versionNumber: (r as any).version_number, releasedAt: (r as any).created_at };
  }
  return out;
}
```

- [ ] **Step 4: Add the two proposal columns**

In `app/forge/lib/proposals.ts`:
1. `ProposalRow`: after `baseVersionId: string | null;` add:

```ts
  resultingVersionId: string | null;
  closedBy: string | null;
```

2. `COLS`: replace with:

```ts
const COLS =
  "id, card_id, base_version_id, resulting_version_id, summary, status, proposed_snapshot, created_by, created_at, closed_at, closed_by";
```

3. `toProposal`: after the `baseVersionId` line add:

```ts
    resultingVersionId: row.resulting_version_id ?? null,
    closedBy: row.closed_by ?? null,
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run app/forge/lib/__tests__/versions.test.ts` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: only the 10 pre-existing errors.

- [ ] **Step 6: Commit**

```bash
git add app/forge/lib/versions.ts app/forge/lib/proposals.ts app/forge/lib/__tests__/versions.test.ts
git commit -m "feat(forge): version/event/set-activity readers + proposal closure columns"
```

---

### Task 4: Pure history helpers (`historyView.ts`)

**Files:**
- Create: `app/forge/lib/historyView.ts` (pure, isomorphic — NO `"use server"`)
- Test: `app/forge/lib/__tests__/historyView.test.ts` (create)

**Interfaces:**
- Consumes: `VersionRow`, `CardEventRow` (Task 3), `ProposalRow` (Task 3 shape), `CommentRow` (`comments.ts`), `diffCards`/`FieldChange` (`cardDiff.ts`).
- Produces (consumed by Task 5):

```ts
export type HistoryEvent =
  | { kind: "version"; at: string; version: VersionRow; changes: FieldChange[] }
  | { kind: "proposal"; at: string; proposal: ProposalRow; reasons: CommentRow[]; supersededBy: string | null; resultingVersionNumber: number | null }
  | { kind: "lifecycle"; at: string; event: CardEventRow };
export const EVENT_LABEL: Record<string, string>;
export function deriveSupersededBy(p: ProposalRow, all: ProposalRow[]): string | null;
export function buildHistory(versions: VersionRow[], proposals: ProposalRow[], events: CardEventRow[], comments: CommentRow[]): HistoryEvent[];
export type CommentEraItem = { kind: "comment"; comment: CommentRow } | { kind: "era"; versionNumber: number; at: string };
export function buildCommentEras(topComments: CommentRow[], versions: Pick<VersionRow, "versionNumber" | "createdAt">[]): CommentEraItem[];
```

- [ ] **Step 1: Write failing tests**

Create `app/forge/lib/__tests__/historyView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveSupersededBy, buildHistory, buildCommentEras, EVENT_LABEL } from "../historyView";

const prop = (over: any) => ({
  id: "p1", cardId: "c1", baseVersionId: null, resultingVersionId: null, summary: "s",
  status: "open", proposedSnapshot: {}, createdBy: "u1", createdAt: "2026-07-01T00:00:00Z",
  closedAt: null, closedBy: null, ...over,
});
const ver = (over: any) => ({
  id: "v1", versionNumber: 1, status: "published", data: {}, note: null,
  createdBy: "u1", createdAt: "2026-07-01T00:00:00Z", authorName: "Tim", ...over,
});
const comment = (over: any) => ({
  id: "m1", cardId: "c1", proposalId: null, field: null, suggestedValue: null,
  parentId: null, body: "hi", resolved: false, createdBy: "u1",
  createdAt: "2026-07-01T12:00:00Z", authorName: "Tim", ...over,
});

describe("deriveSupersededBy", () => {
  const T = "2026-07-03T10:00:00Z";
  it("names the sibling accepted at the same instant", () => {
    const s = prop({ id: "p1", status: "superseded", closedAt: T });
    const winner = prop({ id: "p2", status: "accepted", closedAt: T, summary: "buff Goliath" });
    expect(deriveSupersededBy(s, [s, winner])).toBe("buff Goliath");
  });
  it("returns null (out of date) when no sibling was accepted then", () => {
    const s = prop({ id: "p1", status: "superseded", closedAt: T });
    const other = prop({ id: "p2", status: "accepted", closedAt: "2026-07-04T00:00:00Z" });
    expect(deriveSupersededBy(s, [s, other])).toBeNull();
  });
});

describe("buildHistory", () => {
  it("merges sources newest-first, diffs consecutive versions, attaches proposal reasons", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, data: { name: "A" }, createdAt: "2026-07-01T00:00:00Z" });
    const v2 = ver({ id: "v2", versionNumber: 2, data: { name: "B" }, createdAt: "2026-07-03T00:00:00Z", note: "renamed" });
    const denied = prop({ id: "p1", status: "denied", closedAt: "2026-07-02T00:00:00Z" });
    const reason = comment({ id: "m1", proposalId: "p1", body: "too strong", createdAt: "2026-07-02T00:00:00Z" });
    const ev = { id: 1, action: "card_approved", actor: "u1", actorName: "Tim", at: "2026-07-04T00:00:00Z" };
    const h = buildHistory([v2, v1], [denied], [ev], [reason]);
    expect(h.map((e) => e.kind)).toEqual(["lifecycle", "version", "proposal", "version"]);
    const versionEntry = h[1] as any;
    expect(versionEntry.version.id).toBe("v2");
    expect(versionEntry.changes).toEqual([expect.objectContaining({ field: "name", before: "A", after: "B" })]);
    expect((h[2] as any).reasons).toEqual([expect.objectContaining({ id: "m1" })]);
  });
  it("omits open proposals (they render in the Open proposals section)", () => {
    expect(buildHistory([], [prop({ status: "open" })], [], [])).toEqual([]);
  });
  it("resolves the accepted proposal's resulting version number", () => {
    const v2 = ver({ id: "v2", versionNumber: 2, createdAt: "2026-07-03T00:00:00Z" });
    const accepted = prop({ id: "p1", status: "accepted", closedAt: "2026-07-03T00:00:00Z", resultingVersionId: "v2" });
    const h = buildHistory([v2], [accepted], [], []);
    const pe = h.find((e) => e.kind === "proposal") as any;
    expect(pe.resultingVersionNumber).toBe(2);
  });
});

describe("buildCommentEras", () => {
  it("inserts an era marker before the first comment written after each release", () => {
    const v1 = { versionNumber: 1, createdAt: "2026-07-01T00:00:00Z" };
    const v2 = { versionNumber: 2, createdAt: "2026-07-03T00:00:00Z" };
    const c1 = comment({ id: "m1", createdAt: "2026-07-02T00:00:00Z" });
    const c2 = comment({ id: "m2", createdAt: "2026-07-04T00:00:00Z" });
    expect(buildCommentEras([c1, c2], [v2, v1]).map((x) => x.kind === "era" ? `v${x.versionNumber}` : x.comment.id))
      .toEqual(["v1", "m1", "v2", "m2"]);
  });
  it("emits no markers when there are no versions", () => {
    const c1 = comment({ id: "m1" });
    expect(buildCommentEras([c1], [])).toEqual([{ kind: "comment", comment: c1 }]);
  });
});

describe("EVENT_LABEL", () => {
  it("covers all five audited actions", () => {
    for (const a of ["card_approved", "card_unapproved", "card_archived", "card_unarchived", "card_returned_to_ideas"]) {
      expect(EVENT_LABEL[a]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/historyView.test.ts`
Expected: FAIL — `../historyView` does not exist.

- [ ] **Step 3: Implement `app/forge/lib/historyView.ts`**

```ts
// Pure assembly of the card History timeline — isomorphic (no "use server"),
// imported by client components and unit tests alike.

import { diffCards, type FieldChange } from "@/app/forge/lib/cardDiff";
import type { ProposalRow } from "@/app/forge/lib/proposals";
import type { VersionRow, CardEventRow } from "@/app/forge/lib/versions";
import type { CommentRow } from "@/app/forge/lib/comments";

export type HistoryEvent =
  | { kind: "version"; at: string; version: VersionRow; changes: FieldChange[] }
  | { kind: "proposal"; at: string; proposal: ProposalRow; reasons: CommentRow[]; supersededBy: string | null }
  | { kind: "lifecycle"; at: string; event: CardEventRow };

export const EVENT_LABEL: Record<string, string> = {
  card_approved: "Marked final",
  card_unapproved: "Reopened testing",
  card_archived: "Shelved",
  card_unarchived: "Restored",
  card_returned_to_ideas: "Returned to ideas",
};

// A superseded proposal closes inside forge_accept_proposal, in the same
// transaction as the winning sibling — their closed_at values are identical
// (transaction-stable now()). No accepted sibling at that instant means the
// stale-base case: a direct release replaced the version it was based on.
export function deriveSupersededBy(p: ProposalRow, all: ProposalRow[]): string | null {
  if (p.status !== "superseded" || !p.closedAt) return null;
  const winner = all.find(
    (q) => q.id !== p.id && q.status === "accepted" && q.closedAt === p.closedAt
  );
  return winner ? (winner.summary ?? "an accepted proposal") : null;
}

// Newest-first merged timeline. Ties (an accept freezes a version and closes
// the proposal at the same instant) order version above its proposal entry.
const KIND_RANK: Record<HistoryEvent["kind"], number> = { lifecycle: 0, version: 1, proposal: 2 };

export function buildHistory(
  versions: VersionRow[],
  proposals: ProposalRow[],
  events: CardEventRow[],
  comments: CommentRow[]
): HistoryEvent[] {
  const byNumber = new Map(versions.map((v) => [v.versionNumber, v]));
  const out: HistoryEvent[] = [];
  for (const v of versions) {
    const prev = byNumber.get(v.versionNumber - 1);
    out.push({ kind: "version", at: v.createdAt, version: v, changes: diffCards(prev?.data ?? {}, v.data) });
  }
  for (const p of proposals) {
    if (p.status === "open") continue;
    out.push({
      kind: "proposal",
      at: p.closedAt ?? p.createdAt,
      proposal: p,
      reasons: comments.filter((c) => c.proposalId === p.id),
      supersededBy: deriveSupersededBy(p, proposals),
      resultingVersionNumber:
        versions.find((v) => v.id === p.resultingVersionId)?.versionNumber ?? null,
    });
  }
  for (const e of events) out.push({ kind: "lifecycle", at: e.at, event: e });
  return out.sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || KIND_RANK[a.kind] - KIND_RANK[b.kind]
  );
}

// Era dividers for the (ascending) top-level comment thread: before the first
// comment written at-or-after each release, mark which version it followed.
export type CommentEraItem =
  | { kind: "comment"; comment: CommentRow }
  | { kind: "era"; versionNumber: number; at: string };

export function buildCommentEras(
  topComments: CommentRow[],
  versions: Pick<VersionRow, "versionNumber" | "createdAt">[]
): CommentEraItem[] {
  const eras = [...versions].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: CommentEraItem[] = [];
  let nextEra = 0;
  for (const c of topComments) {
    while (nextEra < eras.length && Date.parse(eras[nextEra].createdAt) <= Date.parse(c.createdAt)) {
      out.push({ kind: "era", versionNumber: eras[nextEra].versionNumber, at: eras[nextEra].createdAt });
      nextEra++;
    }
    out.push({ kind: "comment", comment: c });
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/forge/lib/__tests__/historyView.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/historyView.ts app/forge/lib/__tests__/historyView.test.ts
git commit -m "feat(forge): pure history-timeline assembly + supersede derivation + comment eras"
```

---

### Task 5: Studio History UI (CardHistory + ReviewPanel + page + CommentThread)

**Files:**
- Create: `app/forge/cards/[cardId]/CardHistory.tsx`
- Modify: `app/forge/cards/[cardId]/ReviewPanel.tsx` (replace the "Proposal history" section; new props)
- Modify: `app/forge/cards/[cardId]/page.tsx` (fetch versions + events)
- Modify: `app/forge/cards/[cardId]/CommentThread.tsx` (era dividers)

**Interfaces:**
- Consumes: `listVersions`/`listCardEvents` (Task 3), `buildHistory`/`buildCommentEras`/`EVENT_LABEL` (Task 4), `STATUS_BADGE_CLASS` (`lifecycleCopy.ts`), `timeAgo` (`relativeTime.ts`), `summarizeDiff` (`cardDiff.ts`).
- Produces: `<CardHistory history={HistoryEvent[]} />`; `CommentThread` gains optional prop `versions?: { versionNumber: number; createdAt: string }[]`.

- [ ] **Step 1: Create `app/forge/cards/[cardId]/CardHistory.tsx`**

```tsx
"use client";

import { STATUS_BADGE_CLASS } from "@/app/forge/lib/lifecycleCopy";
import { timeAgo } from "@/app/forge/lib/relativeTime";
import { summarizeDiff, type FieldChange } from "@/app/forge/lib/cardDiff";
import { EVENT_LABEL, type HistoryEvent } from "@/app/forge/lib/historyView";

const VERSION_STATUS_LABEL: Record<string, string> = {
  published: "Current",
  approved: "Final",
  superseded: "Superseded",
};
const VERSION_PILL: Record<string, string> = {
  published: STATUS_BADGE_CLASS.playtesting,
  approved: STATUS_BADGE_CLASS.approved,
  superseded: STATUS_BADGE_CLASS.archived,
};
const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  denied: "Denied",
  superseded: "Superseded",
};

function ChangeList({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        {summarizeDiff(changes)}
      </summary>
      <ul className="mt-1 space-y-1 text-xs">
        {changes.map((c) => (
          <li key={c.field as string}>
            <span className="font-medium">{c.label}:</span>{" "}
            <span className="text-destructive line-through">{c.before ?? "—"}</span>
            {" → "}
            <span className="text-primary">{c.after ?? "—"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function CardHistory({ history }: { history: HistoryEvent[] }) {
  if (history.length === 0) {
    return <p className="text-xs text-muted-foreground">No releases yet.</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {history.map((e) => {
        if (e.kind === "version") {
          const v = e.version;
          return (
            <li key={`v-${v.id}`} className="rounded-md border px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">v{v.versionNumber} released</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${VERSION_PILL[v.status]}`}>
                  {VERSION_STATUS_LABEL[v.status]}
                </span>
                <span className="text-muted-foreground">
                  {v.authorName ?? "Forge member"} · {timeAgo(v.createdAt)}
                </span>
              </div>
              {v.note && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{v.note}</p>}
              <ChangeList changes={e.changes} />
            </li>
          );
        }
        if (e.kind === "proposal") {
          const p = e.proposal;
          return (
            <li key={`p-${p.id}`} className="rounded-md border px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span>{p.summary ?? "Proposed change"}</span>
                <span className="text-muted-foreground">
                  {PROPOSAL_STATUS_LABEL[p.status] ?? p.status}
                  {p.status === "accepted" && e.resultingVersionNumber != null && <> → v{e.resultingVersionNumber}</>}
                </span>
              </div>
              {p.status === "superseded" && (
                <p className="mt-1 text-muted-foreground">
                  {e.supersededBy
                    ? <>Superseded when “{e.supersededBy}” was accepted.</>
                    : <>Out of date — a direct release replaced the version it was based on.</>}
                </p>
              )}
              {e.reasons.map((r) => (
                <p key={r.id} className={`mt-1 whitespace-pre-wrap ${p.status === "denied" ? "text-destructive" : "text-muted-foreground"}`}>
                  <span className="font-medium text-foreground">{r.authorName ?? "Forge member"}</span>
                  {" · "}
                  {timeAgo(r.createdAt)}
                  {" — "}
                  {r.body}
                </p>
              ))}
            </li>
          );
        }
        return (
          <li key={`e-${e.event.id}`} className="px-2 py-1 text-muted-foreground">
            <span className="font-medium text-foreground">{EVENT_LABEL[e.event.action] ?? e.event.action}</span>
            {" · "}
            {e.event.actorName ?? "Forge member"}
            {" · "}
            {timeAgo(e.at)}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Rewire `ReviewPanel.tsx`**

Replace the whole file body as follows (changes: new props `versions`/`events`, the "Proposal history" section becomes "History" rendering `CardHistory`, `CommentThread` receives `versions`; the `STATUS_LABEL`/`history`/`reasonsFor` locals are deleted):

```tsx
"use client";

import ProposalDiff from "./ProposalDiff";
import CommentThread from "./CommentThread";
import CardHistory from "./CardHistory";
import { buildHistory } from "@/app/forge/lib/historyView";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { ProposalDiffData, ProposalRow } from "@/app/forge/lib/proposals";
import type { CommentRow } from "@/app/forge/lib/comments";
import type { VersionRow, CardEventRow } from "@/app/forge/lib/versions";

export default function ReviewPanel({
  card,
  openDiffs,
  proposals,
  comments,
  versions,
  events,
  canReview,
}: {
  card: ForgeCardFull;
  openDiffs: ProposalDiffData[];
  proposals: ProposalRow[];
  comments: CommentRow[];
  versions: VersionRow[];
  events: CardEventRow[];
  canReview: boolean;
}) {
  // Cache-buster: updated_at bumps on every image/snapshot write, mirroring the studio.
  const t = Date.parse(card.updatedAt) || 0;
  const artUrl = card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null;
  const finishedUrl = card.hasFinished ? `/forge/api/art/${card.id}?kind=finished&t=${t}` : null;
  const history = buildHistory(versions, proposals, events, comments);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pt-0">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Open proposals</h2>
        {openDiffs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open proposals.</p>
        ) : (
          <div className="space-y-3">
            {openDiffs.map((d) => (
              <ProposalDiff
                key={d.proposal.id}
                proposal={d.proposal}
                current={d.current}
                artUrl={artUrl}
                finishedUrl={finishedUrl}
                canReview={canReview}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <CardHistory history={history} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Comments &amp; suggestions</h2>
        <CommentThread
          cardId={card.id}
          comments={comments}
          canApply={canReview}
          versions={versions.map((v) => ({ versionNumber: v.versionNumber, createdAt: v.createdAt }))}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Fetch versions + events in `page.tsx`**

In `app/forge/cards/[cardId]/page.tsx`:
1. Add import: `import { listVersions, listCardEvents } from "@/app/forge/lib/versions";`
2. Replace the `[openDiffs, proposals, comments]` destructuring block with:

```ts
  const [openDiffs, proposals, comments, versions, events] = inSet
    ? await Promise.all([
        getOpenProposalDiffs(cardId),
        listProposals(cardId),
        listComments(cardId),
        listVersions(cardId),
        listCardEvents(cardId),
      ])
    : [[], [], [], [], []];
```

3. Pass them to `ReviewPanel`: add `versions={versions}` and `events={events}` next to the existing props.

- [ ] **Step 4: Era dividers in `CommentThread.tsx`**

1. Add imports:

```ts
import { buildCommentEras } from "@/app/forge/lib/historyView";
```

2. Add the optional prop — the component signature becomes:

```tsx
export default function CommentThread({
  cardId,
  comments,
  canApply,
  versions = [],
}: {
  cardId: string;
  comments: CommentRow[];
  canApply: boolean;
  versions?: { versionNumber: number; createdAt: string }[];
}) {
```

3. Replace the final render block (from `{top.length === 0 && …}` through the closing `.map`) with:

```tsx
      {top.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
      {buildCommentEras(top, versions).map((item) =>
        item.kind === "era" ? (
          <div key={`era-${item.versionNumber}`} className="flex items-center gap-2 text-[10px] text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            v{item.versionNumber} released · {new Date(item.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : (
          <div key={item.comment.id} className="space-y-2">
            <Comment c={item.comment} />
            {repliesOf(item.comment.id).map((r) => (
              <Comment key={r.id} c={r} isReply />
            ))}
          </div>
        )
      )}
```

- [ ] **Step 5: Typecheck and full unit suite**

Run: `npx tsc --noEmit` — Expected: only the 10 pre-existing errors.
Run: `npx vitest run app/forge/lib/__tests__/` — Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add "app/forge/cards/[cardId]/CardHistory.tsx" "app/forge/cards/[cardId]/ReviewPanel.tsx" "app/forge/cards/[cardId]/page.tsx" "app/forge/cards/[cardId]/CommentThread.tsx"
git commit -m "feat(forge): card History timeline + comment era dividers in the studio"
```

---

### Task 6: Set page "Updated since" filter

**Files:**
- Modify: `app/forge/sets/[setId]/cards/page.tsx` (fetch release info)
- Modify: `app/forge/sets/[setId]/cards/SetCardsBrowser.tsx` (date filter + sort + badges)
- Modify: `app/forge/components/ForgeCardGrid.tsx` (optional release badge)

**Interfaces:**
- Consumes: `listSetActivity(cardIds)` → `Record<cardId, { versionNumber, releasedAt }>` (Task 3).
- Produces: `ForgeCardGrid` optional prop `releaseBadges?: Record<string, string>` (card id → label like `"v6 · Jul 3"`).

- [ ] **Step 1: Fetch in `page.tsx`**

1. Add import: `import { listSetActivity } from "@/app/forge/lib/versions";`
2. Replace the counts fetch with:

```ts
  const [commentCounts, proposalCounts, releases] = await Promise.all([
    listUnresolvedCommentCounts(cardIds),
    listOpenProposalCounts(cardIds),
    listSetActivity(cardIds),
  ]);
  return <SetCardsBrowser cards={cards} setId={setId} canCreate={canCreate} commentCounts={commentCounts} proposalCounts={proposalCounts} releases={releases} />;
```

- [ ] **Step 2: Filter + sort + badges in `SetCardsBrowser.tsx`**

1. Add import: `import type { ReleaseInfo } from "@/app/forge/lib/versions";`
2. Add `releases` to the props (type `releases?: Record<string, ReleaseInfo>`), destructured alongside `proposalCounts`.
3. Add state next to the other filters: `const [since, setSince] = useState("");`
4. In the `filtered` memo, add a `since` clause after the `brigade` check and `since`/`releases` to the dependency array:

```ts
    if (since) {
      const cutoff = Date.parse(since);
      const rel = releases?.[c.id];
      if (!rel || Date.parse(rel.releasedAt) < cutoff) return false;
    }
```

5. After the `filtered` memo, add a display-order memo (most recent release first while the filter is active) and use `shown` in place of `filtered` for the grid and the select-all button ONLY (leave `draftIds` and the count label on `filtered`):

```ts
  const shown = useMemo(() => {
    if (!since) return filtered;
    return [...filtered].sort(
      (a, b) => Date.parse(releases?.[b.id]?.releasedAt ?? "") - Date.parse(releases?.[a.id]?.releasedAt ?? "")
    );
  }, [filtered, since, releases]);
```

6. Add the date input to the toolbar, directly after the brigade `<select>`:

```tsx
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Updated since
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            aria-label="Show cards released since date"
            className={selectClass}
          />
        </label>
```

7. Build badges and pass them to the grid — replace the `<ForgeCardGrid cards={filtered} …/>` call:

```tsx
      <ForgeCardGrid
        cards={shown}
        showStatus
        commentCounts={commentCounts}
        proposalCounts={proposalCounts}
        releaseBadges={since ? Object.fromEntries(
          shown.flatMap((c) => {
            const rel = releases?.[c.id];
            return rel ? [[c.id, `v${rel.versionNumber} · ${new Date(rel.releasedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`]] : [];
          })
        ) : undefined}
        selection={{ active: selecting, selected, onToggle: toggle }}
        leading={canCreate ? <AddCardTile setId={setId} disabled={selecting} /> : undefined}
      />
```

8. Update the select-all button to use `shown`: `onClick={() => setSelected(new Set(shown.map((c) => c.id)))}` and its label count to `({shown.length})`.

- [ ] **Step 3: Release badge in `ForgeCardGrid.tsx`**

1. Add `releaseBadges` to the props type and destructuring: `releaseBadges?: Record<string, string>;`
2. Inside the card map, next to `const propCount = …`, add: `const release = releaseBadges?.[c.id];`
3. After the `propCount` badge span (bottom-right), add a bottom-left badge:

```tsx
              {release && (
                <span
                  className="absolute bottom-1 left-1 z-10 rounded-full border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm"
                  title={`Latest release ${release}`}
                >
                  {release}
                </span>
              )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — Expected: only the 10 pre-existing errors.

- [ ] **Step 5: Commit**

```bash
git add "app/forge/sets/[setId]/cards/page.tsx" "app/forge/sets/[setId]/cards/SetCardsBrowser.tsx" app/forge/components/ForgeCardGrid.tsx
git commit -m "feat(forge): set-page updated-since filter with release badges"
```

---

### Task 7: Migration application + live verification (COORDINATOR TASK)

**Do not dispatch this to a subagent** — it requires the session's Supabase MCP connection and judgment about prod.

- [ ] **Step 1:** Apply `072_forge_version_history.sql` via Supabase MCP `apply_migration` (name `forge_version_history`).
- [ ] **Step 2:** Post-apply checks via `execute_sql`:
  - `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'forge_publish_card';` → expect `1` (no overload left).
  - `select has_function_privilege('anon', 'public.forge_publish_card(uuid, text)', 'execute');` → expect `false`.
  - `select column_name from information_schema.columns where table_name = 'card_versions' and column_name = 'note';` → expect 1 row.
- [ ] **Step 3:** Run `mcp get_advisors` (security) — expect no new findings for the touched functions.
- [ ] **Step 4:** Full local gate: `npx vitest run app/forge/lib/__tests__/` and `npx tsc --noEmit`.
- [ ] **Step 5:** Live smoke via the verify skill flow (elder account): release a card with a note → History shows the version with the note; set the date filter → card appears with badge; deny-reason comment shows in History; deleting a proposal-anchored comment is refused.

> Substitution note: the spec's §7 "E2E smoke (extends e2e/forge/)" is fulfilled by this manual verify-skill pass for this iteration; an automated spec can be added later if the flow proves regression-prone.
