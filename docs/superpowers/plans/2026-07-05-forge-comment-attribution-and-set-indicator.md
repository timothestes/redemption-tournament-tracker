# Forge — Comment Attribution & Set-Page Comment Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show who wrote each Forge card comment (name + relative time), and put an unresolved-comment count badge on cards in the set-page grid.

**Architecture:** Both features are additive, read-only over existing columns and RLS — no migration, no RPC, no new table. Attribution resolves the already-stored `card_comments.created_by` UUID to `playtest_members.display_name` (member-readable) and renders it in the existing comment thread. The indicator adds one server read that counts each card's unresolved card-level comments (`proposal_id IS NULL`, `resolved = false`) and threads the counts through the existing `page → SetCardsBrowser → ForgeCardGrid` chain to a small badge on the card face.

**Tech Stack:** Next.js 15 (App Router, RSC + server actions), React 19, TypeScript, Supabase (RLS), Tailwind, lucide-react, Vitest.

## Global Constraints

- **No schema/RPC/migration.** Every change reads existing columns via existing RLS.
- Both features are **elder/superadmin-facing only** — `/forge/cards/[cardId]` and `/forge/sets/[setId]/cards` already redirect playtesters (`ctx.role === "playtester"` → `redirect("/forge/play")`). Do not remove those guards.
- Repo `tsconfig` has `strict: false` — type errors surface only in `npm run build`, not in vitest/esbuild. The final verification task runs a full build.
- Design system: neutral grayscale palette; **primary green is reserved for hover/active/CTA, never at-rest**. The badge must be neutral at rest.
- `"use server"` files (e.g. `comments.ts`) may only export `async` functions — no pure sync exports. Pure helpers live in their own non-`"use server"` module.
- Missing/removed/never-onboarded authors fall back to the string `"Forge member"` (matches `forgeDecks.ts`).
- New display badge appears **only on the set cards grid**. `ForgeCardGrid` is shared with the Ideas library ([app/forge/ideas/IdeasLibrary.tsx](../../../app/forge/ideas/IdeasLibrary.tsx)), which must keep passing no counts and rendering no badge → the new grid prop is **optional**.

---

### Task 1: `timeAgo` relative-time helper (pure, TDD)

A small pure formatter for the comment thread. Finer granularity (minute/hour) than the day-only unexported helper in `app/decklist/community/client.tsx`; kept in its own module so it is unit-testable and reusable, and so it does not have to live inside the `"use client"` thread component untested.

**Files:**
- Create: `app/forge/lib/relativeTime.ts`
- Test: `app/forge/lib/__tests__/relativeTime.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function timeAgo(iso: string, nowMs?: number): string` — `nowMs` defaults to `Date.now()`; injectable for deterministic tests. Future/skewed timestamps and unparseable input return `"just now"`.

- [ ] **Step 1: Write the failing test**

Create `app/forge/lib/__tests__/relativeTime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { timeAgo } from "../relativeTime";

const NOW = Date.parse("2026-07-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe("timeAgo", () => {
  it("returns 'just now' under a minute", () => {
    expect(timeAgo(ago(30 * S), NOW)).toBe("just now");
  });
  it("formats minutes", () => {
    expect(timeAgo(ago(5 * M), NOW)).toBe("5m ago");
  });
  it("formats hours", () => {
    expect(timeAgo(ago(3 * H), NOW)).toBe("3h ago");
  });
  it("returns 'yesterday' at ~one day", () => {
    expect(timeAgo(ago(D + H), NOW)).toBe("yesterday");
  });
  it("formats days under a week", () => {
    expect(timeAgo(ago(3 * D), NOW)).toBe("3d ago");
  });
  it("formats weeks", () => {
    expect(timeAgo(ago(14 * D), NOW)).toBe("2w ago");
  });
  it("formats months", () => {
    expect(timeAgo(ago(60 * D), NOW)).toBe("2mo ago");
  });
  it("formats years", () => {
    expect(timeAgo(ago(400 * D), NOW)).toBe("1y ago");
  });
  it("treats a future timestamp as 'just now'", () => {
    expect(timeAgo(new Date(NOW + 5 * M).toISOString(), NOW)).toBe("just now");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/forge/lib/__tests__/relativeTime.test.ts`
