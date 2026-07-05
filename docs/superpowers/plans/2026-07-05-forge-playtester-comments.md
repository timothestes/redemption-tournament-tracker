# Forge Playtester Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let granted playtesters leave plain comments + replies on the cards they can already view, without any ability to propose changes.

**Architecture:** A new DB guard `_forge_can_comment_card` widens comment read/write to granted playtesters (mirroring the 057 reveal policy) while `_forge_can_read_card` — and therefore all of proposals — stays elder-only. The playtester UI reuses the existing `card_comments` table via a lazy server action and a focused client component mounted in the reveal-card modal. Verification is end-to-end with real playtester + elder sessions (the codebase tests pure helpers with Vitest and RLS/UI behavior via Playwright).

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (PostgreSQL + RLS + `security definer` RPCs), Vitest, Playwright.

## Global Constraints

- Do **not** modify `_forge_can_read_card`, `card_proposals`, or `forge_create_proposal` — proposals stay elder-only.
- New/recreated SQL functions are `security definer` with `set search_path = ''` and fully-schema-qualified names (`public.…`, `auth.uid()`), matching migrations 053/057.
- SQL EXECUTE grants: `revoke … from public, anon; grant … to authenticated;` for every new/recreated function.
- Playtesters may post only plain, card-level comments and replies — no `proposal_id`, `field`, or `suggested_value` — enforced in the RPC, not just the UI.
- Playtesters see only card-level comments (`proposal_id IS NULL`); proposal-anchored comments stay hidden.
- Commit messages use `feat(forge):` / `fix(forge):` and end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens on `main` (user-authorized). Do not stage the pre-existing uncommitted changes (`app/forge/lib/members.ts`, `app/forge/admin/AdminConsole.tsx`, `supabase/migrations/069_*`) — stage only files listed per task.

---

### Task 1: Migration — `_forge_can_comment_card`, widened comment SELECT, playtester-safe `forge_add_comment`

**Files:**
- Create: `supabase/migrations/070_forge_playtester_comments.sql`

**Interfaces:**
- Produces (SQL): `public._forge_can_comment_card(p_card_id uuid) returns boolean`; recreated `public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) returns uuid`; recreated policy `card_comments_select` on `public.card_comments`.
- Consumes (existing): `public._forge_can_read_card(uuid)`, `public._forge_is_card_field(text)`, `public.is_forge_superadmin()`, `public.is_forge_set_elder(uuid)`, `public.is_forge_set_granted(uuid)`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/070_forge_playtester_comments.sql`:

```sql
-- 070_forge_playtester_comments.sql
-- Let GRANTED playtesters leave plain card-level comments (+ replies) on cards they
-- can already view, WITHOUT any proposal ability. Adds a broader comment guard
-- _forge_can_comment_card (owner/super/set-elder, PLUS granted playtester on a shared
-- playtesting/approved card), widens the card_comments SELECT policy so playtesters
-- see card-level comments only (proposal_id IS NULL), and updates forge_add_comment to
-- accept playtester comments while blocking field/suggestion/proposal attachments for
-- non-elders. _forge_can_read_card, card_proposals, and forge_create_proposal are
-- UNTOUCHED (proposals stay elder-only).
-- Builds on 053 (review layer) and 057 (granted-playtester reveal).

-- 1) Broader comment guard: elder read-guard branches OR granted playtester on a
--    shared card (mirrors the forge_cards granted-read branch from 057).
create or replace function public._forge_can_comment_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id))
           or (c.set_id is not null
               and c.status in ('playtesting','approved')
               and public.is_forge_set_granted(c.set_id)))
  );
$$;

-- 2) card_comments SELECT: elders see everything; granted playtesters see card-level
--    (proposal_id IS NULL) comments only. Proposal-anchored comments stay hidden.
drop policy if exists "card_comments_select" on public.card_comments;
create policy "card_comments_select" on public.card_comments
  for select to authenticated
  using (
    public._forge_can_read_card(card_comments.card_id)
    or (card_comments.proposal_id is null
        and public._forge_can_comment_card(card_comments.card_id))
  );

