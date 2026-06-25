# Forge Phase 1b.1 — Review Layer (Proposals + Comments/Suggestions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "code review, but for cards" layer to the Forge — proposals (PR-style change with a side-by-side Current/Proposed card diff and single-elder accept/deny), threaded comments + field-anchored single-field suggestions with one-click apply, and a per-set review queue.

**Architecture:** A new Postgres migration (`053`) adds two default-deny RLS tables (`card_proposals`, `card_comments`) whose writes flow only through SECURITY DEFINER RPCs (mirroring 052's publish/approve invariants — `FOR UPDATE`, version allocation under the lock, anon-revoked functions). Server-action lib modules (`proposals.ts`, `comments.ts`, `review.ts`) wrap the RPCs with the established `{ok,error}` shape. A pure `cardDiff.ts` module computes field changes. Client components (`ProposalDiff`, `CommentThread`, `ReviewPanel`) wire into the existing single studio route `/forge/cards/[cardId]`; a new `/forge/sets/[setId]/review` route lists the queue. Liveness is `router.refresh()` (no Realtime — that's 1b.2).

**Tech Stack:** Next.js 15 (App Router, RSC + server actions), React 19, TypeScript (`strict:false`), Supabase Postgres + RLS, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-forge-phase-1b-1-review-layer-design.md`

## Global Constraints

- **Migration baseline = 052.** New migration file is `supabase/migrations/053_forge_review_layer.sql`. SCHEMA + FUNCTIONS ONLY, no card data.
- **Security spine (non-negotiable):** every new table is RLS-enabled, default-deny (no INSERT/UPDATE/DELETE policies), `revoke all from anon`, `grant select to authenticated`. Every new function is `security definer set search_path = ''`, with explicit `revoke execute … from public, anon` + `grant execute … to authenticated`. The anon-leak test (`__tests__/forge-anon-leak.test.ts`) MUST be extended for every new table and function.
- **No Realtime in this slice.** Liveness is refetch (`router.refresh()` / `revalidatePath`).
- **`strict:false` union-narrowing gotcha:** never write `if (r.ok) {…} else { r.error }`. Access success props only inside `if (r.ok) {…}`, or guard with `if (r.ok === false) { …; return }` then use success props. (See existing `app/forge/ideas/IdeasLibrary.tsx:28` and `app/forge/sets/SetsIndex.tsx:19-20`.) Only `npm run build` / `tsc` catches a violation.
- **No focus rings** on form controls (`feedback_no_focus_rings`): do not add `focus:ring-*`.
- **Suggestion field allowlist** (raw `DesignCard` property keys, used in SQL and the field picker — keep these three lists identical): `name, cardType, alignment, brigades, strength, toughness, strengthModifier, toughnessModifier, class, icons, identifiers, specialAbility, reference, legality, rarity, flavorText, artistCredit, cardFrame`.
- **Applying migration 053 to prod is an ORCHESTRATOR step requiring explicit per-migration user authorization** (the auto-mode classifier blocks subagent-applied migrations). Subagents write the `.sql` file only; they do not apply it. The live `test:security` run (Task 10) happens after the orchestrator applies it.
- **Per-task typecheck:** `npx tsc --noEmit` should report no errors referencing the files you touched. The full `npm run build` runs once in Task 10. (Per `feedback_skip_build`, don't run full `next build` mid-task.)

---

## File Structure

| File | New/Mod | Responsibility |
|---|---|---|
| `supabase/migrations/053_forge_review_layer.sql` | New | Enum + 2 tables + RLS + read guard + 7 RPCs + allowlist helper + revokes/grants |
| `app/forge/lib/designCard.ts` | Mod | Add a one-line comment noting the SQL field-allowlist coupling |
| `app/forge/lib/cardDiff.ts` | New (pure) | `diffCards`, `summarizeDiff`, `coerceFieldValue`, `FIELD_LABELS`, `DIFF_FIELDS` |
| `app/forge/lib/__tests__/cardDiff.test.ts` | New | Unit tests for cardDiff |
| `app/forge/lib/proposals.ts` | New | Actions `createProposal/acceptProposal/denyProposal` + reads `listProposals/getOpenProposalDiffs` |
| `app/forge/lib/comments.ts` | New | Actions `addComment/resolveComment/applySuggestion/deleteComment` + read `listComments` |
| `app/forge/lib/review.ts` | New | `getSetReviewQueue(setId)` |
| `app/forge/cards/[cardId]/ProposalDiff.tsx` | New | One proposal: change list + Current/Proposed previews + accept/deny |
| `app/forge/cards/[cardId]/CommentThread.tsx` | New | Card-level thread + compose + suggestion field-picker + reply/resolve/apply/delete |
| `app/forge/cards/[cardId]/ReviewPanel.tsx` | New | Composes open proposals + history + comment thread (rendered only when in a set) |
| `app/forge/cards/[cardId]/StudioEditor.tsx` | Mod | Add "Propose changes" control (uses the live snapshot) |
| `app/forge/cards/[cardId]/page.tsx` | Mod | Load review data when in a set; render ReviewPanel |
| `app/forge/sets/[setId]/review/page.tsx` | New | Review-queue route (gated by the set layout) |
| `app/forge/sets/[setId]/review/ReviewQueue.tsx` | New | Queue list UI |
| `app/forge/sets/[setId]/layout.tsx` | Mod | Add "Review" nav tab |
| `__tests__/forge-anon-leak.test.ts` | Mod | Add 2 tables + 9 functions to the guardrail |

---

## Task 1: Migration 053 — review-layer schema, RLS, and RPCs

**Files:**
- Create: `supabase/migrations/053_forge_review_layer.sql`
- Modify: `app/forge/lib/designCard.ts` (one comment line)

**Interfaces produced (consumed by later tasks via `supabase.rpc(...)`):**
- `forge_create_proposal(p_card_id uuid, p_snapshot jsonb, p_summary text) → uuid`
- `forge_accept_proposal(p_proposal_id uuid) → uuid` (NULL = stale base / out-of-date)
- `forge_deny_proposal(p_proposal_id uuid, p_reason text) → void`
- `forge_add_comment(p_card_id uuid, p_proposal_id uuid, p_parent_id uuid, p_field text, p_suggested_value jsonb, p_body text) → uuid`
- `forge_resolve_comment(p_comment_id uuid, p_resolved boolean) → void`
- `forge_apply_suggestion(p_comment_id uuid) → timestamptz`
- `forge_delete_comment(p_comment_id uuid) → void`
- Tables `card_proposals`, `card_comments` (columns per the SQL below).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/053_forge_review_layer.sql`:

