# Forge — Comment Attribution & Set-Page Comment Indicator

**Date:** 2026-07-05
**Status:** Design — pending review
**Scope:** Two small, additive QOL features for The Forge's card-review layer. No schema change, no migration, no RPC.

## Motivation

Two requests from a Forge member (RedDragonThorn, relayed via Discord):

1. *"Comments left on cards, if there's a way to associate them with the user so we can see who's saying what without signing our names."*
2. *"A small visual indicator within the set page that a card has comments for review."*

The comment system (`card_comments`, `forge_add_comment`, [CommentThread.tsx](../../../app/forge/cards/[cardId]/CommentThread.tsx)) already exists and already stores `created_by` on every comment — it's simply never displayed, which is why members hand-sign their names. And nothing surfaces comment activity at the set-grid level, so a designer scanning a set can't tell which cards have open discussion.

Both features are **elder/superadmin-facing only** — playtesters are redirected off `/forge/cards/[cardId]` and `/forge/sets/[setId]/cards`. Attribution is among the design team reviewing each other's work.

## Direction (settled)

Two independent design-decision agents converged on the same direction:

- **Indicator:** an **unresolved-count badge** on the card face — a small number counting that card's **card-level** unresolved comments (`proposal_id IS NULL`), placed **top-right** of the face. It clears once all of a card's card-level comments are resolved ("for review" → self-clears). Card-level scope keeps the number honest: tapping the grid card lands on the card-level thread, which shows exactly those comments (proposal-anchored comments render in a different context).
- **Attribution:** **display name + relative timestamp** per comment (top-level and replies). No avatar — avatars stay reserved for the presence bar; a dense, indented mobile thread stays uncluttered.

## Feature 1 — Comment attribution

### Data ([app/forge/lib/comments.ts](../../../app/forge/lib/comments.ts))

- Extend `CommentRow` with `authorName: string | null`.
- In `listComments`, after fetching the rows, resolve `created_by` → `display_name` using the **existing pattern** from [sets.ts:142](../../../app/forge/lib/sets.ts) — one batched `playtest_members` read keyed by the distinct author ids:
  ```ts
  const ids = [...new Set(rows.map(r => r.created_by))];
  const { data: members } = await ctx.supabase
    .from("playtest_members").select("user_id, display_name").in("user_id", ids);
  const names = new Map((members ?? []).map(m => [m.user_id, m.display_name]));
  ```
  Fallback to `"Forge member"` when a name is missing (matches [forgeDecks.ts](../../../app/forge/lib/forgeDecks.ts): `?? "Forge member"`), covering never-onboarded or removed authors.
- `playtest_members` is member-readable and returns only `display_name` — no leak surface; comment bodies never widen their audience.

### UI ([app/forge/cards/[cardId]/CommentThread.tsx](../../../app/forge/cards/[cardId]/CommentThread.tsx))

- Add a compact header line to the `Comment` component: **`<authorName> · <relative time>`** in `text-xs text-muted-foreground`, above the body. Applies to both top-level comments and replies.
- Add a small local `timeAgo(createdAt)` formatter with minute / hour / day granularity (a comment thread wants finer resolution than the day-only community-page helper). Kept local to this file — no refactor of the existing unexported helper.
- The existing `field`/suggestion sub-line, action buttons, reply box, and compose box are untouched.

## Feature 2 — Set-page comment indicator

### Data ([app/forge/lib/comments.ts](../../../app/forge/lib/comments.ts))

New server function:

```ts
export async function listUnresolvedCommentCounts(
  cardIds: string[]
): Promise<Record<string, number>>
```

- `requireForge` gate; empty `cardIds` → `{}`.
- One query: `card_comments` → `select("card_id")` `.in("card_id", cardIds)` `.eq("resolved", false)` `.is("proposal_id", null)`; tally per `card_id` server-side.
- Runs under the elder's RLS (`_forge_can_read_card`); only the integer counts cross to the client, never bodies. Card ids are already client-known (they're the grid's cards).

### Wiring

- [sets/[setId]/cards/page.tsx](../../../app/forge/sets/[setId]/cards/page.tsx): after `listSetCards`, call `listUnresolvedCommentCounts(cards.map(c => c.id))` and pass the map into `SetCardsBrowser`.
- [SetCardsBrowser.tsx](../../../app/forge/sets/[setId]/cards/SetCardsBrowser.tsx): accept `commentCounts` prop, pass straight through to `ForgeCardGrid`. Filtering/sorting/bulk logic untouched.
- [ForgeCardGrid.tsx](../../../app/forge/components/ForgeCardGrid.tsx): accept **optional** `commentCounts?: Record<string, number>`. For each card with `count > 0`, render a small badge absolutely positioned at the **top-right of the card face** (wrap `ForgeCardFace` in a `relative` container). The Ideas-library consumer passes nothing → no badge, no behavior change.

### Badge styling

- Small pill: a lucide comment glyph (`MessageSquare`) + the count, e.g. `absolute right-1 top-1`, compact (`text-[10px]`, `rounded-full`, `px-1.5`).
- **Neutral at rest** per the design system (green is reserved for hover/active/CTA): `bg-background/90 border text-foreground` (readable over any art, works light + dark). Not green, not red — a quiet "N to review" marker, not an alarm.
- Sits clear of the select-mode checkmark (top-**left**, `left-2 top-2`) and the status pill (renders **below** the face). No collision.

## Non-goals / out of scope

- **No schema/RPC/migration.** Both features read existing columns via existing RLS.
- **Live badge updates** are best-effort only. Counts render server-side and refresh on navigation / `router.refresh()`. The set page's existing `SetRealtime` already refreshes on Forge changes; wiring a dedicated live comment-count push is not in scope.
- Indicator appears **only on the set cards grid** (the explicit request), not the Ideas library, playtest reveal, or deckbuilder.
- No change to proposal-anchored comments, suggestions, or the review queue.
- No "unread" / per-viewer state — the badge is unresolved-count, identical for every viewer.

## Verification

- **Attribution:** on a card with comments from ≥2 members, each comment shows the correct author name + a relative time; a comment from a member with no `display_name` shows "Forge member".
- **Indicator:** a card with 2 unresolved card-level comments shows a "2" badge on the set grid; resolving both clears it; a card whose only comments are proposal-anchored or all-resolved shows no badge; the Ideas library grid is unchanged.
- `npm run build` clean (repo `strict:false` — type issues surface only in the build).
- No new rows visible to anon: the forge anon-leak test remains green (no new tables/columns; `npm run test:security`).