-- 3) forge_add_comment: widen the top guard to _forge_can_comment_card, but restrict
--    non-elders (granted playtesters) to plain card-level comments/replies.
create or replace function public.forge_add_comment(
  p_card_id uuid, p_proposal_id uuid, p_parent_id uuid,
  p_field text, p_suggested_value jsonb, p_body text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_is_elder boolean; v_parent public.card_comments%rowtype;
begin
  if not public._forge_can_comment_card(p_card_id) then
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

  -- Elders satisfy the strict read-guard; granted playtesters do not.
  v_is_elder := public._forge_can_read_card(p_card_id);
  if not v_is_elder then
    if p_proposal_id is not null or p_field is not null or p_suggested_value is not null then
      raise exception 'playtesters can only leave plain comments';
    end if;
    if p_parent_id is not null then
      select * into v_parent from public.card_comments where id = p_parent_id;
      if not found or v_parent.card_id <> p_card_id or v_parent.proposal_id is not null then
        raise exception 'invalid parent comment';
      end if;
    end if;
  end if;

  insert into public.card_comments
    (card_id, proposal_id, parent_comment_id, field, suggested_value, body, created_by)
  values
    (p_card_id, p_proposal_id, p_parent_id, p_field, p_suggested_value, btrim(p_body), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- 4) Lock down EXECUTE (mirror 053). create-or-replace preserves ACLs; restate for clarity.
revoke execute on function public._forge_can_comment_card(uuid) from public, anon;
grant  execute on function public._forge_can_comment_card(uuid) to authenticated;
revoke execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) from public, anon;
grant  execute on function public.forge_add_comment(uuid, uuid, uuid, text, jsonb, text) to authenticated;
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

