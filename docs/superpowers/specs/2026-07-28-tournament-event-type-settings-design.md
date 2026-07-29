# Tournament event type in Settings — design

**Date:** 2026-07-28
**Status:** Approved, ready for implementation plan
**Branch:** `feat/event-type-settings`

## 1. Problem

A tournament's format lives in `tournaments.deck_format`, set once at creation from the
category the host checks in **Add Tournament** ([`app/tracker/tournaments/page.tsx:90-100`](../../../app/tracker/tournaments/page.tsx)).
After that:

- **No screen shows it.** The only UI that surfaces `deck_format` is the QR Join dialog,
  which put a `<select>` there because QR Join was the first feature that needed a format
  (to run deck check on submission) and there was nowhere else to edit it. Tournament-level
  config leaked into a feature-level dialog.
- **`category` is immutable.** It is written once at insert and updated nowhere in the
  codebase. A host who picks the wrong category has no recourse but to delete the event.
- PR #256 already locked the QR dialog's format field read-only for name-frozen categories,
  because editing it could desync `deck_format` from the frozen name (an event named
  "… Type 1 Unlimited Tournament" validating decks as Limited). That closed the symptom
  and left the cause: no tournament-level owner for event type.

Separately, **Tournament Settings' save feedback is misplaced.** The status indicator
(`Saving…` / `✓ Saved` / `Failed to save` / `Unsaved changes`) renders in the card header
at [`TournamentSettings.tsx:180-200`](../../../components/ui/TournamentSettings.tsx) while
the Save button sits at the bottom of a ~1300px-tall card. The host clicks Save at the
bottom and the confirmation flashes for 1.5s off-screen at the top.

## 2. Goals

1. Tournament Settings becomes the single owner of event type (category → format).
2. The QR Join dialog stops writing `deck_format` and becomes read-only about it.
3. Changing category cascades to the frozen name and category-derived settings under one
   predictable rule, previewed before save.
4. Save feedback lands where the host is looking.

**Non-goals:** re-running deck check on format change (ruled out — warn only); versioning
deck submissions; exposing format anywhere outside Settings and the QR dialog.

## 3. Locked decisions

| Question | Ruling |
|---|---|
| Name when category changes | **Regenerate automatically** when the new category is official. |
| Editable after decklists / start | **Allow, warn only** — stale legality verdicts are surfaced, not prevented. |
| Format select | Editable **only** for `Unofficial`; derived and read-only otherwise. |
| Save-row placement | Sticky footer inside the settings card. |

## 4. The cascade rule

One principle: **derived values the host has not overridden follow the category; anything
the host changed stays put.**

Concretely, given a category change from `old` → `next`:

| Field | Behavior |
|---|---|
| `category` | Set to `next`. |
| `deck_format` | `categoryDefaults(next).deck_format`, unless `next === "Unofficial"`, where it is the host's explicit select value. |
| `name` | Regenerated when `isNameFrozen(next)`. Left untouched when `next === "Unofficial"` (no frozen form exists). |
| `max_score` | Re-seeded to `categoryDefaults(next).max_score` **only if** it currently equals `categoryDefaults(old).max_score`. Skipped entirely when locked (round 1 started). |
| `round_length` | Same rule against `categoryDefaults(old).round_length`. |
| `require_decklists` | Same rule against `requireDecklistsDefault(old)`. |

**Hard invariant, overriding the rule above:** when the resolved `deck_format` is `"Other"`
or `null`, `require_decklists` is forced to `false`. A tournament with `require_decklists =
true` and no specific format is unjoinable — [`app/join/actions.ts`](../../../app/join/actions.ts)
returns `decklist_required` for every player. The re-seed rule alone does not prevent this
(host turns the toggle on for Type A, then switches to Booster Draft), so it is enforced
unconditionally.

### 4.1 Name regeneration

Applies only when `isNameFrozen(next)` — switching *to* `Unofficial` never touches the name.

