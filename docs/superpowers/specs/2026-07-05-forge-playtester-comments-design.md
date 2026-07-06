# Forge — Playtester comments on cards

**Date:** 2026-07-05
**Status:** Approved design, ready for implementation plan
**Branch:** `main`

## Goal

Let granted playtesters leave comments on the cards they can already view, **without** giving
them the ability to propose changes. Comments give feedback in; elders keep sole control over
proposals and edits.

## Background / current state

- Playtesters browse the cards shared with them at `/forge/play/[setId]`
  (`app/forge/play/[setId]/RevealGrid.tsx`). Clicking a card opens a read-only modal showing
  only the card face. There is no comment UI on the playtester surface.
- Playtesters are hard-redirected out of the elder "studio" (`app/forge/cards/[cardId]/page.tsx:15`)
  and the set cards browser, so they never see `CommentThread` / `ReviewPanel`.
- The comment + proposal read/write guard `_forge_can_read_card` (migration
  `053_forge_review_layer.sql`) is **elder-only by design** (owner / superadmin / set-elder;
  "NO granted branch"). Consequences today: playtesters can neither read nor write comments,
  and cannot create proposals.
- Playtesters *can* already read card content: the `forge_cards` and `card_versions` SELECT
  policies (migration `057_forge_reveal_playtesting.sql`) expose `playtesting`/`approved` cards
  in sets they are granted (`is_forge_set_granted`).
- `playtest_members` SELECT policy is `is_forge_member()` (migration `048`), so playtesters can
  resolve peers' display names for comment attribution with no extra work.
- Realtime `card_comments` broadcasts gate on `_forge_can_read_card` (migration `054`), i.e.
  elder-only. The playtester view therefore uses **refetch**, not realtime.

## Confirmed product decisions

1. **Comment scope:** plain comments + threaded replies only. No field-anchored value
   suggestions for playtesters (that affordance edges toward proposing changes and stays elder-only).
2. **Visibility:** playtesters see the full **card-level** discussion (everyone's comments +
   replies where `proposal_id IS NULL`), same as what elders see in the studio thread. The
   proposals surface and proposal-anchored comments (including deny reasons) stay hidden from
   playtesters.

## Design

### 1. Database — new migration `070_forge_playtester_comments.sql`

Widen **comments** without touching **proposals**. Leave `_forge_can_read_card` exactly as-is
(so `forge_create_proposal`, the `card_proposals` SELECT policy, and the proposals UI remain
elder-only) and add a parallel, broader guard.

- **New guard** `public._forge_can_comment_card(p_card_id uuid)` — `security definer`, `stable`,
  `set search_path = ''`. True when the card is readable by an elder (owner / superadmin /
  set-elder, identical to `_forge_can_read_card`) **or** the caller is a granted playtester on a
  shared card, mirroring the `forge_cards` granted-read branch from 057:

  ```
  (c.set_id is not null
   and c.status in ('playtesting','approved')
   and public.is_forge_set_granted(c.set_id))
  ```

- **`card_comments` SELECT policy** (replace):

  ```
  using (
    public._forge_can_read_card(card_comments.card_id)                 -- elders: all comments
    or (card_comments.proposal_id is null
        and public._forge_can_comment_card(card_comments.card_id))     -- playtesters: card-level only
  )
  ```

  Elders keep full visibility; granted playtesters see only card-level (`proposal_id IS NULL`)
  comments. Proposal-anchored comments remain invisible to them even via a direct query.

- **`forge_add_comment` RPC** (replace body):
  - Top guard changes from `_forge_can_read_card` to `_forge_can_comment_card`.
  - Determine elder-ness for this card via `_forge_can_read_card(p_card_id)`. If the caller is
    **not** an elder (i.e. a granted playtester):
    - reject if `p_proposal_id is not null` or `p_field is not null` or
      `p_suggested_value is not null` → `raise exception 'playtesters can only leave plain comments'`;
    - if `p_parent_id is not null`, require the parent to be a card-level comment on the same card
      (`proposal_id is null and card_id = p_card_id`), else raise. (Defense-in-depth; playtesters
      can't see proposal-anchored comment ids anyway.)
  - Everything else (length caps, insert, return id) unchanged.

- **No change** to `forge_resolve_comment` / `forge_delete_comment`: both already allow the
  comment's author, so a playtester can delete their own comment. Resolve is simply not surfaced
  in the playtester UI (it's an elder disposition).

- **Grants:** `revoke execute on function public._forge_can_comment_card(uuid) from public, anon;`
  `grant execute ... to authenticated;`. Re-grant the recreated `forge_add_comment` overload to
  `authenticated`, revoke from `public, anon` (match 053's pattern).

- **Out of scope:** realtime for playtesters (broadcast gate stays elder-only); `forge_create_proposal`,
  `card_proposals` policy, and `_forge_can_read_card` are untouched.

### 2. Server actions (`app/forge/lib/comments.ts`)

- Add `listCardComments(cardId)` for lazy load on modal open: returns the **card-level** thread
  (`proposal_id IS NULL`) with author names resolved (same pattern as existing `listComments`),
  run under the caller's session so RLS applies. (May be implemented by having `listComments`
  reused/filtered; a dedicated action keeps the playtester path isolated.)
- `addComment` and `deleteComment` already gate on `requireForge()` (which includes playtesters)
  and need no signature change. The playtester UI never sends `field`/`suggestedValue`/`proposalId`;
  the RPC also rejects them server-side.

### 3. UI

- New focused, mobile-first client component `app/forge/play/[setId]/PlaytesterComments.tsx`:
  loads the card-level thread on mount (lazy, per open card), renders comments with author +
  relative time (`timeAgo`), a plain compose box, reply affordance, and delete-on-own-comments.
  No field selector, no Apply, no Resolve, no proposals section.
- Mount it inside the existing card modal in `RevealGrid.tsx` (currently around line 104): card
  face on top, comments below; widen the modal from `max-w-sm` to accommodate the thread. Stacked
  layout on mobile.
- No new navigation — playtesters already reach `/forge/play/[setId]`.
- Not building grid-tile unresolved-comment badges for the playtester grid (stretch, not core).

## Verification

- **SQL / RLS (run as a granted playtester session):**
  - CAN insert a plain card-level comment on a `playtesting` card in a granted set.
  - CANNOT insert when passing `p_field` / `p_suggested_value` / `p_proposal_id` (RPC raises).
  - CANNOT `select` proposal-anchored comments (`proposal_id IS NOT NULL`).
  - CANNOT call `forge_create_proposal` (unchanged elder guard raises).
  - A **non-granted** playtester CANNOT read or insert comments on the card.
- **Existing forge test suite** (`app/forge/lib/__tests__/*`) stays green.
- **E2E** (accounts + cookie minting per the `verify` skill): a playtester opens the reveal modal,
  posts a comment; an elder sees it in the studio `ReviewPanel` card-level thread.

## Files touched

- `supabase/migrations/070_forge_playtester_comments.sql` (new)
- `app/forge/lib/comments.ts` (add `listCardComments`)
- `app/forge/play/[setId]/PlaytesterComments.tsx` (new)
- `app/forge/play/[setId]/RevealGrid.tsx` (mount comments in modal, widen modal)

## Non-goals

- Realtime updates for the playtester comment view.
- Field-anchored suggestions or any proposal ability for playtesters.
- Changes to the elder studio / proposals flow.
- Comment badges on the playtester card grid.