Use the Supabase MCP `apply_migration` tool with name `forge_playtester_comments` and the SQL body above. (This targets the repo's linked project — confirm it is the intended one before applying.)
Expected: success, no error.

- [ ] **Step 3: Verify the objects exist**

Use the Supabase MCP `execute_sql` tool:

```sql
select
  (select count(*) from pg_proc where proname = '_forge_can_comment_card') as fn_exists,
  (select pg_get_expr(polqual, polrelid)
     from pg_policy
     where polname = 'card_comments_select'
       and polrelid = 'public.card_comments'::regclass) as select_using;
```
Expected: `fn_exists = 1`, and `select_using` mentions both `_forge_can_read_card` and `_forge_can_comment_card`.

Behavioral checks (a granted playtester can insert a plain comment; is rejected on field/suggestion/proposal; cannot read proposal-anchored comments; cannot `forge_create_proposal`) require a real playtester JWT and are covered in **Task 4** — `auth.uid()` is NULL under the service-role MCP connection, so they cannot be exercised here.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/070_forge_playtester_comments.sql
git commit -m "feat(forge): DB guard for playtester card comments

Add _forge_can_comment_card (granted playtesters on shared cards), widen
card_comments SELECT to card-level for playtesters, and restrict
forge_add_comment so non-elders can only post plain comments/replies.
Proposals stay elder-only (_forge_can_read_card untouched).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Server actions — lazy `listCardComments`, DRY author-name resolution, playtester-deletable comments

**Files:**
- Modify: `app/forge/lib/comments.ts`

**Interfaces:**
- Produces: `listCardComments(cardId: string): Promise<CommentRow[]>` — card-level (`proposal_id === null`) comments with `authorName` resolved. `deleteComment(commentId: string, cardId: string): Promise<{ ok: boolean; error?: string }>` now callable by any Forge member (RPC still enforces author-or-elder).
- Consumes: existing `requireForge` from `@/app/forge/lib/auth`, the `card_comments` table, `playtest_members`, and RPC `forge_delete_comment`.

- [ ] **Step 1: Extract a shared author-name resolver**

In `app/forge/lib/comments.ts`, add this private helper above `listComments` (it factors out the name-resolution block currently inline in `listComments`):

```ts
async function resolveAuthorNames(
  ctx: NonNullable<Awaited<ReturnType<typeof requireForge>>>,
  rows: CommentRow[]
): Promise<CommentRow[]> {
  if (rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r.createdBy))];
  const { data: members } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, display_name")
    .in("user_id", ids);
  const names = new Map((members ?? []).map((m: any) => [m.user_id, m.display_name]));
  return rows.map((r) => ({ ...r, authorName: names.get(r.createdBy) ?? "Forge member" }));
}
```

- [ ] **Step 2: Route `listComments` through the shared resolver**

Replace the body of `listComments` after the `rows` mapping (the block from `if (rows.length === 0) return rows;` through the final `return rows.map(...)`) with:

```ts
  return resolveAuthorNames(ctx, rows);
```

So `listComments` reads:

```ts
export async function listComments(cardId: string): Promise<CommentRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_comments")
    .select(COLS)
    .eq("card_id", cardId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []).map(toComment);
  return resolveAuthorNames(ctx, rows);
}
```

- [ ] **Step 3: Add `listCardComments` (card-level only) for the playtester modal**

Add below `listComments`:

```ts
// Card-level thread only (proposal_id IS NULL) with author names. Used by the
// playtester reveal modal; runs under the caller's session so RLS applies.
export async function listCardComments(cardId: string): Promise<CommentRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_comments")
    .select(COLS)
    .eq("card_id", cardId)
    .is("proposal_id", null)
    .order("created_at", { ascending: true });
  const rows = (data ?? []).map(toComment);
  return resolveAuthorNames(ctx, rows);
}
```

- [ ] **Step 4: Let comment authors (incl. playtesters) delete their own comment**

In `deleteComment`, change the gate from `requireElder()` to `requireForge()` (the `forge_delete_comment` RPC still restricts to author or set-elder/super, so this only lets a playtester delete a comment they authored):

```ts
export async function deleteComment(
  commentId: string,
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_delete_comment", {
    p_comment_id: commentId,
  });
  if (error) return { ok: false, error: "Could not delete comment" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}
```

Leave `requireElder` imported (still used by `applySuggestion`). Do not change `resolveComment`, `applySuggestion`, `addComment`, or `listUnresolvedCommentCounts`.

- [ ] **Step 5: Run the existing test suite (nothing should regress)**

Run: `npm test`
Expected: PASS (this task adds no new tests; it is a pure refactor + additive export, exercised end-to-end in Task 4).

- [ ] **Step 6: Commit**

```bash
git add app/forge/lib/comments.ts
git commit -m "feat(forge): listCardComments + author-deletable comments

Add a card-level-only listCardComments for the playtester modal, DRY the
author-name resolution, and widen deleteComment to any Forge member (RPC
still enforces author-or-elder) so playtesters can delete their own comments.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: UI — `PlaytesterComments` component wired into the reveal-card modal

**Files:**
- Create: `app/forge/play/[setId]/PlaytesterComments.tsx`
- Modify: `app/forge/play/[setId]/RevealGrid.tsx`
- Modify: `app/forge/play/[setId]/page.tsx`

**Interfaces:**
- Consumes: `listCardComments`, `addComment`, `deleteComment`, `CommentRow` from `@/app/forge/lib/comments`; `timeAgo` from `@/app/forge/lib/relativeTime`; `Button` from `@/components/ui/button`.
- Produces: `PlaytesterComments({ cardId, currentUserId }: { cardId: string; currentUserId: string })`; `RevealGrid` gains a required `currentUserId: string` prop.

- [ ] **Step 1: Create the `PlaytesterComments` component**

Create `app/forge/play/[setId]/PlaytesterComments.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addComment, deleteComment, listCardComments, type CommentRow } from "@/app/forge/lib/comments";
import { timeAgo } from "@/app/forge/lib/relativeTime";