Do **not** reformat from `created_at` — that is a UTC timestamp, while the stored name was
generated client-side in the host's timezone (`created_at = 2026-07-29 01:15Z` on an event
named "Jul 28, 2026 …"). Server- or UTC-side regeneration would shift the date.

Instead, swap the category token in place:

```
/^(.+?, \d{4}) (.+) Tournament(?: — (.+))?$/
      ^date       ^category            ^city
```

On match, keep group 1 (date) and group 3 (city) verbatim and substitute the new category.
On no match — the name is free-form, e.g. coming from `Unofficial` — fall back to
`buildTournamentName(next, { date: new Date(created_at) })`, preserving any ` — City`
suffix found in the current name.

**Accepted trade-off:** a host who renamed an official event by hand loses that name. The
post-creation rename paths ([`page.tsx:185`](../../../app/tracker/tournaments/page.tsx),
[`[id]/page.tsx:902`](../../../app/tracker/tournaments/[id]/page.tsx)) do not check
`isNameFrozen`, so hand-edited official names exist. The inline preview makes the
replacement visible rather than silent.

### 4.2 One pure function

```ts
// utils/tournament/categoryChange.ts
export interface CategoryChangePlan {
  category: string;
  deck_format: FormatId | "Other";
  name?: string;
  max_score?: number;
  round_length?: number;
  require_decklists?: boolean;
}

export function planCategoryChange(
  current: {
    name: string;
    category: string | null;
    deck_format: string | null;
    max_score: number | null;
    round_length: number | null;
    require_decklists: boolean | null;
    created_at: string;
  },
  next: { category: string; unofficialFormat?: FormatId | "Other" },
  opts: { maxScoreLocked: boolean }
): CategoryChangePlan;
```

`unofficialFormat` is read only when `next.category === "Unofficial"`. Omitted there, the
plan keeps `normalizeTournamentFormat(current.deck_format) ?? "Other"` — switching to
Unofficial preserves whatever format was already in force rather than resetting to `Other`
and silently disabling decklist requirements.

The same function drives both the preview and the persisted patch, so the two cannot
disagree. It is pure and unit-testable — no Supabase, no clock. Tests cover: official →
official re-seed, overridden field preserved, `maxScoreLocked` skip, the `Other` +
`require_decklists` invariant, city-suffix preservation, and the free-form-name fallback.

## 5. UI: Event Type section

A new section at the top of the Tournament Settings card, above the status row.

- **Category** — a `<select>` over `STANDARD_CATEGORIES`.
  **Legacy categories must not be silently coerced.** Prod holds category values that came
  from official listings and are absent from `STANDARD_CATEGORIES`: `Type 1`,
  `Type 1 - 2P`, `Type 1 - 2 Player`, `Type 1 - Teams`, `Type 2 - 2P`, `Type 2 - 2 Player`
  (12 rows). When the tournament's current category is not in the list, prepend it as an
  option so opening Settings never changes what is displayed.
- **Format** — read-only display (`Unlimited · set by category`) for every category except
  `Unofficial`, which gets an editable select over `FORMAT_IDS` + `Other`.
- **Change preview** — while the category select differs from the persisted value, render
  the diff produced by `planCategoryChange`:
  > Will rename to *Jul 28, 2026 Type 2 Tournament* · Lost Souls 5 → 7 · Round length 45 → 75
- **Stale-verdict warning** — when `deck_format` would change and submissions exist, amber:
  > 3 submitted decklists were checked against Unlimited. Changing the format won't re-check
  > them — their legality badges will be stale.

  The count comes from `getJoinStatsAction(tournamentId).submitted`, which is already
  host-gated and reads the default-deny `tournament_deck_submissions` table via the admin
  client. Reuse it rather than adding a query.
- **Locking** — the whole section respects the existing `editingDisabled` (tournament
  ended). It is *not* locked by `has_started`, per the warn-only ruling.

### 5.1 No data backfill

