# Forge UI/UX Pass — Design

**Date:** 2026-07-03
**Status:** Approved (user selected "Playtest-centric + Release" terminology and "drop the Desk tab")
**Branch:** `forge-uiux-pass` (off `main`, after PR #145 Lackey import merged)
**Companion docs:** `2026-07-03-forge-import-uiux-followup.md` (roughness notes; the items NOT covered here stay there)

## Goal

Elder-facing polish pass on the Forge so that getting an imported set into playtesters'
hands — and managing cards afterward — is fast, legible, and consistent across
light/dark/jayden themes. Six workstreams, one branch, **zero migrations, zero new RPCs**:
everything composes existing SECURITY DEFINER RPCs via server actions. The security spine
is untouched.

## Context (verified against code, 2026-07-03)

- Lifecycle states: `private_idea → draft → playtesting → approved → archived`
  (`forge_card_status`, migration 051; transitions in 052).
- **Migration 057 already reveals `playtesting` cards to granted playtesters.** Publish is
  therefore the one-click "release": it freezes `working_snapshot` into an immutable
  `card_versions` row and flips status to `playtesting`, which is playtester-visible.
  Approve merely marks the version/card Final (locked). Nothing "unpublishes"; archive or
  send-to-private are how a card leaves playtester view.
- Current UI verbs (Publish / Approve / Unapprove / Archive / Unarchive / Send back to
  private / Delete) describe mechanism, not outcome, and "Approve" collides with the
  review queue's proposal accept/deny vocabulary.
- The set cards view (`/forge/sets/[setId]/cards`) has no filters and no actions; Ideas
  has search + type + brigade filters. Neither has multi-select.
- No breadcrumbs anywhere; each page hand-rolls a "← Sets"-style back link.
- "Desk" is a nav tab duplicating the "The Forge" wordmark link.
- Hardcoded colors (`emerald-600`, `amber-600`, `red-600`, `bg-zinc-400`, inline hex) are
  scattered across ~7 forge files; "jayden" is a pure CSS class theme, so token-driven
  styling is all it needs.

## 1. Lifecycle terminology

New copy, single source of truth in **`app/forge/lib/lifecycleCopy.ts`** (status labels,
action labels, confirm-dialog copy). Consumed by `LifecycleControls`, `ForgeCardGrid`
badges, and the new bulk bar. RPCs and server actions are unchanged.

| RPC / action (unchanged) | Old label | New label |
|---|---|---|
| `publish` from `draft` | Publish | **Release to playtest** |
| `publish` from `playtesting` | Publish | **Release update** |
| `approve` | Approve | **Mark final** |
| `unapprove` | Unapprove | **Reopen testing** |
| `archive` / `unarchive` | Archive / Unarchive | **Shelve** / **Restore** |
| `sendToPrivate` | Send back to private | **Return to ideas** |
| `deleteCard` | Delete | **Delete** (destructive stays plain) |

- Status path in LifecycleControls: **Draft › In playtest › Final**.
- Status badges: `private_idea` → Idea, `draft` → Draft, `playtesting` → **In playtest**,
  `approved` → Final, `archived` → **Shelved**.
- Confirm copy updated to match (e.g. Return to ideas: "Return this card to your private
  ideas? Its released versions will be retired.").
- "Release update" is the publish button's label when status is `playtesting` (the RPC
  allows publish from `draft` or `playtesting`); it freezes a new version.

## 2. Set cards view: filters + bulk actions

`app/forge/sets/[setId]/cards/page.tsx` stays a server component (gate + `listSetCards`);
the grid becomes a client **`SetCardsBrowser`**.

**Filters** (client-side, mirroring `IdeasLibrary` exactly in styling — native selects):
- Search: matches title **and** rawText (case-insensitive substring).
- Status select: Draft / In playtest / Final / Shelved (values = enum values).
- Type select + Brigade select (from `CARD_TYPES` / `BRIGADES`; snapshot fields may be
  empty on imported cards — filters simply don't match those cards when set).

**Bulk actions**:
- A "Select" toggle button enters selection mode: checkbox overlay on each card corner,
  card click toggles selection instead of navigating, "Select all (filtered)" +
  "Clear" links, count shown.
- Sticky bottom bar (only in selection mode, only for elders — the page already redirects
  playtesters) with: **Release to playtest · Mark final · Shelve · Restore ·
  Return to ideas · Delete**. Delete and Return to ideas use the existing
  `ConfirmationDialog` (destructive variant for Delete).
- Server: **`bulkLifecycle(action, cardIds[])`** server action in
  `app/forge/lib/lifecycle.ts`. `requireElder()` once, then loop the existing per-card
  exported functions' RPC calls sequentially. Returns `{done, skipped, failed}`.
  Cards whose state doesn't admit the action are **skipped, not failed** (the RPCs
  raise on bad state; catch per card and classify). One `revalidatePath` at the end,
  not per card. Cap: reject > 500 ids (sanity bound, not a product limit).
- Result toast/summary line: "Released 12 · 3 skipped · 0 failed". Button pending state
  while running (147 cards ≈ seconds).

## 3. Ideas → sets bulk send

- Extract the selection mechanics into a shared client wrapper
  **`app/forge/components/SelectableCardGrid.tsx`** (wraps `ForgeCardGrid` rendering;
  selection state lives in the parent via a small hook or props). Used by both
  `SetCardsBrowser` and `IdeasLibrary`.
- IdeasLibrary gains the same "Select" toggle; its bulk bar has exactly two actions:
  **Send to set…** (native select of elder's sets, loops `shareToSet` via a
  `bulkShareToSet(setId, cardIds[])` server action with the same skip/fail semantics)
  and **Delete** (ConfirmationDialog).

## 4. Card detail page polish (`/forge/cards/[cardId]`)

Structural/visual only — no behavior changes beyond listed:
- Header: breadcrumb (§5) + card title area, status shown as a shadcn `Badge`, lifecycle
  actions grouped: primary CTA (Release to playtest / Release update / Mark final,
  whichever applies) as a real `Button`, secondary verbs as `outline` buttons, Delete as
  `destructive` outline. Wraps cleanly on mobile instead of one xs-text line.
- Replace hardcoded `emerald-600` / `amber-600` / `red-600` with shadcn `Button` variants
  and semantic tokens throughout `StudioEditor`, `LifecycleControls`, `CommentThread`,
  `ProposalDiff`.
- Finished-image replace confirmation: inline amber box → existing `ConfirmationDialog`
  modal (follow-up doc §4 item).
- Per-input busy state (spinner + disabled) on both file inputs during upload.
- Artwork / Finished card fieldsets: consistent card-style framing (border, padding,
  heading) matching the rest of the app's shadcn look.
- No focus rings added (user rule); green reserved for primary CTAs (user rule).

## 5. Breadcrumbs, nav, landing

**Breadcrumbs** — new **`app/forge/components/ForgeBreadcrumbs.tsx`** (shadcn breadcrumb
pattern; plain links + `›` separators, `text-muted-foreground`, current page
`text-foreground`). Replaces every ad-hoc back link:
- Set subtree (`layout.tsx` renders it once): `The Forge › Sets › {Set name} › {Tab}`.
- Card page: `The Forge › Sets › {Set} › {Card title}` when in a set,
  `The Forge › Ideas › {Card title}` when private.
- Top-level tab pages (Ideas, Sets, Play, Admin, Import) get none — the nav shows place.
- Playtester reveal (`/forge/play/[setId]`): `The Forge › Sets › {Set name}` (playtester
  variant links to `/forge/play`).

**Nav** — remove the "Desk" tab for both roles in `ForgeNav.tsx`; the "The Forge"
wordmark remains the home link. Import stays reachable from Sets index + landing quick
action (unchanged from today: it's linked, not a tab).

**Landing** (`app/forge/page.tsx`) — role-aware dashboard, all existing RLS-scoped reads:
- Elder/super: **Your sets** (name, card count, status mix as small counts — one query
  via existing `listSets` + a grouped count over `listSetCards`-style select),
  **Recently edited** (top 6 cards by `updated_at` across own ideas + elder sets — reuse
  existing list functions, merge + sort in server code), **Quick actions** (New idea ·
  Import set · New set). Superadmin additionally sees the Admin tile.
- Playtester: existing tiles kept, plus granted sets listed inline (via `listSets`).
- Signed-in line (email · role) kept, demoted to small footer text.

## 6. Theme compatibility (light / dark / jayden)

- Token sweep across `app/forge`: `emerald-600` → `bg-primary text-primary-foreground`
  (or `Button` default variant), `red-600`/`red-300` → `destructive` tokens/variant,
  `bg-zinc-400` (ProgressDashboard neutral bar) → `bg-muted-foreground/40`, amber
  callouts → token-based warning styling with `dark:` variants.
- `ForgeCardFace` inline styles reviewed; keep art rendering neutral but ensure text tile
  uses `bg-card text-card-foreground border` tokens.
- **Out of scope:** `ForgeCardPreview.tsx` hex colors (descoped legacy composite, only
  ProposalDiff + deckbuilder still render it).
- Verification: Playwright screenshots of landing, set cards (with selection mode open),
  card detail, and ideas in **light, dark, and jayden** — reviewed before completion.

## Addendum (2026-07-04, user follow-ups on PR #148)

1. **Drop "Recently edited"** from the landing dashboard; remove the now-unused
   `listRecentCards` (added by this branch, no other consumers).
2. **Bulk delete sets (cascade), with confirmation.** New migration
   `063_forge_delete_set.sql`: `forge_delete_set(p_set_id)` SECURITY DEFINER RPC
   (set-elder-or-superadmin, `search_path=''`, anon-revoked, added to the anon-leak
   probe list) that deletes every card in the set via `forge_delete_card`, then the
   set's grants/elders rows, then the set. User chose **cascade** (junk-set cleanup);
   prod apply authorized. UI: selection mode on `/forge/sets` with a destructive
   ConfirmationDialog listing each selected set + its card count; summary
   "Deleted N · K failed". Server action `bulkDeleteSets(setIds)` loops the RPC.
3. **Import overwrite.** "Overwrite existing cards" toggle in the wizard (only for
   the add-to-existing-set destination). Matched titles get `forge_save_card`
   (name + rawText) + `forge_set_working_finished` (when the zip has an image)
   on the EXISTING card instead of a skip; new titles still created; cards absent
   from the zip untouched; frozen released versions untouched (re-release via bulk
   "Release update"). No migration. Summary gains an "Updated Y" segment only when
   overwrite was on (existing e2e assertions on the exact skip-summary stay valid).

## Out of scope (stays in the follow-up doc)

Import wizard stepper, chip ranking, progress bar/ETA, beforeunload guard,
thumbnails-at-import, reveal-grid `t=` caching, diff-mode re-import,
`forge_import_card` RPC, error→copy map.

## Success criteria

1. `npm run build` clean; `npm test` green (modulo pre-existing unrelated failures);
   `forge-gate-first` and anon-leak suites untouched and green (no new routes, tables,
   or RPCs).
2. Playwright import e2e (`e2e/forge/import.spec.ts`) still green.
3. New behavior covered: unit tests for `lifecycleCopy` mapping and bulk
   skip/fail classification; an e2e or component-level check that bulk release on a
   seeded set flips statuses.
4. Theme screenshots (3 themes × 4 pages) captured and visually sane.
5. No `emerald-`, `bg-zinc-`, raw `red-600` classes remain under `app/forge`
   (grep check), excluding `ForgeCardPreview.tsx` and `FullModeForm.tsx` (both
   descoped 2026-07-03, kept on disk unused for recovery).