export default function PlaytesterComments({
  cardId,
  currentUserId,
}: {
  cardId: string;
  currentUserId: string;
}) {
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [pending, start] = useTransition();

  const load = () => listCardComments(cardId).then(setComments);
  // Reload whenever the open card changes.
  useEffect(() => {
    setComments(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        alert(r.error ?? "Action failed");
        return;
      }
      after?.();
      await load();
    });

  const roots = (comments ?? []).filter((c) => c.parentId === null);
  const repliesOf = (id: string) => (comments ?? []).filter((c) => c.parentId === id);

  const Comment = ({ c, isReply }: { c: CommentRow; isReply?: boolean }) => (
    <div className={`rounded-md border p-2 text-sm ${isReply ? "ml-4" : ""}`}>
      <p className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{c.authorName ?? "Forge member"}</span>
        {" · "}
        {timeAgo(c.createdAt)}
      </p>
      <p className="whitespace-pre-wrap">{c.body}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {!isReply && (
          <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="hover:underline">
            Reply
          </button>
        )}
        {c.createdBy === currentUserId && (
          <button
            disabled={pending}
            onClick={() => confirm("Delete this comment?") && run(() => deleteComment(c.id, cardId))}
            className="text-destructive hover:underline"
          >
            Delete
          </button>
        )}
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
          <Button
            variant="outline"
            size="sm"
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
          >
            Send
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border p-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a comment for the designers…"
          className="h-16 w-full rounded-md border bg-background px-2 py-1 text-sm"
        />
        <Button
          size="sm"
          className="ml-auto flex"
          disabled={pending || !body.trim()}
          onClick={() => run(() => addComment({ cardId, body }), () => setBody(""))}
        >
          Post
        </Button>
      </div>

      {comments === null ? (
        <p className="text-xs text-muted-foreground">Loading comments…</p>
      ) : roots.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comments yet. Be the first.</p>
      ) : (
        roots.map((c) => (
          <div key={c.id} className="space-y-2">
            <Comment c={c} />
            {repliesOf(c.id).map((r) => (
              <Comment key={r.id} c={r} isReply />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount comments in the reveal modal and accept `currentUserId`**

In `app/forge/play/[setId]/RevealGrid.tsx`:

1. Add the import at the top (after the `ForgeCardFace` import):

```tsx
import PlaytesterComments from "./PlaytesterComments";
```

2. Change the component signature to accept `currentUserId`:

```tsx
export default function RevealGrid({ items, currentUserId }: { items: RevealItem[]; currentUserId: string }) {
```

3. Replace the modal block (the `{active && ( … )}` at the end of the returned JSX) with a card-plus-comments layout:

```tsx
      {active && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={() => setActive(null)}>
          <div
            className="my-auto flex w-full max-w-3xl flex-col gap-4 rounded-lg bg-background p-4 sm:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto w-full max-w-sm shrink-0 sm:mx-0 sm:w-64">
              <ForgeCardFace name={active.data.name ?? null} rawText={cardRawText(active.data)} finishedUrl={active.finishedUrl} artUrl={active.artUrl} className="w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Comments</h2>
                <button type="button" aria-label="Close" onClick={() => setActive(null)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <PlaytesterComments cardId={active.cardId} currentUserId={currentUserId} />
            </div>
          </div>
        </div>
      )}
```

(`X` is already imported in this file.)

- [ ] **Step 3: Pass `currentUserId` from the page**

In `app/forge/play/[setId]/page.tsx`, pass the caller's id to `RevealGrid`. `ctx` (from `requireForge()`) is already in scope. Change:

```tsx
      <RevealGrid items={items} />
```

to:

```tsx
      <RevealGrid items={items} currentUserId={ctx.user.id} />
```

- [ ] **Step 4: Type/compile check the changed files**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors in `app/forge/play/[setId]/PlaytesterComments.tsx`, `RevealGrid.tsx`, or `page.tsx`. (If the project has a pre-existing baseline of unrelated errors, confirm none reference these three files.)

- [ ] **Step 5: Commit**

```bash
git add app/forge/play/[setId]/PlaytesterComments.tsx app/forge/play/[setId]/RevealGrid.tsx app/forge/play/[setId]/page.tsx
git commit -m "feat(forge): playtester comment thread in the reveal-card modal

Add PlaytesterComments (plain comments + replies, delete-own) and mount it
beside the card face in the reveal modal; thread the caller id through
RevealGrid so authors can delete their own comments.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: End-to-end verification (positive + negative)

**Files:**
- Temporary Playwright script under the scratchpad (not committed) — or reuse the project's `verify` skill harness.

**Interfaces:**
- Consumes: real Supabase sessions for one granted playtester and one elder (per the `verify` skill and `reference_e2e_auth_and_forge_membership.md` memory: mint chunked `sb-` cookies via admin `generate_link`/`verify`; `playtest_members` gates the Forge). Requires a set with at least one `playtesting` card and the playtester granted on that set.

- [ ] **Step 1: Confirm the unit suite is green**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Positive path — playtester posts, elder sees it**

Using the `verify` skill against `npm run dev`:
1. Sign in as a **granted playtester**; go to `/forge/play/<setId>`; open a `playtesting` card.
2. Verify the modal shows the card **and** a Comments panel. Post a comment (e.g. "Felt too strong vs speed"). Expected: it appears in the thread attributed to the playtester with a relative timestamp.
3. Reply to your own comment. Expected: the reply renders indented under it.
4. Delete the reply via its Delete button. Expected: it disappears after reload.
5. Sign in as an **elder**; open the same card in the studio (`/forge/cards/<cardId>`). Expected: the playtester's comment appears in the `ReviewPanel` card-level thread.

- [ ] **Step 3: Negative paths — no propose ability, no leakage**

Using the playtester's session token directly (fetch/SQL as that user, per the verify harness):
1. Call `forge_add_comment` with a non-null `p_field`/`p_suggested_value`. Expected: error `playtesters can only leave plain comments`.
2. Call `forge_create_proposal` on the card. Expected: error `not authorized to propose on this card` (unchanged elder guard).
3. `select … from card_comments where card_id = <card> and proposal_id is not null` as the playtester. Expected: **zero rows** (proposal-anchored comments hidden).
4. As a **non-granted** playtester (no grant on the set), attempt to read/insert a comment on that card. Expected: read returns zero rows; `forge_add_comment` errors `not authorized to comment on this card`.

- [ ] **Step 4: Record results**

Note pass/fail for each check above in the task's completion summary. If any fail, stop and fix the responsible task before marking the plan complete.

---

## Self-Review

**Spec coverage:**
- Broader comment guard, widened `card_comments` SELECT (card-level for playtesters), playtester-safe `forge_add_comment`, grants → Task 1. ✅
- `listCardComments`, attribution, delete-own → Task 2. ✅
- `PlaytesterComments` component + reveal-modal mount, no proposals/field/apply → Task 3. ✅
- Proposals/studio/`_forge_can_read_card` untouched → enforced by Global Constraints; no task modifies them. ✅
- Verification (SQL positive/negative, existing suite green, E2E playtester→elder) → Tasks 1 (object existence) + 4 (behavior). ✅
- Out-of-scope (realtime for playtesters, grid badges, field suggestions) → not planned. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. ✅

**Type consistency:** `listCardComments(cardId: string): Promise<CommentRow[]>`, `deleteComment(commentId, cardId)`, `PlaytesterComments({ cardId, currentUserId })`, and `RevealGrid({ items, currentUserId })` are used identically wherever referenced. `CommentRow` fields (`parentId`, `createdBy`, `createdAt`, `authorName`, `body`, `id`) match `app/forge/lib/comments.ts`. ✅