Legacy rows store `deck_format = 'T1'` (12 rows) where `categoryDefaults` now yields
`Limited`. No migration is needed: every consumer reads through
`normalizeTournamentFormat`, and `normalizeFormat('T1')` already falls through to
`'Limited'`. Settings writes canonical `FormatId`s going forward; old values keep
normalizing correctly.

## 6. QR Join dialog

- Format renders read-only for **all** categories, not just name-frozen ones. Hint text:
  "Set in the Settings tab." No link — cross-tab navigation from a dialog is plumbing this
  does not need.
- `formatLocked` and the editable `<select>` branch are deleted;
  [`initialFormat()`](../../../components/ui/QRJoinDialog.tsx) is kept as-is (it derives
  from category for name-frozen events, which stays correct and covers legacy drift).
- `updateJoinSettingsAction` drops `deckFormat` from its payload and writes only
  `require_decklists`. `handleFormatChange` is deleted.
- The `format_required` error message changes to point at Settings:
  "Set a format in the Settings tab before requiring decklists."

Resulting boundary: **Settings owns event identity** (category → format); **the QR dialog
owns join knobs** (code, require-decklist, live counters).

## 7. Save feedback

1. The footer row (`isDirty` text + Save button) becomes `sticky bottom-0` inside the card,
   so the button and its status stay visible while editing a tall form.
2. The live status moves next to the button: `Unsaved changes` → `Saving…` → `✓ Saved`
   (flash extended 1.5s → 3s) / `Failed to save: <reason>`. The header keeps no duplicate.
3. Real errors surface. `handleSave` currently `console.error`s and renders a bare
   "Failed to save", making an RLS denial and a network drop indistinguishable. Render
   `error.message`.
4. When clean, the footer reads "No changes to save" so the dim button is explained.

## 8. Data flow

`TournamentSettings` already writes with the browser Supabase client; the
`host_can_access_tournaments` RLS policy is `ALL` on `auth.uid() = host_id`, so `name`,
`category`, and `deck_format` are all writable from the client exactly like the existing
fields. No new server action is needed for the save itself.

Changes required around it:

- Extend the settings `SELECT` to include `name`, `category`, `deck_format`,
  `require_decklists`, `created_at`.
- Category is tracked outside `EDITABLE_KEYS`; on save, when it changed, merge
  `planCategoryChange(...)` into the patch. The scalar-field diff is unchanged.
- Add an `onTournamentUpdated?: () => void` prop to `TournamentSettings`, threaded through
  [`TournamentTabs.tsx:371`](../../../components/ui/TournamentTabs.tsx) to
  `fetchTournamentDetails` in [`[id]/page.tsx`](../../../app/tracker/tournaments/[id]/page.tsx),
  so a rename refreshes the page header. `key={activeTab}` already remounts the component
  per tab visit, so no other staleness handling is needed.

## 9. Testing

**Unit** (`utils/tournament/__tests__/categoryChange.test.ts`) — the cascade cases in §4.2,
plus the name regex against every prod-observed name shape.

**Component/manual** — change category on a fresh event and confirm rename + re-seed;
change it on an event with a submitted decklist and confirm the amber warning and that
verdicts are left alone; change it after round 1 and confirm `max_score` is untouched;
open Settings on a legacy `Type 1 - 2P` event and confirm the category is not coerced;
confirm the QR dialog shows format read-only and can still toggle require-decklist.

**Regression** — `updateJoinSettingsAction` no longer accepting `deckFormat` must not break
`app/join/__tests__/actions.test.ts` or the QR dialog's enable path, which calls it before
`setQrJoinEnabledAction`.

## 10. Out of scope

- Re-running deck check on format change (explicitly ruled out).
- Deck-submission history — resubmission overwrites via `onConflict: "participant_id"`.
- Showing format on the tournament detail header or the public results page.
- Server-side enforcement that `deck_format` matches `category`; Settings and the create
  modal are the only writers, and both derive it.
