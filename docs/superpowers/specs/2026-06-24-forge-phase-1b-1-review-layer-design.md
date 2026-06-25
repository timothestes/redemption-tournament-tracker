# The Forge — Phase 1b.1: Review Layer (Proposals + Comments/Suggestions)

**Date:** 2026-06-24
**Branch:** `forge-phase-1b-1-review-layer`
**Status:** design (pre-implementation)
**Parent spec:** `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md` (Phase 1b — Collaborative review layer)
**Builds on:** 1a.1–1a.5 (access foundation, invites/members, private art, card studio, sets/lifecycle/versions). Migration baseline = `052_forge_sets_lifecycle.sql`.

---

## Summary

Phase 1b is the collaborative "code review, but for cards" layer. This first sub-slice (1b.1) delivers the two interactive review primitives:

1. **Proposals** — the "pull request": an elder freezes a candidate change for another elder to sign off, reviewed through a side-by-side **Current vs Proposed** card diff, with single-elder accept/deny.
2. **Comments + single-field suggestions** — threaded discussion anchored to a card or a proposal, plus field-anchored suggestions an elder can **apply** to the working draft in one click.

A lightweight per-set **review queue** surfaces cards with open proposals / unresolved suggestions.

**Deferred to 1b.2 (the presence slice):** Supabase **Realtime** — live comments, presence avatars, collision warnings, and live badge counts. 1b.1 uses **refetch-on-action** (`router.refresh()`), exactly as 1a shipped notes and the progress dashboard before Realtime. This keeps the Realtime private/authorized-channel security surface (RLS-on-broadcast plus its dedicated leak test) confined to one focused later slice, where presence already lives.

**Deferred to a later slice:** proposing **art** changes. Proposals in 1b.1 diff the DesignCard game fields only; the `proposed_art_key` column ships but is unused, and art changes remain a direct edit.

---

## Goals / non-goals

**Goals**
- A faithful "code review for cards" loop usable by the elders who co-design a set: propose → diff → accept (publishes) / deny (with a required reason).
- Lightweight async collaboration: card-level comment threads and one-click field suggestions.
- A per-set review queue so open work is discoverable across a set's cards.
- The security spine holds: new tables are default-deny RLS + definer-RPC-only writes; the anon-leak guardrail is extended to cover them.

**Non-goals (this slice)**
- Realtime / presence / collision warnings / live badges (→ 1b.2).
- Proposing art changes (→ later).
- Multi-reviewer / N>1 approval. Approval stays **single-elder (N=1)** per the parent spec.
- Re-basing / auto-re-diff of a superseded proposal. A stale-base proposal is closed `superseded`; the author creates a fresh proposal (no in-place reopen in 1b.1).
- Playtester participation (playtesters do not exist until Phase 2). In this phase the audience for proposals/comments is the set's elders + superadmin.

---

## Who this is for (membership reality check)

Today the only Forge members are **superadmin** and **elders**; playtesters arrive in Phase 2. Under the 052 RLS, a card that lives in a set is readable only by the card owner, the set's elders, and superadmin — and sharing a card into a set already requires being an elder of that set. So in practice **everyone who can see a set card is an elder who can also direct-edit it.**

The review layer is therefore opt-in collaboration among co-designers:
- **Direct edit** (autosave) stays the default for confident solo iteration.
- **Propose** is for "I changed this, but I want another elder to sign off before it's published."
- **Comments / suggestions** are for discussing and nudging a card without taking over its draft.

This is meaningful value now, and it is the exact infrastructure playtesters consume in Phase 2.

---

## The three edit paths (unchanged from the parent spec)

1. **Direct edit** — owner / set-elder edits `working_snapshot` via autosave (`forge_save_card`). Default. (Shipped in 1a.)
2. **Proposal** ("pull request") — a candidate full snapshot frozen for sign-off, reviewed via the card diff; an elder accepts (publishes) or denies. (This slice.)
3. **Single-field suggestion** — a `card_comments` row anchored to one field with a `suggested_value`; an elder **applies** it in one click, which writes the value into the working draft. It does *not* itself create a published version. (This slice.)

---

## Proposal semantics (the core decisions)