```sql
-- 053_forge_review_layer.sql
-- Forge phase 1b.1: the review layer — proposals + comments/suggestions.
-- Adds card_proposals + card_comments (default-deny RLS, definer-RPC-only writes),
-- the _forge_can_read_card read guard (elder-only; NO granted/Phase-2 branch),
-- a raw-DesignCard-key allowlist helper, and the proposal/comment RPCs.
-- Realtime is NOT enabled here (1b.1 is refetch-only; private-channel Realtime is 1b.2).
-- Builds on 052 (card_versions, set-aware RLS, publish/approve RPCs, helpers).
-- SCHEMA + FUNCTIONS ONLY — no card data.

-- 1) proposal-status enum
do $$ begin
  create type public.proposal_status as enum ('open','accepted','denied','superseded');
exception when duplicate_object then null; end $$;

-- 2) Proposals ("pull request": a candidate change frozen for sign-off)
create table if not exists public.card_proposals (
  id                   uuid primary key default gen_random_uuid(),
  card_id              uuid not null references public.forge_cards(id) on delete cascade,
  base_version_id      uuid references public.card_versions(id),
  proposed_snapshot    jsonb not null,
  proposed_art_key     text,                 -- reserved; unused in 1b.1
  summary              text,
  status               public.proposal_status not null default 'open',
  resulting_version_id uuid references public.card_versions(id),
  created_by           uuid not null references auth.users(id),
  created_at           timestamptz not null default now(),
  closed_at            timestamptz,
  closed_by            uuid references auth.users(id)
);
create index if not exists card_proposals_card_idx on public.card_proposals(card_id);
create index if not exists card_proposals_open_idx on public.card_proposals(card_id) where status = 'open';

-- 3) Comments (threaded; card-level discussion OR field-anchored suggestion OR proposal-level)
create table if not exists public.card_comments (
  id                uuid primary key default gen_random_uuid(),
  card_id           uuid not null references public.forge_cards(id) on delete cascade,
  proposal_id       uuid references public.card_proposals(id) on delete cascade,
  field             text,
  suggested_value   jsonb,
  parent_comment_id uuid references public.card_comments(id) on delete cascade,
  body              text not null,
  resolved          boolean not null default false,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now()
);
create index if not exists card_comments_card_idx     on public.card_comments(card_id);
create index if not exists card_comments_proposal_idx on public.card_comments(proposal_id);

-- 4) Read guard — owner / set-elder / superadmin. NO granted (Phase-2) branch:
--    proposals/comments are an elder-only collaboration surface.
create or replace function public._forge_can_read_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  );
$$;

-- 4b) Raw-DesignCard-key allowlist. MUST mirror the DesignCard type keys in
--     app/forge/lib/designCard.ts (NOT the synthetic FieldKey union).
create or replace function public._forge_is_card_field(p_field text)
returns boolean language sql immutable set search_path = '' as $$
  select p_field = any (array[
    'name','cardType','alignment','brigades','strength','toughness',
    'strengthModifier','toughnessModifier','class','icons','identifiers',
    'specialAbility','reference','legality','rarity','flavorText','artistCredit','cardFrame'
  ]);
$$;

-- 5) RLS (select-only; all writes via definer RPCs)
alter table public.card_proposals enable row level security;
alter table public.card_comments  enable row level security;

drop policy if exists "card_proposals_select" on public.card_proposals;
create policy "card_proposals_select" on public.card_proposals
  for select to authenticated
  using (public._forge_can_read_card(card_proposals.card_id));

drop policy if exists "card_comments_select" on public.card_comments;
create policy "card_comments_select" on public.card_comments
  for select to authenticated
  using (public._forge_can_read_card(card_comments.card_id));

revoke all on public.card_proposals from anon;
revoke all on public.card_comments  from anon;
grant select on public.card_proposals to authenticated;
grant select on public.card_comments  to authenticated;

-- 6) RPCs

-- Create a proposal: freeze the supplied snapshot against the card's current
-- published version. Caller must be able to read the card; card must be in a set
-- and in the active design loop (draft/playtesting).
create or replace function public.forge_create_proposal(p_card_id uuid, p_snapshot jsonb, p_summary text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_id uuid;
begin
  if not public._forge_can_read_card(p_card_id) then
    raise exception 'not authorized to propose on this card';
  end if;
  if btrim(coalesce(p_summary,'')) = '' then raise exception 'a summary is required'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot must be an object';
  end if;
  if octet_length(p_snapshot::text) > 64000 then raise exception 'snapshot too large'; end if;
  select * into v_card from public.forge_cards where id = p_card_id for share;
  if not found then raise exception 'card not found'; end if;
  if v_card.set_id is null then raise exception 'only cards in a set can have proposals'; end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'proposals are only for draft or playtesting cards';
  end if;
  insert into public.card_proposals (card_id, base_version_id, proposed_snapshot, summary, created_by)
  values (p_card_id, v_card.published_version_id, p_snapshot, btrim(p_summary), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- Accept (single-elder, N=1): publish the proposed snapshot as a new immutable
-- version, sync the working draft, advance status, close siblings. Returns the new
-- version id, or NULL if the base is stale (out of date — re-propose).
create or replace function public.forge_accept_proposal(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prop public.card_proposals%rowtype; v_card public.forge_cards%rowtype;
        v_next int; v_version_id uuid;
begin
  -- initial read to learn the card_id
  select * into v_prop from public.card_proposals where id = p_proposal_id;
  if not found then raise exception 'proposal not found'; end if;
  -- lock the card first, then re-read+lock the proposal under that lock
  select * into v_card from public.forge_cards where id = v_prop.card_id for update;
  if not found then raise exception 'card not found'; end if;
  select * into v_prop from public.card_proposals where id = p_proposal_id for update;
  if v_prop.status <> 'open' then raise exception 'proposal is not open'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to accept proposals on this card';
  end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'unapprove or unarchive this card before accepting changes';
  end if;
  -- stale-base guard (NULL-aware). DO NOT raise — a raise would roll back this update.
  if v_prop.base_version_id is distinct from v_card.published_version_id then
    update public.card_proposals
       set status = 'superseded', closed_at = now(), closed_by = auth.uid()
     where id = p_proposal_id;
    return null;
  end if;
  -- freeze a new published version from the proposed snapshot
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = v_card.id;
  update public.card_versions set status = 'superseded'
    where card_id = v_card.id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, created_by)
  values
    (v_card.id, v_next, 'published', v_prop.proposed_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key, auth.uid())
  returning id into v_version_id;
  -- point the card at it, sync the working draft + title, advance status
  update public.forge_cards
     set published_version_id = v_version_id,
         working_snapshot = v_prop.proposed_snapshot,
         title = nullif(btrim(coalesce(v_prop.proposed_snapshot->>'name','')), ''),
         status = 'playtesting',
         updated_at = now()
   where id = v_card.id;
  -- close this proposal accepted; supersede sibling open proposals
  update public.card_proposals
     set status = 'accepted', resulting_version_id = v_version_id, closed_at = now(), closed_by = auth.uid()
   where id = p_proposal_id;
  update public.card_proposals
     set status = 'superseded', closed_at = now(), closed_by = auth.uid()
   where card_id = v_card.id and status = 'open' and id <> p_proposal_id;
  return v_version_id;
end; $$;

-- Deny: requires a reason; closes denied; records the reason as a proposal comment.
create or replace function public.forge_deny_proposal(p_proposal_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prop public.card_proposals%rowtype; v_card public.forge_cards%rowtype;
begin
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'a reason is required to deny'; end if;
  select * into v_prop from public.card_proposals where id = p_proposal_id for update;
  if not found then raise exception 'proposal not found'; end if;
  if v_prop.status <> 'open' then raise exception 'proposal is not open'; end if;
  select * into v_card from public.forge_cards where id = v_prop.card_id;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to deny proposals on this card';
  end if;
  update public.card_proposals
     set status = 'denied', closed_at = now(), closed_by = auth.uid()
   where id = p_proposal_id;
  insert into public.card_comments (card_id, proposal_id, body, created_by)
  values (v_prop.card_id, p_proposal_id, btrim(p_reason), auth.uid());
end; $$;

-- Add a comment / field-anchored suggestion. Caller must be able to read the card.
create or replace function public.forge_add_comment(
  p_card_id uuid, p_proposal_id uuid, p_parent_id uuid,
  p_field text, p_suggested_value jsonb, p_body text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public._forge_can_read_card(p_card_id) then
    raise exception 'not authorized to comment on this card';
  end if;
  if btrim(coalesce(p_body,'')) = '' then raise exception 'a comment body is required'; end if;
  if octet_length(p_body) > 8000 then raise exception 'comment too long'; end if;
  if p_suggested_value is not null and octet_length(p_suggested_value::text) > 8000 then
    raise exception 'suggested value too large';
  end if;
  if p_field is not null and not public._forge_is_card_field(p_field) then
    raise exception 'unknown card field';
  end if;
  insert into public.card_comments
    (card_id, proposal_id, parent_comment_id, field, suggested_value, body, created_by)
  values
    (p_card_id, p_proposal_id, p_parent_id, p_field, p_suggested_value, btrim(p_body), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- Resolve/unresolve a comment. Author, or set-elder/super of the card.
create or replace function public.forge_resolve_comment(p_comment_id uuid, p_resolved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  select * into v_card from public.forge_cards where id = v_c.card_id;
  if not (v_c.created_by = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  update public.card_comments set resolved = coalesce(p_resolved, false) where id = p_comment_id;
end; $$;

-- Apply a field-anchored suggestion to the working draft. Owner/set-elder/super.
create or replace function public.forge_apply_suggestion(p_comment_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
        v_new jsonb; v_updated timestamptz;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  if v_c.field is null or v_c.suggested_value is null then
    raise exception 'this comment is not an applyable suggestion';
  end if;
  if not public._forge_is_card_field(v_c.field) then raise exception 'unknown card field'; end if;
  select * into v_card from public.forge_cards where id = v_c.card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to edit this card';
  end if;
  v_new := jsonb_set(coalesce(v_card.working_snapshot, '{}'::jsonb), array[v_c.field], v_c.suggested_value, true);
  if octet_length(v_new::text) > 64000 then raise exception 'snapshot too large'; end if;
  update public.forge_cards
     set working_snapshot = v_new,
         title = nullif(btrim(coalesce(v_new->>'name','')), ''),
         updated_at = now()
   where id = v_card.id
  returning updated_at into v_updated;
  update public.card_comments set resolved = true where id = p_comment_id;
  return v_updated;
end; $$;

-- Delete a comment (cascade removes replies). Author, or set-elder/super.
create or replace function public.forge_delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.card_comments%rowtype; v_card public.forge_cards%rowtype;
begin
  select * into v_c from public.card_comments where id = p_comment_id;
  if not found then raise exception 'comment not found'; end if;
  select * into v_card from public.forge_cards where id = v_c.card_id;
  if not (v_c.created_by = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  delete from public.card_comments where id = p_comment_id;
end; $$;

-- 7) Lock down EXECUTE (anon stripped explicitly; cf. 048/052)
revoke execute on function public._forge_can_read_card(uuid) from public, anon;
revoke execute on function public._forge_is_card_field(text) from public, anon;
revoke execute on function public.forge_create_proposal(uuid, jsonb, text) from public, anon;
revoke execute on function public.forge_accept_proposal(uuid) from public, anon;
revoke execute on function public.forge_deny_proposal(uuid, text) from public, anon;
revoke execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) from public, anon;
revoke execute on function public.forge_resolve_comment(uuid, boolean) from public, anon;
revoke execute on function public.forge_apply_suggestion(uuid) from public, anon;
revoke execute on function public.forge_delete_comment(uuid) from public, anon;

grant execute on function public._forge_can_read_card(uuid) to authenticated;
grant execute on function public._forge_is_card_field(text) to authenticated;
grant execute on function public.forge_create_proposal(uuid, jsonb, text) to authenticated;
grant execute on function public.forge_accept_proposal(uuid) to authenticated;
grant execute on function public.forge_deny_proposal(uuid, text) to authenticated;
grant execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.forge_resolve_comment(uuid, boolean) to authenticated;
grant execute on function public.forge_apply_suggestion(uuid) to authenticated;
grant execute on function public.forge_delete_comment(uuid) to authenticated;
```