Expected: FAIL — `Failed to resolve import "../relativeTime"` / `timeAgo is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `app/forge/lib/relativeTime.ts`:

```ts
// Compact relative-time formatter for Forge comment threads.
// Finer granularity (minute/hour) than the day-only community-page helper,
// since a review thread wants "5m ago" vs "today". `nowMs` is injectable for tests.
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const secs = Math.floor((nowMs - then) / 1000);
  if (!Number.isFinite(secs) || secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/forge/lib/__tests__/relativeTime.test.ts`
Expected: PASS — 9 passed.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/relativeTime.ts app/forge/lib/__tests__/relativeTime.test.ts
git commit -m "feat(forge): timeAgo relative-time helper for comment threads"
```

---

### Task 2: Comment attribution (data + thread UI)

Resolve `created_by` → display name in `listComments`, and render `name · time` on each comment (top-level and replies). The name has no consumer other than the thread, so data + render ship together.

**Files:**
- Modify: `app/forge/lib/comments.ts` (add `authorName` to `CommentRow`; enrich in `listComments`)
- Modify: `app/forge/cards/[cardId]/CommentThread.tsx` (render author + time)

**Interfaces:**
- Consumes: `timeAgo` from `@/app/forge/lib/relativeTime` (Task 1).
- Produces: `CommentRow` now carries `authorName: string | null`.

- [ ] **Step 1: Add `authorName` to the `CommentRow` type**

In `app/forge/lib/comments.ts`, add the field to the `CommentRow` type (after `createdAt`):

```ts
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
  authorName: string | null;
};
```

- [ ] **Step 2: Default `authorName` in `toComment`**

In the same file, add `authorName: null` at the end of the object returned by `toComment` (it is overwritten during enrichment; this keeps the base mapper type-complete):

```ts
    createdBy: row.created_by,
    createdAt: row.created_at,
    authorName: null,
  };
}
```

- [ ] **Step 3: Enrich `listComments` with display names**

Replace the body of `listComments` in `app/forge/lib/comments.ts` with:

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
  if (rows.length === 0) return rows;

  // Resolve author UUIDs -> display names (member-readable). Same pattern as sets.ts.
  const ids = [...new Set(rows.map((r) => r.createdBy))];
  const { data: members } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, display_name")
    .in("user_id", ids);
  const names = new Map((members ?? []).map((m: any) => [m.user_id, m.display_name]));
  return rows.map((r) => ({ ...r, authorName: names.get(r.createdBy) ?? "Forge member" }));
}
```

- [ ] **Step 4: Import `timeAgo` in the thread component**

In `app/forge/cards/[cardId]/CommentThread.tsx`, add the import after the existing `comments` import:

```ts
import { timeAgo } from "@/app/forge/lib/relativeTime";
```

- [ ] **Step 5: Render the author + time header on each comment**

In `CommentThread.tsx`, inside the `Comment` component's outer `<div>`, add an attribution line as the **first** child (before the `{c.field && (...)}` suggestion line):

```tsx
  const Comment = ({ c, isReply }: { c: CommentRow; isReply?: boolean }) => (
    <div className={`rounded-md border p-2 text-sm ${isReply ? "ml-4" : ""} ${c.resolved ? "opacity-60" : ""}`}>
      <p className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{c.authorName ?? "Forge member"}</span>
        {" · "}
        {timeAgo(c.createdAt)}
      </p>
      {c.field && (
        <p className="text-xs text-muted-foreground">
          Suggestion · <span className="font-medium">{FIELD_LABELS[c.field] ?? c.field}</span>
          {c.suggestedValue != null && <> → {valueText(c.suggestedValue)}</>}
        </p>
      )}
      <p className="whitespace-pre-wrap">{c.body}</p>
```

(Everything from `<p className="whitespace-pre-wrap">` onward is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add app/forge/lib/comments.ts app/forge/cards/[cardId]/CommentThread.tsx
git commit -m "feat(forge): attribute card comments to their author with relative time"
```

---

### Task 3: Set-page unresolved-comment indicator

Add the count read, thread it through, and render the badge. The count function has no visible effect until it is wired to the badge, so all four files ship as one task.

**Files:**
- Modify: `app/forge/lib/comments.ts` (add `listUnresolvedCommentCounts`)
- Modify: `app/forge/sets/[setId]/cards/page.tsx` (fetch counts, pass down)
- Modify: `app/forge/sets/[setId]/cards/SetCardsBrowser.tsx` (accept + forward prop)
- Modify: `app/forge/components/ForgeCardGrid.tsx` (optional prop + badge)

**Interfaces:**
- Consumes: `listSetCards` (unchanged) for the card ids.
- Produces: `export async function listUnresolvedCommentCounts(cardIds: string[]): Promise<Record<string, number>>` — cardId → count of unresolved card-level comments; `{}` when unauthorized or `cardIds` empty. `ForgeCardGrid` gains an optional `commentCounts?: Record<string, number>` prop.

- [ ] **Step 1: Add `listUnresolvedCommentCounts` to `comments.ts`**

Append to `app/forge/lib/comments.ts`:

```ts
// Per-card count of unresolved, card-level comments (proposal_id IS NULL) for a set
// of card ids. Card-level only so the badge matches what the card-level thread shows.
// Runs under the caller's RLS; only integer counts cross to the client, never bodies.
export async function listUnresolvedCommentCounts(
  cardIds: string[]
): Promise<Record<string, number>> {
  const ctx = await requireForge();
  if (!ctx || cardIds.length === 0) return {};
  const { data } = await ctx.supabase
    .from("card_comments")
    .select("card_id")
    .in("card_id", cardIds)
    .eq("resolved", false)
    .is("proposal_id", null);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = (row as any).card_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
```

- [ ] **Step 2: Fetch counts in the set cards page and pass them down**

In `app/forge/sets/[setId]/cards/page.tsx`, add the import (alongside the existing sets import):

```ts
import { listUnresolvedCommentCounts } from "@/app/forge/lib/comments";
```

Then, after the `if (cards.length === 0) { ... }` early-return block and before the final `return`, compute the counts and pass them to the browser:

```tsx
  const commentCounts = await listUnresolvedCommentCounts(cards.map((c) => c.id));
  return <SetCardsBrowser cards={cards} setId={setId} canCreate={canCreate} commentCounts={commentCounts} />;
```

(The empty-cards branch returns earlier and needs no counts.)

- [ ] **Step 3: Accept and forward the prop in `SetCardsBrowser`**

In `app/forge/sets/[setId]/cards/SetCardsBrowser.tsx`, extend the component signature:

```tsx
export default function SetCardsBrowser({ cards, setId, canCreate, commentCounts }: { cards: ForgeCardFull[]; setId: string; canCreate: boolean; commentCounts?: Record<string, number> }) {
```

Then add `commentCounts={commentCounts}` to the `<ForgeCardGrid>` call:

```tsx
      <ForgeCardGrid
        cards={filtered}
        showStatus
        commentCounts={commentCounts}
        selection={{ active: selecting, selected, onToggle: toggle }}
        leading={canCreate ? <AddCardTile setId={setId} disabled={selecting} /> : undefined}
      />
```

- [ ] **Step 4: Render the badge in `ForgeCardGrid`**

In `app/forge/components/ForgeCardGrid.tsx`:

Add the icon import at the top:

```ts
import { MessageSquare } from "lucide-react";
```

Extend the props (add `commentCounts` — optional so the Ideas library is unaffected):

```tsx
export default function ForgeCardGrid({
  cards, showStatus = false, selection, leading, commentCounts,
}: {
  cards: ForgeCardFull[];
  showStatus?: boolean;
  selection?: GridSelection;
  leading?: ReactNode;
  commentCounts?: Record<string, number>;
}) {
```

Inside the `cards.map`, compute the count and wrap the card face in a `relative` container so the badge can sit on it. Replace the current `const inner = ( ... )` opening — from `const inner = (` through the `<ForgeCardFace ... />` element — with:

```tsx
        const count = commentCounts?.[c.id] ?? 0;
        const inner = (
          <>
            <div className="relative">
              <ForgeCardFace
                name={c.snapshot.name ?? null}
                rawText={cardRawText(c.snapshot)}
                finishedUrl={c.hasFinished ? `/forge/api/art/${c.id}?kind=finished&t=${t}` : null}
                artUrl={c.hasArt ? `/forge/api/art/${c.id}?t=${t}` : null}
                className={shelved ? "opacity-60 grayscale transition duration-200 group-hover:opacity-100 group-hover:grayscale-0" : undefined}
              />
              {count > 0 && (
                <span
                  className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-full border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm"
                  title={`${count} unresolved comment${count === 1 ? "" : "s"}`}
                >
                  <MessageSquare className="h-3 w-3" />
                  {count}
                </span>
              )}
            </div>
```

The existing title/status row (`<div className="mt-1 flex ...">`) and the rest of `inner` stay exactly as they are; only the face is now wrapped. The badge sits **top-right of the face**, clear of the select checkmark (`left-2 top-2`, top-left, on the wrapping button) and the status pill (renders below the face).

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/comments.ts "app/forge/sets/[setId]/cards/page.tsx" "app/forge/sets/[setId]/cards/SetCardsBrowser.tsx" app/forge/components/ForgeCardGrid.tsx
git commit -m "feat(forge): unresolved-comment count badge on set card grid"
```

---

### Task 4: Verification & PR readiness

One authoritative gate (avoids a full build after every small edit).

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS, including the 9 new `relativeTime` tests. Known pre-existing, unrelated failures may appear (e.g. `store-route`, `threshingfloor`) — and a sibling git worktree can double-count files; these are not from this work. No new failures in `forge/lib` or `forge/components`.

- [ ] **Step 2: Security / anon-leak suite**

Run: `npm run test:security`
Expected: PASS. No schema change was made, so anon still sees zero Forge rows; this suite must stay green.

- [ ] **Step 3: Production build (type gate)**

Run: `npm run build`
Expected: Clean build (repo `strict: false` means this is where any type error shows). Confirm `/forge/sets/[setId]/cards` and `/forge/cards/[cardId]` compile.

- [ ] **Step 4: Manual browser smoke (signed in as an elder/superadmin)**

Verify against the dev server (see the `verify` skill for minting a real Forge session if no live login):
- On a card with comments from ≥2 members: each comment shows the correct author name and a relative time; replies show attribution too.
- A comment authored by a member with no `display_name` renders as **"Forge member"** (not blank).
- On `/forge/sets/[setId]/cards`: a card with 2 unresolved card-level comments shows a **"2"** badge top-right of its face; resolving both (on the card page) clears the badge after refresh; a card whose only comments are proposal-anchored or all resolved shows **no** badge.
- Badge does not collide with the select-mode checkmark or the status pill; readable in light and dark.
- `/forge/ideas` grid is unchanged (no badges).

- [ ] **Step 5: Open the PR**

```bash
git push -u origin forge-comment-attribution-and-indicator
gh pr create --title "feat(forge): comment attribution + set-page comment indicator" \
  --body "$(cat <<'EOF'
Two Forge QOL asks (RedDragonThorn):
- **Attribution** — comments now show the author's display name + relative time (they already stored `created_by`; it was just never shown). No more hand-signing names.
- **Set-page indicator** — a small top-right badge on the set card grid counts each card's unresolved, card-level comments; clears as they're resolved.

No migration / RPC / schema change — read-only over existing columns and RLS. Elder/superadmin-facing only (playtesters already redirected). Anon-leak suite unchanged/green.

Spec: `docs/superpowers/specs/2026-07-05-forge-comment-attribution-and-set-indicator-design.md`
Plan: `docs/superpowers/plans/2026-07-05-forge-comment-attribution-and-set-indicator.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Attribution data (resolve `created_by` → name, "Forge member" fallback) → Task 2 Steps 1–3. ✓
- Attribution UI (name + relative time, top-level + replies) → Task 1 + Task 2 Steps 4–5. ✓
- Indicator data (unresolved, card-level count) → Task 3 Step 1. ✓
- Indicator wiring (page → browser → grid) → Task 3 Steps 2–4. ✓
- Badge form/placement (top-right, neutral, count, no collision) → Task 3 Step 4. ✓
- Ideas library unaffected (optional prop) → Task 3 Steps 3–4 + Task 4 Step 4. ✓
- No migration; anon-leak green → Task 4 Step 2. ✓
- Build type gate (strict:false) → Task 4 Step 3. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows full code. ✓

**Type consistency:** `authorName: string | null` defined in Task 2 Step 1, defaulted in Step 2, filled in Step 3, read in Step 5 (`c.authorName`). `commentCounts?: Record<string, number>` produced in Task 3 Step 1 (`listUnresolvedCommentCounts`), passed in Steps 2–3, consumed in Step 4 (`commentCounts?.[c.id]`). `timeAgo(iso, nowMs?)` produced in Task 1, consumed in Task 2 Step 5. Consistent. ✓