**Authoring.** "Propose changes" sits alongside "Publish" in the lifecycle controls. Where *Publish* lets an elder freeze the working draft into a new version themselves, *Propose* freezes the **current `working_snapshot`** into `card_proposals.proposed_snapshot` plus a one-line `summary`, recording the card's current `published_version_id` as `base_version_id` (nullable — a never-published card proposes against an empty base). Freezing the snapshot at propose-time means later direct edits to the draft don't silently mutate a pending proposal.

**Diff visualization.** Never a text diff. Two card previews side by side — **Current** (left) and **Proposed** (right) — with changed fields highlighted and a one-line plain-language summary. **Current** = the `base_version_id` version's `data` when present, else an empty "new card" placeholder (a first-version proposal). On mobile the two previews stack. The field-level change list is computed by the pure `cardDiff` module.

**Accept (single-elder, N=1).** `forge_accept_proposal` mirrors `forge_publish_card` and runs under `SELECT … FOR UPDATE` on the `forge_cards` row:
1. Authz: set-elder of the card's set, or superadmin.
2. Proposal must be `open`.
3. **Status guard:** the card must be `draft` or `playtesting` (the active design loop), exactly as `forge_publish_card` requires. An `approved` card's version is `approved`, not `published`, so accepting would no-op the supersede and leave `approved_version_id` dangling — so accept is refused with "unapprove this card before accepting changes." (`archived` is likewise refused.) Creating a proposal carries the same status guard.
4. **Stale-base guard:** re-read `published_version_id` **from the row just locked `FOR UPDATE`** (not a value captured earlier), and compare with `base_version_id` using `IS DISTINCT FROM` (NULL-aware — a first-version proposal has `base_version_id = NULL`; if the card has since been published by another path, `NULL IS DISTINCT FROM <uuid>` is true and the proposal is correctly superseded, whereas a plain `<>` would silently skip the guard and clobber that publish). If distinct, close the proposal `superseded` and **`RETURN NULL`** — *not* `raise`: a `raise` would roll back the very `superseded` UPDATE inside the same transaction. The accept action treats a NULL return (with no error) as "this proposal is out of date — re-propose." This closes the TOCTOU window and makes racing accepts on two open proposals of the same card safe (the second re-reads the proposal `FOR UPDATE` under the card lock, sees it's no longer `open` or fails the base check, and supersedes).
5. Allocate `max(version_number)+1` under the lock; supersede the prior `published` version; insert the new immutable `card_versions` row (`published`) from `proposed_snapshot` (art inherited from the card's current working art — `proposed_art_key` unused in 1b.1); set `published_version_id`; set status → `playtesting` (same transition as publish).
6. **Sync the draft:** write `proposed_snapshot` into `working_snapshot` so the editor reflects the accepted change. *Tradeoff:* this overwrites any uncommitted direct edits to the working draft made after the proposal was created — acceptable in a tiny trusted group and called out in the UI ("Accepting will publish this and update the working draft"). Presence warnings in 1b.2 will further mitigate.
7. Close the proposal `accepted` (record `resulting_version_id`, `closed_by`, `closed_at`); mark sibling `open` proposals on the same card `superseded`.

**No snapshot validation on accept.** The parent spec's accept step 3 ("validate `proposed_snapshot` against the DesignCard schema") is intentionally dropped: it mirrors `forge_publish_card`, which freezes `working_snapshot` unvalidated, and the DesignCard validation is advisory-only by design (`designCard.ts` `validate()` never blocks). Accept only enforces the size cap.

**Deny.** `forge_deny_proposal` requires a non-empty (trimmed) reason. It closes the proposal `denied` and inserts the reason as a proposal-anchored comment (`card_id` = the proposal's card, `proposal_id` set, `field`/`suggested_value`/`parent_comment_id` null, `created_by` = the denying elder, `body` = reason) so the rationale lives in the thread.

**Proposal/comment lifecycle.** Proposals are never deleted — only their `status` changes (`accepted`/`denied`/`superseded`). Their comment threads (including a deny reason) are **never auto-deleted** and stay readable in the per-card "recent proposals" list. Comments cascade-delete only if their proposal row is ever deleted (it isn't, in normal flow) or the card is deleted.

**History.** Accepted/denied/superseded proposals remain queryable per card (status + timestamps + actor), alongside the existing `card_versions` history. A dedicated timeline UI is out of scope for 1b.1 (the parent spec's "before/after thumbnail timeline" can ride a later polish slice); the per-card review panel lists recent proposals with their status.

---

## Comments & suggestions semantics

- **Card-level comment:** `proposal_id = null`, `field = null` — general discussion shown in the card's review panel.
- **Field-anchored suggestion:** `field` set with optional `suggested_value` (jsonb). The `field` is a **raw `DesignCard` property key** (`name`, `brigades`, `strength`, `toughness`, `specialAbility`, …) — **not** the studio's synthetic `FieldKey` union (which collapses strength+toughness into `"stats"` and omits keys); writing `'{stats}'` would create a junk key, so the RPC allowlists raw DesignCard keys. An elder sees **Apply**, which writes `suggested_value` into `working_snapshot[field]` via `forge_apply_suggestion` and marks the comment resolved. A suggestion with no `suggested_value` is just a field-anchored note (no Apply). The author is responsible for `suggested_value` being shape-valid for the field (array vs scalar) — `jsonb_set` does not type-check it. If the field is currently `na` for the card's type (the type changed since the suggestion), Apply still writes it (validation is advisory; the designer may change the type back) — the RPC does not block on applicability.
- **Proposal-level comment:** `proposal_id` set — discussion on a specific proposal (includes the deny reason).
- **Threading:** one level of replies via `parent_comment_id` (rendered flat-with-indented-replies; arbitrary nesting is not required).
- **Resolve:** any comment can be toggled resolved by its author or a set-elder. Resolved suggestions/comments collapse but are retained.
- **Authorship is retained** as historical record (consistent with the member-removal policy in the parent spec).

**Who can do what**
| Action | Allowed |
|---|---|
| Read proposals/comments on a card | anyone who can read the card (owner / set-elder / superadmin) |
| Create a proposal | anyone who can read the card |
| Accept / deny a proposal | set-elder of the card's set, or superadmin |
| Add a comment / suggestion | anyone who can read the card |
| Apply a suggestion (writes the draft) | owner / set-elder / superadmin |
| Resolve a comment | author, or set-elder / superadmin |
| Delete a comment | author, or set-elder / superadmin (parity with resolve, so co-designers can moderate threads) |

Note: in 1b.1 every set-card reader is already an elder who can direct-edit (see §"Who this is for"), so the create/comment-vs-apply/accept authz split is **forward-compat for Phase 2 playtesters** — today all readers can also apply. The split is still enforced in the RPCs so Phase 2 needs no rework.

---

## Data model — migration `053_forge_review_layer.sql`

Schema + functions only, no data. Follows every 052 convention: `uuid` PKs, `auth.users` FKs, `timestamptz default now()`, RLS enabled, definer helpers with `set search_path = ''`, explicit anon revokes.

```sql
do $$ begin
  create type public.proposal_status as enum ('open','accepted','denied','superseded');
exception when duplicate_object then null; end $$;

create table if not exists public.card_proposals (
  id                   uuid primary key default gen_random_uuid(),
  card_id              uuid not null references public.forge_cards(id) on delete cascade,
  base_version_id      uuid,                          -- published base it branched from (nullable)
  proposed_snapshot    jsonb not null,                -- frozen DesignCard payload
  proposed_art_key     text,                          -- reserved; unused in 1b.1
  summary              text,                          -- one-line plain-language description
  status               public.proposal_status not null default 'open',
  resulting_version_id uuid,                          -- set on accept
  created_by           uuid not null references auth.users(id),
  created_at           timestamptz not null default now(),
  closed_at            timestamptz,
  closed_by            uuid references auth.users(id)
);
-- FKs to card_versions kept as plain (nullable) references; same-card integrity is
-- enforced inside the definer RPCs (base/result always belong to card_id by construction).
alter table public.card_proposals
  add constraint card_proposals_base_fk   foreign key (base_version_id)      references public.card_versions(id),
  add constraint card_proposals_result_fk foreign key (resulting_version_id) references public.card_versions(id);

create index if not exists card_proposals_card_idx on public.card_proposals(card_id);
create index if not exists card_proposals_open_idx on public.card_proposals(card_id) where status = 'open';

create table if not exists public.card_comments (
  id                uuid primary key default gen_random_uuid(),
  card_id           uuid not null references public.forge_cards(id) on delete cascade,
  proposal_id       uuid references public.card_proposals(id) on delete cascade,
  field             text,                              -- nullable; a DesignCard field key
  suggested_value   jsonb,                             -- nullable; one-click "apply" target
  parent_comment_id uuid references public.card_comments(id) on delete cascade,
  body              text not null,
  resolved          boolean not null default false,
  created_by        uuid not null references auth.users(id),
  created_at        timestamptz not null default now()
);
create index if not exists card_comments_card_idx     on public.card_comments(card_id);
create index if not exists card_comments_proposal_idx on public.card_comments(proposal_id);
```

**Card-readability predicate** (reused by both new SELECT policies and by the `_forge_can_read_card` RPC guard). **Proposals/comments are an elder-only collaboration surface** — so this predicate deliberately **omits** the `is_forge_set_granted` (Phase-2 playtester) branch that `card_versions_select` carries. In 052 that granted branch is narrowly status-gated (`card_versions.status = 'approved'`), letting a playtester see *approved* version data only; copying it here unguarded would expose every `proposed_snapshot` and comment on `draft`/`playtesting` cards to a lower-trust role and the anon-leak test would not catch it (playtesters are authenticated). Granting playtesters any review-artifact access is a deliberate, status-gated Phase-2 decision with its own isolation test — not something that ships dormant here.

```sql
exists (
  select 1 from public.forge_cards c
  where c.id = <table>.card_id
    and (c.owner_id = auth.uid()
         or public.is_forge_superadmin()
         or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
)
```

**RLS / grants**
- `card_proposals` and `card_comments`: `enable row level security`; `SELECT` policy = card-readability predicate above; **no INSERT/UPDATE/DELETE policies** (all writes go through definer RPCs). `revoke all … from anon`; `grant select … to authenticated`.

**Realtime:** not enabled in 1b.1 (refetch only). Adding these tables to a private Realtime publication is a 1b.2 task.

---

## RPCs (all `security definer`, `set search_path = ''`, anon `revoke execute` + authenticated `grant execute` — matching 052)

Each begins with an authz check that `raise exception`s on failure (callers map any error to a generic message; the area stays 404-opaque at the route layer). A reusable internal guard `_forge_can_read_card(p_card_id uuid) returns boolean` (definer, mirrors the readability predicate) keeps the checks DRY.

1. **`forge_create_proposal(p_card_id uuid, p_snapshot jsonb, p_summary text) returns uuid`**
   - Requires `_forge_can_read_card`. Requires the card to be in a set and in status `draft` or `playtesting` (same active-loop guard as accept). Requires non-empty trimmed `p_summary`. Caps `p_snapshot` size (64KB, as `forge_save_card`). Reads the `forge_cards` row `FOR SHARE` so `base_version_id = published_version_id` is captured atomically (avoids a born-stale proposal). Inserts `card_proposals` with `status='open'`, `created_by=auth.uid()`. Returns the new id. (Zero-change proposals — `proposed_snapshot` identical to the base `data` — are *allowed*; the diff simply shows no changed fields. Not worth the normalized-jsonb comparison to reject.)

2. **`forge_accept_proposal(p_proposal_id uuid) returns uuid`** — the full accept flow above, under `FOR UPDATE`. Returns the new `card_versions.id`.

3. **`forge_deny_proposal(p_proposal_id uuid, p_reason text) returns void`**
   - Set-elder/super; proposal must be `open`; require non-empty `p_reason`; set `denied` + `closed_*`; insert a proposal-anchored comment with `body=p_reason`.

4. **`forge_add_comment(p_card_id uuid, p_proposal_id uuid, p_parent_id uuid, p_field text, p_suggested_value jsonb, p_body text) returns uuid`**
   - `_forge_can_read_card`; require non-empty `p_body`; cap body length (8KB) and `suggested_value` size (8KB); if `p_field` is non-null it must be in the raw-`DesignCard`-key allowlist; insert; return id. (`p_proposal_id`/`p_parent_id`/`p_field`/`p_suggested_value` nullable.)

5. **`forge_resolve_comment(p_comment_id uuid, p_resolved boolean) returns void`**
   - Author, or set-elder/super of the comment's card. Toggle `resolved`.

6. **`forge_apply_suggestion(p_comment_id uuid) returns timestamptz`**
   - Owner/set-elder/super (write access to the card's draft). Comment must have a non-null `field` and `suggested_value`. `field` is validated against a **hardcoded raw-`DesignCard`-key allowlist** in the migration (the jsonb-writable property keys from `designCard.ts` — `name`, `cardType`, `alignment`, `brigades`, `strength`, `toughness`, `strengthModifier`, `toughnessModifier`, `class`, `icons`, `identifiers`, `specialAbility`, `reference`, `legality`, `rarity`, `flavorText`, `artistCredit`, `cardFrame`; **not** the synthetic `FieldKey`). This allowlist is a hand-maintained mirror of `designCard.ts` — a comment in both files notes the coupling. `jsonb_set` the value into `working_snapshot[field]`, re-check the resulting snapshot stays ≤64KB, bump `forge_cards.updated_at`, mark the comment `resolved`. Returns the new `updated_at`.

7. **`forge_delete_comment(p_comment_id uuid) returns void`**
   - Author, or set-elder/super of the comment's card. Deletes (cascade removes replies).

Internal helper `_forge_can_read_card(p_card_id uuid) returns boolean` (definer, stable, `search_path=''`) mirrors the card-readability predicate above. Like every prior Forge helper, it gets an explicit `revoke execute … from public, anon` + `grant execute … to authenticated` (Supabase default-grants anon directly, per 048).

---

## App surfaces

```
app/forge/lib/
  cardDiff.ts        (NEW, pure) diff two DesignCards → field change descriptors + summary
  proposals.ts       (NEW) server actions: createProposal/acceptProposal/denyProposal
                            + reads: listProposals(cardId),
                              getProposalDiff(proposalId) → reads card_versions.data for base_version_id
                              (the Current pane) + proposed_snapshot (the Proposed pane)
  comments.ts        (NEW) server actions: addComment/resolveComment/applySuggestion/deleteComment
                            + read: listComments(cardId)
  review.ts          (NEW) getSetReviewQueue(setId) → per-card open-proposal count +
                            unresolved field-anchored-suggestion count (comments with a non-null
                            suggested_value and resolved=false; general unresolved comments are NOT counted)

app/forge/cards/[cardId]/   ← the ONE shared studio route for BOTH private and set contexts
                               (there is no /forge/sets/[setId]/card/[cardId]; the parent-spec IA
                               diagram is aspirational — the editor is this single route)
  ReviewPanel.tsx    (NEW) card-level comment thread + suggestions (field-picker compose) +
                            open-proposals list + "Propose changes". RENDERS ONLY WHEN card.setId !== null
                            (proposals require a set; for private ideas the panel is hidden entirely).
  ProposalDiff.tsx   (NEW) Current vs Proposed (two ForgeCardPreview) + accept/deny + proposal comments
  CommentThread.tsx  (NEW) thread rendering + compose + reply + resolve + (suggestion) Apply
  page.tsx           (EDIT) load proposals/comments when setId !== null; render ReviewPanel
  LifecycleControls.tsx (EDIT) add "Propose changes" next to Publish (in-set branch only)

app/forge/sets/[setId]/review/
  page.tsx           (NEW) gated (set layout already gates); renders the queue
  ReviewQueue.tsx    (NEW) cards with open-proposal / unresolved-suggestion counts → links

__tests__/forge-anon-leak.test.ts (EDIT) add the 2 tables + 7 RPCs + _forge_can_read_card
app/forge/lib/__tests__/cardDiff.test.ts (NEW) pure diff unit tests
```

Note: the field-anchored "suggest" affordance lives **in the ReviewPanel** (a field-picker dropdown over the raw DesignCard keys), NOT inline in `FullModeForm.tsx` — so the existing editor form is untouched in 1b.1. An in-field "suggest this" affordance can ride a later polish slice.

**Patterns to follow exactly**
- Server actions: `"use server"`, return `{ ok: boolean; error?: string }` (or `{ ok: true; … } | { ok: false; error }`), `revalidatePath` after writes — like `lifecycle.ts`/`cards.ts`. **Per-action gate** (the gate is coarse; the RPC is authoritative): `createProposal`/`addComment`/`resolveComment` gate with `requireForge` (membership only — "can read the card" is enforced inside the RPC via `_forge_can_read_card`); `acceptProposal`/`denyProposal`/`applySuggestion`/`deleteComment` gate with `requireElder` as defense-in-depth on top of the RPC's own check. Do **not** use `requireElder` for create/comment — it would wrongly block the (Phase-2) read-capable non-elder the RPC is designed to allow.
- **`strict:false` gotcha:** client consumers of a discriminated `{ok:true}|{ok:false}` result MUST narrow with `r.ok === false` (or a loose `{ok:boolean;error?}` shape). Only `npm run build` catches a violation. (See `reference_tsconfig_strict_false_union_narrowing`.)
- Diff highlighting reuses `ForgeCardPreview`; no new card-rendering engine.
- Liveness = `router.refresh()` after each action (no Realtime).

**UX notes**
- The Review panel is utilitarian and mobile-first, consistent with the existing data-dense forge styling (plain Tailwind, no focus rings per `feedback_no_focus_rings`).
- Field suggestions are composed in the panel via a field picker over the raw DesignCard keys; Apply shows the before→after value inline.
- Accept/deny confirmation copy states the consequence ("publishes a new version and updates the working draft").
- **Mobile diff layout:** the two card previews stack vertically, but the plain-language change list **and** the Accept/Deny buttons render **above** the stacked previews, so a reviewer on a phone can act without scrolling past two full cards. On the card frame itself, field highlighting (e.g. ghosted→solid brigade pill) is the **cuttable** nice-to-have; the field-level change list is the MVP and must ship.

---

## Security & testing

- **Anon-leak guardrail** (`__tests__/forge-anon-leak.test.ts`): add `card_proposals`, `card_comments` to `FORGE_TABLES`; add all 7 new RPCs **and** `_forge_can_read_card` (with placeholder args) to `FORGE_RPCS` — every Forge definer function is anon-revoked-and-probed, no exceptions (cf. 052 probing the internal `is_forge_set_elder`/`is_forge_set_granted` helpers).
- **Member-vs-member isolation:** the existing `ISO_ENABLED` test proves a signed-in member can't read a foreign-owned card. Because the new SELECT predicate is **owner / set-elder / superadmin only** (no granted branch — see §Data model), no row a non-member can't already see via `forge_cards` becomes reachable through proposals/comments. A granted-playtester-vs-set isolation test is a Phase-2 task that lands when the granted branch is (deliberately, status-gated) activated.
- **Pure unit tests** for `cardDiff.ts` (added/removed/changed across scalar, array, and stat fields; empty-base "all added" case; no-change case).
- **Gates before "done":** migration 053 applied to prod (explicit per-migration authorization required — the auto-mode classifier blocks subagent-applied migrations); live `FORGE_LEAK_TEST=1 npm run test:security` green; `npm test` green (the pre-existing unrelated `store-route.test.ts` failure aside); `npm run build` clean; `get_advisors` shows no new findings. Signed-in browser smoke (propose → diff → accept → see new version; comment; suggest → apply) is the remaining manual step (no creds in an autonomous session).

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Concurrent accept / version-pointer corruption | `SELECT … FOR UPDATE` on `forge_cards`; `version_number` allocated under the lock; base-vs-published guard re-read under the lock with `IS DISTINCT FROM`. (Same shape as 052 publish/approve.) |
| Null base silently skips the stale-base guard | Guard uses `IS DISTINCT FROM` (not `<>`) so a first-version proposal (`base = NULL`) is superseded if the card gets published by another path. |
| Leak via the new tables to a future granted playtester | New SELECT predicate omits the granted branch entirely (elder-only surface); granted access is a deliberate, status-gated Phase-2 decision with its own isolation test. |
| Accept clobbers uncommitted draft edits | Documented tradeoff; UI states the consequence; presence (1b.2) will warn. |
| Leak via the new tables | Default-deny RLS + definer-only writes + anon revokes + extended leak test (the keystone guardrail). |
| `apply_suggestion` writes a junk field key | RPC allowlists raw `DesignCard` property keys (not the synthetic `FieldKey`) before `jsonb_set`, and re-checks the 64KB snapshot cap. |
| Scope creep into Realtime | Explicitly deferred to 1b.2; 1b.1 is refetch-only. |

---

## Out of scope (explicit)

Realtime/presence/live badges (1b.2); proposing art changes; N>1 approval; proposal reopen/re-base; a before/after proposal-timeline UI; playtester participation; email notifications.