- [ ] **Step 2: Add the coupling comment to designCard.ts**

In `app/forge/lib/designCard.ts`, immediately above the `export type DesignCard = {` line, add:

```ts
// NOTE: the property keys below are mirrored by the SQL allowlist
// `_forge_is_card_field` in supabase/migrations/053_forge_review_layer.sql
// (used to validate field-anchored suggestions). Keep the two lists in sync.
```

- [ ] **Step 3: Self-check the SQL against 052 conventions**

Re-read the migration and confirm: every function is `security definer set search_path = ''`; every function appears in BOTH the revoke and grant blocks; both tables are RLS-enabled with select-only policies + anon revoke + authenticated select grant; `forge_accept_proposal` returns NULL (not raise) on the stale-base path. (No automated test — verification is the live apply + leak test in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/053_forge_review_layer.sql app/forge/lib/designCard.ts
git commit -m "feat(forge): migration 053 — review-layer schema, RLS, and RPCs"
```

---

## Task 2: `cardDiff.ts` pure module + tests

**Files:**
- Create: `app/forge/lib/cardDiff.ts`
- Test: `app/forge/lib/__tests__/cardDiff.test.ts`

**Interfaces produced:**
- `type FieldChange = { field: keyof DesignCard; label: string; kind: "added"|"removed"|"changed"; before: string|null; after: string|null }`
- `diffCards(before: DesignCard, after: DesignCard): FieldChange[]`
- `summarizeDiff(changes: FieldChange[]): string`
- `coerceFieldValue(field: string, text: string): unknown`
- `FIELD_LABELS: Record<string,string>`, `DIFF_FIELDS: (keyof DesignCard)[]`

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/cardDiff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffCards, summarizeDiff, coerceFieldValue } from "../cardDiff";

describe("diffCards", () => {
  it("detects a changed scalar field", () => {
    const d = diffCards({ name: "Goliath" }, { name: "David" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "name", kind: "changed", before: "Goliath", after: "David" });
  });

  it("marks a newly-present field as added and an emptied field as removed", () => {
    expect(diffCards({}, { reference: "1 Sam 17" })[0]).toMatchObject({ field: "reference", kind: "added", before: null });
    expect(diffCards({ reference: "1 Sam 17" }, {})[0]).toMatchObject({ field: "reference", kind: "removed", after: null });
  });

  it("compares array fields by joined display value", () => {
    const same = diffCards({ brigades: ["Blue", "Green"] }, { brigades: ["Blue", "Green"] });
    expect(same).toHaveLength(0);
    const changed = diffCards({ brigades: ["Blue"] }, { brigades: ["Blue", "Green"] });
    expect(changed[0]).toMatchObject({ field: "brigades", kind: "changed", before: "Blue", after: "Blue, Green" });
  });

  it("treats an empty base as all-added and returns [] when nothing changes", () => {
    const allAdded = diffCards({}, { name: "X", brigades: ["Blue"] });
    expect(allAdded.map((c) => c.field).sort()).toEqual(["brigades", "name"]);
    expect(diffCards({ name: "X" }, { name: "X" })).toEqual([]);
  });
});

describe("summarizeDiff", () => {
  it("summarizes none, few, and many changes", () => {
    expect(summarizeDiff([])).toBe("No field changes.");
    expect(summarizeDiff(diffCards({}, { name: "X" }))).toBe("Changed Name.");
    const many = diffCards({}, { name: "a", reference: "b", rarity: "c", flavorText: "d" });
    expect(summarizeDiff(many)).toMatch(/\+1 more\.$/);
  });
});

describe("coerceFieldValue", () => {
  it("coerces number, array, and scalar fields", () => {
    expect(coerceFieldValue("strength", "5")).toBe(5);
    expect(coerceFieldValue("strength", "nope")).toBeNull();
    expect(coerceFieldValue("brigades", "Blue, Green")).toEqual(["Blue", "Green"]);
    expect(coerceFieldValue("name", "  David  ")).toBe("David");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/cardDiff.test.ts`
Expected: FAIL — cannot find module `../cardDiff`.

- [ ] **Step 3: Implement `cardDiff.ts`**

Create `app/forge/lib/cardDiff.ts`:

```ts
// Pure diff of two DesignCard snapshots → per-field change descriptors + a
// one-line plain-language summary, plus a value coercer for suggestions. No DB,
// no UI. Drives the Current vs Proposed review diff.

import type { DesignCard } from "@/app/forge/lib/designCard";

export type FieldChange = {
  field: keyof DesignCard;
  label: string;
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
};

// Display order + friendly labels for the diffable DesignCard fields.
export const FIELD_LABELS: Record<string, string> = {
  name: "Name", cardType: "Type", alignment: "Alignment", brigades: "Brigade",
  strength: "Strength", toughness: "Toughness", strengthModifier: "Strength modifier",
  toughnessModifier: "Toughness modifier", class: "Class", icons: "Icons",
  identifiers: "Identifiers", specialAbility: "Special ability", reference: "Reference",
  legality: "Legality", rarity: "Rarity", flavorText: "Flavor text",
  artistCredit: "Artist", cardFrame: "Card frame",
};

export const DIFF_FIELDS = Object.keys(FIELD_LABELS) as (keyof DesignCard)[];

const ARRAY_FIELDS = new Set(["cardType", "brigades", "class", "icons", "identifiers"]);
const NUMBER_FIELDS = new Set(["strength", "toughness"]);

function display(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  return String(v);
}

export function diffCards(before: DesignCard, after: DesignCard): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of DIFF_FIELDS) {
    const b = display(before[f]);
    const a = display(after[f]);
    if (b === a) continue;
    const kind = b === null ? "added" : a === null ? "removed" : "changed";
    out.push({ field: f, label: FIELD_LABELS[f as string], kind, before: b, after: a });
  }
  return out;
}

export function summarizeDiff(changes: FieldChange[]): string {
  if (changes.length === 0) return "No field changes.";
  const labels = changes.map((c) => c.label);
  if (labels.length <= 3) return `Changed ${labels.join(", ")}.`;
  return `Changed ${labels.slice(0, 3).join(", ")} +${labels.length - 3} more.`;
}

// Best-effort coercion of a free-text suggestion value into the field's jsonb shape.
export function coerceFieldValue(field: string, text: string): unknown {
  const t = text.trim();
  if (NUMBER_FIELDS.has(field)) { const n = Number(t); return Number.isFinite(n) ? n : null; }
  if (ARRAY_FIELDS.has(field)) return t ? t.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return t;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/cardDiff.test.ts`
Expected: PASS (all 7 assertions/cases green).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/cardDiff.ts app/forge/lib/__tests__/cardDiff.test.ts
git commit -m "feat(forge): pure cardDiff module (field diff + summary + coercion)"
```

---

## Task 3: `proposals.ts` server actions + reads

**Files:**
- Create: `app/forge/lib/proposals.ts`

**Interfaces consumed:** `requireForge`/`requireElder` (`auth.ts`); RPCs from Task 1; `DesignCard` (`designCard.ts`).
**Interfaces produced:**
- `type ProposalRow = { id, cardId, baseVersionId, summary, status, proposedSnapshot, createdBy, createdAt, closedAt }`
- `type ProposalDiffData = { proposal: ProposalRow; current: DesignCard }`
- `createProposal(cardId, snapshot, summary): {ok:true;id}|{ok:false;error}`
- `acceptProposal(proposalId, cardId): {ok,error?}`
- `denyProposal(proposalId, cardId, reason): {ok,error?}`
- `listProposals(cardId): ProposalRow[]`
- `getOpenProposalDiffs(cardId): ProposalDiffData[]`

- [ ] **Step 1: Write `proposals.ts`**

Create `app/forge/lib/proposals.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type ProposalStatus = "open" | "accepted" | "denied" | "superseded";

export type ProposalRow = {
  id: string;
  cardId: string;
  baseVersionId: string | null;
  summary: string | null;
  status: ProposalStatus;
  proposedSnapshot: DesignCard;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
};

export type ProposalDiffData = { proposal: ProposalRow; current: DesignCard };

const COLS =
  "id, card_id, base_version_id, summary, status, proposed_snapshot, created_by, created_at, closed_at";

function toProposal(row: any): ProposalRow {
  return {
    id: row.id,
    cardId: row.card_id,
    baseVersionId: row.base_version_id ?? null,
    summary: row.summary ?? null,
    status: row.status,
    proposedSnapshot: (row.proposed_snapshot ?? {}) as DesignCard,
    createdBy: row.created_by,
    createdAt: row.created_at,
    closedAt: row.closed_at ?? null,
  };
}

export async function createProposal(
  cardId: string,
  snapshot: DesignCard,
  summary: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!summary.trim()) return { ok: false, error: "A summary is required" };
  const { data, error } = await ctx.supabase.rpc("forge_create_proposal", {
    p_card_id: cardId,
    p_snapshot: snapshot,
    p_summary: summary,
  });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create proposal" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true, id: data };
}

export async function acceptProposal(
  proposalId: string,
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_accept_proposal", {
    p_proposal_id: proposalId,
  });
  if (error) return { ok: false, error: "Could not accept proposal" };
  if (data === null) return { ok: false, error: "This proposal is out of date — please re-propose." };
  // Lifecycle change ripples to set/card/queue views.
  revalidatePath("/forge", "layout");
  return { ok: true };
}

export async function denyProposal(
  proposalId: string,
  cardId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };
  const { error } = await ctx.supabase.rpc("forge_deny_proposal", {
    p_proposal_id: proposalId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: "Could not deny proposal" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function listProposals(cardId: string): Promise<ProposalRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_proposals")
    .select(COLS)
    .eq("card_id", cardId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toProposal);
}

export async function getOpenProposalDiffs(cardId: string): Promise<ProposalDiffData[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: rows } = await ctx.supabase
    .from("card_proposals")
    .select(COLS)
    .eq("card_id", cardId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  const proposals = (rows ?? []).map(toProposal);
  const baseIds = proposals
    .map((p) => p.baseVersionId)
    .filter((x): x is string => !!x);
  const baseMap = new Map<string, DesignCard>();
  if (baseIds.length) {
    const { data: vers } = await ctx.supabase
      .from("card_versions")
      .select("id, data")
      .in("id", baseIds);
    for (const v of vers ?? []) baseMap.set(v.id, (v.data ?? {}) as DesignCard);
  }
  return proposals.map((p) => ({
    proposal: p,
    current: p.baseVersionId ? baseMap.get(p.baseVersionId) ?? {} : {},
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `app/forge/lib/proposals.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/forge/lib/proposals.ts
git commit -m "feat(forge): proposals server actions + reads"
```

---

## Task 4: `comments.ts` server actions + reads

**Files:**
- Create: `app/forge/lib/comments.ts`

**Interfaces produced:**
- `type CommentRow = { id, cardId, proposalId, field, suggestedValue, parentId, body, resolved, createdBy, createdAt }`
- `listComments(cardId): CommentRow[]`
- `addComment(input): {ok,error?}` where `input = { cardId; proposalId?; parentId?; field?; suggestedValue?; body }`
- `resolveComment(commentId, cardId, resolved): {ok,error?}`
- `applySuggestion(commentId, cardId): {ok,error?}`
- `deleteComment(commentId, cardId): {ok,error?}`

- [ ] **Step 1: Write `comments.ts`**

Create `app/forge/lib/comments.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";

export type CommentRow = {
  id: string;
  cardId: string;
  proposalId: string | null;
  field: string | null;
  suggestedValue: unknown;
  parentId: string | null;
  body: string;
  resolved: boolean;
  createdBy: string;
  createdAt: string;
};

const COLS =
  "id, card_id, proposal_id, field, suggested_value, parent_comment_id, body, resolved, created_by, created_at";

function toComment(row: any): CommentRow {
  return {
    id: row.id,
    cardId: row.card_id,
    proposalId: row.proposal_id ?? null,
    field: row.field ?? null,
    suggestedValue: row.suggested_value ?? null,
    parentId: row.parent_comment_id ?? null,
    body: row.body,
    resolved: !!row.resolved,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listComments(cardId: string): Promise<CommentRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_comments")
    .select(COLS)
    .eq("card_id", cardId)
    .order("created_at", { ascending: true });
  return (data ?? []).map(toComment);
}

export async function addComment(input: {
  cardId: string;
  proposalId?: string | null;
  parentId?: string | null;
  field?: string | null;
  suggestedValue?: unknown;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!input.body.trim()) return { ok: false, error: "Comment cannot be empty" };
  const { error } = await ctx.supabase.rpc("forge_add_comment", {
    p_card_id: input.cardId,
    p_proposal_id: input.proposalId ?? null,
    p_parent_id: input.parentId ?? null,
    p_field: input.field ?? null,
    p_suggested_value: input.suggestedValue ?? null,
    p_body: input.body,
  });
  if (error) return { ok: false, error: "Could not add comment" };
  revalidatePath(`/forge/cards/${input.cardId}`);
  return { ok: true };
}

export async function resolveComment(
  commentId: string,
  cardId: string,
  resolved: boolean
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_resolve_comment", {
    p_comment_id: commentId,
    p_resolved: resolved,
  });
  if (error) return { ok: false, error: "Could not update comment" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function applySuggestion(
  commentId: string,
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_apply_suggestion", {
    p_comment_id: commentId,
  });
  if (error) return { ok: false, error: "Could not apply suggestion" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function deleteComment(
  commentId: string,
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_delete_comment", {
    p_comment_id: commentId,
  });
  if (error) return { ok: false, error: "Could not delete comment" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `app/forge/lib/comments.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/forge/lib/comments.ts
git commit -m "feat(forge): comments + suggestions server actions"
```

---

## Task 5: `review.ts` — per-set review queue

**Files:**
- Create: `app/forge/lib/review.ts`

**Interfaces produced:**
- `type ReviewQueueItem = { cardId: string; title: string|null; status: string; openProposals: number; openSuggestions: number }`
- `getSetReviewQueue(setId): ReviewQueueItem[]`

- [ ] **Step 1: Write `review.ts`**

Create `app/forge/lib/review.ts`:

```ts
"use server";

import { requireForge } from "@/app/forge/lib/auth";

export type ReviewQueueItem = {
  cardId: string;
  title: string | null;
  status: string;
  openProposals: number;
  openSuggestions: number;
};

// Cards in a set that have open proposals or unresolved field-anchored suggestions.
// (General unresolved comments are NOT counted — only suggestions with a value.)
export async function getSetReviewQueue(setId: string): Promise<ReviewQueueItem[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, status")
    .eq("set_id", setId);
  const list = cards ?? [];
  if (list.length === 0) return [];
  const ids = list.map((c: any) => c.id);

  const { data: props } = await ctx.supabase
    .from("card_proposals")
    .select("card_id")
    .eq("status", "open")
    .in("card_id", ids);

  const { data: sugg } = await ctx.supabase
    .from("card_comments")
    .select("card_id")
    .eq("resolved", false)
    .not("field", "is", null)
    .not("suggested_value", "is", null)
    .in("card_id", ids);

  const pc = new Map<string, number>();
  for (const p of props ?? []) pc.set(p.card_id, (pc.get(p.card_id) ?? 0) + 1);
  const sc = new Map<string, number>();
  for (const s of sugg ?? []) sc.set(s.card_id, (sc.get(s.card_id) ?? 0) + 1);

  return list
    .map((c: any) => ({
      cardId: c.id,
      title: c.title ?? null,
      status: c.status,
      openProposals: pc.get(c.id) ?? 0,
      openSuggestions: sc.get(c.id) ?? 0,
    }))
    .filter((i) => i.openProposals > 0 || i.openSuggestions > 0)
    .sort((a, b) => b.openProposals + b.openSuggestions - (a.openProposals + a.openSuggestions));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `app/forge/lib/review.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/forge/lib/review.ts
git commit -m "feat(forge): per-set review queue read"
```

---

## Task 6: `ProposalDiff.tsx` + `CommentThread.tsx` client components

**Files:**
- Create: `app/forge/cards/[cardId]/ProposalDiff.tsx`
- Create: `app/forge/cards/[cardId]/CommentThread.tsx`

**Interfaces consumed:** `ProposalRow` (proposals.ts), `CommentRow` (comments.ts), `diffCards`/`summarizeDiff`/`coerceFieldValue`/`FIELD_LABELS`/`DIFF_FIELDS` (cardDiff.ts), `ForgeCardPreview` (props `{ card: DesignCard; artUrl?: string|null; className?: string }`), the comment/proposal actions.

- [ ] **Step 1: Write `ProposalDiff.tsx`**

Create `app/forge/cards/[cardId]/ProposalDiff.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { diffCards, summarizeDiff } from "@/app/forge/lib/cardDiff";
import { acceptProposal, denyProposal, type ProposalRow } from "@/app/forge/lib/proposals";
import type { DesignCard } from "@/app/forge/lib/designCard";

export default function ProposalDiff({
  proposal,
  current,
  artUrl,
  canReview,
}: {
  proposal: ProposalRow;
  current: DesignCard;
  artUrl: string | null;
  canReview: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const changes = diffCards(current, proposal.proposedSnapshot);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) alert(r.error ?? "Action failed");
      router.refresh();
    });

  return (
    <div className="rounded-md border p-3">
      <p className="text-sm font-medium">{proposal.summary ?? "Proposed change"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{summarizeDiff(changes)}</p>

      {/* Decision controls + change list render ABOVE the previews (mobile-first). */}
      {proposal.status === "open" && canReview && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            disabled={pending}
            onClick={() =>
              confirm(
                "Accept this proposal? It publishes a new version and overwrites the working draft."
              ) && run(() => acceptProposal(proposal.id, proposal.cardId))
            }
            className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50"
          >
            Accept
          </button>
          {!denying ? (
            <button
              disabled={pending}
              onClick={() => setDenying(true)}
              className="rounded-md border px-3 py-1"
            >
              Deny
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason…"
                className="rounded-md border bg-background px-2 py-1"
              />
              <button
                disabled={pending || !reason.trim()}
                onClick={() => run(() => denyProposal(proposal.id, proposal.cardId, reason))}
                className="rounded-md border px-2 py-1 disabled:opacity-50"
              >
                Confirm deny
              </button>
            </span>
          )}
        </div>
      )}

      {changes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {changes.map((c) => (
            <li key={c.field as string}>
              <span className="font-medium">{c.label}:</span>{" "}
              <span className="text-red-600 line-through">{c.before ?? "—"}</span>
              {" → "}
              <span className="text-emerald-700">{c.after ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Current</p>
          <ForgeCardPreview card={current} artUrl={artUrl} />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Proposed</p>
          <ForgeCardPreview card={proposal.proposedSnapshot} artUrl={artUrl} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `CommentThread.tsx`**

Create `app/forge/cards/[cardId]/CommentThread.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { coerceFieldValue, FIELD_LABELS, DIFF_FIELDS } from "@/app/forge/lib/cardDiff";
import {
  addComment,
  resolveComment,
  applySuggestion,
  deleteComment,
  type CommentRow,
} from "@/app/forge/lib/comments";

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export default function CommentThread({
  cardId,
  comments,
  canApply,
}: {
  cardId: string;
  comments: CommentRow[];
  canApply: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) alert(r.error ?? "Action failed");
      else after?.();
      router.refresh();
    });

  // Card-level thread only (proposal-anchored comments live under their proposal).
  const cardComments = comments.filter((c) => c.proposalId === null);
  const top = cardComments.filter((c) => c.parentId === null);
  const repliesOf = (id: string) => cardComments.filter((c) => c.parentId === id);

  const submitTop = () =>
    run(
      () =>
        addComment({
          cardId,
          body,
          field: field || null,
          suggestedValue: field && value.trim() ? coerceFieldValue(field, value) : undefined,
        }),
      () => {
        setBody("");
        setField("");
        setValue("");
      }
    );

  const Comment = ({ c, isReply }: { c: CommentRow; isReply?: boolean }) => (
    <div className={`rounded-md border p-2 text-sm ${isReply ? "ml-4" : ""} ${c.resolved ? "opacity-60" : ""}`}>
      {c.field && (
        <p className="text-xs text-muted-foreground">
          Suggestion · <span className="font-medium">{FIELD_LABELS[c.field] ?? c.field}</span>
          {c.suggestedValue != null && <> → {valueText(c.suggestedValue)}</>}
        </p>
      )}
      <p className="whitespace-pre-wrap">{c.body}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {c.field && c.suggestedValue != null && canApply && !c.resolved && (
          <button disabled={pending} onClick={() => run(() => applySuggestion(c.id, cardId))} className="text-emerald-700 hover:underline">
            Apply
          </button>
        )}
        <button disabled={pending} onClick={() => run(() => resolveComment(c.id, cardId, !c.resolved))} className="hover:underline">
          {c.resolved ? "Unresolve" : "Resolve"}
        </button>
        {!isReply && (
          <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="hover:underline">
            Reply
          </button>
        )}
        <button disabled={pending} onClick={() => confirm("Delete this comment?") && run(() => deleteComment(c.id, cardId))} className="text-red-600 hover:underline">
          Delete
        </button>
      </div>
      {replyTo === c.id && (
        <div className="mt-2 flex items-center gap-1">
          <input
            autoFocus
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Reply…"
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button
            disabled={pending || !replyBody.trim()}
            onClick={() =>
              run(
                () => addComment({ cardId, parentId: c.id, body: replyBody }),
                () => {
                  setReplyBody("");
                  setReplyTo(null);
                }
              )
            }
            className="rounded-md border px-2 py-1 text-sm disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Compose */}
      <div className="space-y-2 rounded-md border p-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Comment, or attach a field suggestion below…"
          className="h-16 w-full rounded-md border bg-background px-2 py-1 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={field} onChange={(e) => setField(e.target.value)} className="rounded-md border bg-background px-2 py-1">
            <option value="">No field</option>
            {DIFF_FIELDS.map((f) => (
              <option key={f as string} value={f as string}>
                {FIELD_LABELS[f as string]}
              </option>
            ))}
          </select>
          {field && (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Suggested value (comma-separate lists)"
              className="flex-1 rounded-md border bg-background px-2 py-1"
            />
          )}
          <button
            disabled={pending || !body.trim()}
            onClick={submitTop}
            className="ml-auto rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            Post
          </button>
        </div>
      </div>

      {top.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
      {top.map((c) => (
        <div key={c.id} className="space-y-2">
          <Comment c={c} />
          {repliesOf(c.id).map((r) => (
            <Comment key={r.id} c={r} isReply />
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing the two new files. (Watch the `strict:false` rule — `if (!r.ok) alert(r.error …)` is fine because the loose `{ok,error?}` shape always has `error`.)

- [ ] **Step 4: Commit**

```bash
git add "app/forge/cards/[cardId]/ProposalDiff.tsx" "app/forge/cards/[cardId]/CommentThread.tsx"
git commit -m "feat(forge): ProposalDiff + CommentThread review components"
```

---

## Task 7: `ReviewPanel.tsx` + page wiring + Propose control

**Files:**
- Create: `app/forge/cards/[cardId]/ReviewPanel.tsx`
- Modify: `app/forge/cards/[cardId]/page.tsx`
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx`

**Interfaces consumed:** `getOpenProposalDiffs`, `listProposals`, `ProposalDiffData`, `ProposalRow` (proposals.ts); `listComments`, `CommentRow` (comments.ts); `createProposal` (proposals.ts); `ForgeCardFull` (cards.ts); `ProposalDiff`, `CommentThread` (Task 6).

- [ ] **Step 1: Write `ReviewPanel.tsx`**

Create `app/forge/cards/[cardId]/ReviewPanel.tsx`:

```tsx
"use client";

import ProposalDiff from "./ProposalDiff";
import CommentThread from "./CommentThread";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { ProposalDiffData, ProposalRow } from "@/app/forge/lib/proposals";
import type { CommentRow } from "@/app/forge/lib/comments";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  accepted: "Accepted",
  denied: "Denied",
  superseded: "Superseded",
};

export default function ReviewPanel({
  card,
  openDiffs,
  proposals,
  comments,
  canReview,
}: {
  card: ForgeCardFull;
  openDiffs: ProposalDiffData[];
  proposals: ProposalRow[];
  comments: CommentRow[];
  canReview: boolean;
}) {
  const artUrl = card.hasArt ? `/forge/api/art/${card.id}` : null;
  const history = proposals.filter((p) => p.status !== "open");

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
                canReview={canReview}
              />
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Proposal history</h2>
          <ul className="space-y-1 text-xs">
            {history.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border px-2 py-1">
                <span>{p.summary ?? "Proposed change"}</span>
                <span className="text-muted-foreground">{STATUS_LABEL[p.status] ?? p.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Comments &amp; suggestions</h2>
        <CommentThread cardId={card.id} comments={comments} canApply={canReview} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire `page.tsx`**

Replace the entire contents of `app/forge/cards/[cardId]/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { listSets } from "@/app/forge/lib/sets";
import { getOpenProposalDiffs, listProposals } from "@/app/forge/lib/proposals";
import { listComments } from "@/app/forge/lib/comments";
import StudioEditor from "./StudioEditor";
import ReviewPanel from "./ReviewPanel";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ cardId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { cardId } = await params;
  const card = await getCard(cardId);
  if (!card) notFound();

  const inSet = card.setId !== null;
  const sets = inSet ? [] : await listSets();
  const [openDiffs, proposals, comments] = inSet
    ? await Promise.all([getOpenProposalDiffs(cardId), listProposals(cardId), listComments(cardId)])
    : [[], [], []];
  const canReview = ctx.role === "elder" || ctx.role === "superadmin";

  return (
    <>
      <StudioEditor card={card} sets={sets} />
      {inSet && (
        <ReviewPanel
          card={card}
          openDiffs={openDiffs}
          proposals={proposals}
          comments={comments}
          canReview={canReview}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Add the "Propose changes" control to `StudioEditor.tsx`**

In `app/forge/cards/[cardId]/StudioEditor.tsx`:

(a) Update the imports block at the top — add `useRouter` and `createProposal`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { saveCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import { createProposal } from "@/app/forge/lib/proposals";
import type { DesignCard } from "@/app/forge/lib/designCard";
import FullModeForm from "./FullModeForm";
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
```

(b) Inside the component, after the `const update = (...)` line, add the propose state + handler:

```tsx
  const router = useRouter();
  const [proposing, setProposing] = useState(false);
  const [proposeSummary, setProposeSummary] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);

  const submitProposal = async () => {
    if (!proposeSummary.trim()) return;
    setProposeBusy(true);
    const r = await createProposal(card.id, snapshot, proposeSummary);
    setProposeBusy(false);
    if (r.ok === false) {
      alert(r.error);
      return;
    }
    setProposing(false);
    setProposeSummary("");
    router.refresh();
  };
```

(c) Replace the existing `<LifecycleControls card={card} sets={sets} />` line with the control plus a propose row (only for cards in a set):

```tsx
        <LifecycleControls card={card} sets={sets} />
        {card.setId &&
          (proposing ? (
            <div className="flex items-center gap-1 text-xs">
              <input
                autoFocus
                value={proposeSummary}
                onChange={(e) => setProposeSummary(e.target.value)}
                placeholder="Summarize your proposed change…"
                className="flex-1 rounded-md border bg-background px-2 py-1"
              />
              <button
                disabled={proposeBusy || !proposeSummary.trim()}
                onClick={submitProposal}
                className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50"
              >
                Submit proposal
              </button>
              <button onClick={() => setProposing(false)} className="rounded-md border px-2 py-1">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setProposing(true)}
              className="self-start rounded-md border px-3 py-1 text-xs"
            >
              Propose changes for review
            </button>
          ))}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing the studio files. (Confirm `createProposal` is consumed with `if (r.ok === false)` — never an `else` branch.)

- [ ] **Step 5: Commit**

```bash
git add "app/forge/cards/[cardId]/ReviewPanel.tsx" "app/forge/cards/[cardId]/page.tsx" "app/forge/cards/[cardId]/StudioEditor.tsx"
git commit -m "feat(forge): review panel on the studio + Propose-changes control"
```

---

## Task 8: Review-queue route + set nav tab

**Files:**
- Create: `app/forge/sets/[setId]/review/page.tsx`
- Create: `app/forge/sets/[setId]/review/ReviewQueue.tsx`
- Modify: `app/forge/sets/[setId]/layout.tsx`

**Interfaces consumed:** `getSetReviewQueue`, `ReviewQueueItem` (review.ts).

- [ ] **Step 1: Write `ReviewQueue.tsx`**

Create `app/forge/sets/[setId]/review/ReviewQueue.tsx`:

```tsx
import Link from "next/link";
import type { ReviewQueueItem } from "@/app/forge/lib/review";

export default function ReviewQueue({ items }: { items: ReviewQueueItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing needs review right now.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.cardId}>
          <Link
            href={`/forge/cards/${i.cardId}`}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
          >
            <span className="font-medium">{i.title ?? "Untitled card"}</span>
            <span className="flex gap-2 text-xs text-muted-foreground">
              {i.openProposals > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                  {i.openProposals} proposal{i.openProposals === 1 ? "" : "s"}
                </span>
              )}
              {i.openSuggestions > 0 && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">
                  {i.openSuggestions} suggestion{i.openSuggestions === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Write the route `page.tsx`**

Create `app/forge/sets/[setId]/review/page.tsx`:

```tsx
import { getSetReviewQueue } from "@/app/forge/lib/review";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  const items = await getSetReviewQueue(setId);
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Review queue</h2>
      <ReviewQueue items={items} />
    </div>
  );
}
```

- [ ] **Step 3: Add the "Review" nav tab in `layout.tsx`**

In `app/forge/sets/[setId]/layout.tsx`, change the `tabs` array to include Review (after Progress):

```tsx
  const tabs = [
    { href: `/forge/sets/${setId}/cards`, label: "Cards" },
    { href: `/forge/sets/${setId}/notes`, label: "Notes" },
    { href: `/forge/sets/${setId}/progress`, label: "Progress" },
    { href: `/forge/sets/${setId}/review`, label: "Review" },
  ];
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing the review route/layout.

- [ ] **Step 5: Commit**

```bash
git add "app/forge/sets/[setId]/review/page.tsx" "app/forge/sets/[setId]/review/ReviewQueue.tsx" "app/forge/sets/[setId]/layout.tsx"
git commit -m "feat(forge): per-set review queue route + nav tab"
```

---

## Task 9: Extend the anon-leak guardrail

**Files:**
- Modify: `__tests__/forge-anon-leak.test.ts`

- [ ] **Step 1: Add the new tables to `FORGE_TABLES`**

In `__tests__/forge-anon-leak.test.ts`, change the `FORGE_TABLES` array to:

```ts
const FORGE_TABLES = [
  "playtest_members", "forge_invites", "forge_audit", "forge_cards",
  "forge_sets", "forge_set_elders", "forge_set_grants", "card_versions",
  "card_proposals", "card_comments",
];
```

- [ ] **Step 2: Add the new functions to `FORGE_RPCS`**

Append these entries to the end of the `FORGE_RPCS` array (before the closing `];`):

```ts
    ["_forge_can_read_card", { p_card_id: "00000000-0000-0000-0000-000000000000" }],
    ["_forge_is_card_field", { p_field: "name" }],
    ["forge_create_proposal", { p_card_id: "00000000-0000-0000-0000-000000000000", p_snapshot: {}, p_summary: "x" }],
    ["forge_accept_proposal", { p_proposal_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_deny_proposal", { p_proposal_id: "00000000-0000-0000-0000-000000000000", p_reason: "x" }],
    ["forge_add_comment", { p_card_id: "00000000-0000-0000-0000-000000000000", p_proposal_id: null, p_parent_id: null, p_field: null, p_suggested_value: null, p_body: "x" }],
    ["forge_resolve_comment", { p_comment_id: "00000000-0000-0000-0000-000000000000", p_resolved: true }],
    ["forge_apply_suggestion", { p_comment_id: "00000000-0000-0000-0000-000000000000" }],
    ["forge_delete_comment", { p_comment_id: "00000000-0000-0000-0000-000000000000" }],
```

- [ ] **Step 3: Run the hermetic unit suite to confirm nothing breaks**

Run: `npx vitest run __tests__/forge-anon-leak.test.ts`
Expected: the `describe.runIf(ENABLED)` block is SKIPPED (FORGE_LEAK_TEST not set in the default run) — 0 failures. (The live run happens in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add __tests__/forge-anon-leak.test.ts
git commit -m "test(forge): extend anon-leak guardrail for review-layer tables + RPCs"
```

---

## Task 10: Apply migration, full verification, manual smoke

**Files:** none (verification only).

- [ ] **Step 1: ORCHESTRATOR applies migration 053 to prod**

This step is performed by the orchestrator (not a subagent), with explicit user authorization, via the Supabase MCP `apply_migration` (name `forge_review_layer`, the contents of `supabase/migrations/053_forge_review_layer.sql`). Confirm success.

- [ ] **Step 2: Live security guardrail**

Run: `FORGE_LEAK_TEST=1 npm run test:security`
Expected: PASS — anon sees zero rows in all tables (including `card_proposals`, `card_comments`) and cannot execute any Forge RPC (including the 9 new entries).

- [ ] **Step 3: Supabase advisors**

Run the Supabase MCP `get_advisors` (type `security`) and confirm **no new** findings vs the 052 baseline (RLS enabled on both new tables; no anon-exposed functions).

- [ ] **Step 4: Full unit suite**

Run: `npm test`
Expected: PASS except the known pre-existing unrelated `store-route.test.ts` failure. `cardDiff.test.ts` is green.

- [ ] **Step 5: Production build (typecheck)**

Run: `npm run build`
Expected: clean build — all new routes/components compile; no `strict:false` union-narrowing type errors.

- [ ] **Step 6: Manual signed-in smoke (record results)**

As an elder on a set, on a set card with a published version:
1. Edit a field → **Propose changes for review** → enter a summary → Submit. The proposal appears under "Open proposals" with a Current/Proposed diff and the change list.
2. **Accept** it → confirms → a new version is published, status shows `Playtesting`, the working draft reflects the change, the proposal moves to history as "Accepted".
3. Create a second proposal → **Deny** with a reason → it moves to history "Denied"; the reason shows as a comment.
4. Post a **comment**; post a **field suggestion** (e.g. Strength → 5) → **Apply** → the working draft updates and the suggestion resolves.
5. Visit `/forge/sets/[setId]/review` → the card with the open suggestion/proposal is listed with counts; a private idea (`/forge/cards/[id]` with no set) shows **no** ReviewPanel.

- [ ] **Step 7: Update the project memory**

Append a `1b.1` status entry to `project_forge_playtesting.md` (and confirm `MEMORY.md` still points to it): branch, PR, migration 053 applied, gates green, manual smoke result, any logged follow-ups.

---

## Self-Review (completed during planning)

- **Spec coverage:** proposals (create/diff/accept/deny) → Tasks 1,3,6,7; comments + suggestions (add/resolve/apply/delete, threading) → Tasks 1,4,6,7; review queue → Tasks 5,8; security spine + leak test → Tasks 1,9,10; pure diff → Task 2. The deferred items (Realtime, art proposals, N>1, reopen, timeline UI, playtesters) are out of scope by design.
- **Placeholder scan:** none — every code/SQL step is complete.
- **Type consistency:** `ProposalRow`/`ProposalDiffData`/`CommentRow`/`ReviewQueueItem` are defined in Tasks 3/4/5 and consumed with matching shapes in Tasks 6/7/8. Actions return either `{ok:true;id}|{ok:false;error}` (createProposal — consumed via `r.ok === false`) or the loose `{ok,error?}` (everything else — consumed via `if (!r.ok)`), never an `else`-narrowed union. `ForgeCardPreview` is called with its real `{card, artUrl}` props. The SQL field allowlist, `FIELD_LABELS`/`DIFF_FIELDS`, and the Global-Constraints list are the same 18 keys.
