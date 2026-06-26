# Task 2 Report — Route shell, nav link, HistoryClient island

## What was built

- **`lib/nationals/types.ts`** — Added `LeaderboardEntry` interface and `SeedData` type alias (= `NationalsData`). Both are needed by `HistoryClient` props and the context hook.
- **`components/top-nav.tsx`** — Added `{ href: "/tournaments/history", label: "History", icon: FaBookOpen }` to `tournamentLinks`. `FaBookOpen` was already imported from `react-icons/fa6`.
- **`app/tournaments/history/seed-context.ts`** — `SeedContext` (React context of `SeedData | null`) + `useSeed()` hook that asserts non-null.
- **`app/tournaments/history/NavTabs.tsx`** — 7-tab bar with active/inactive Tailwind theme-token styles, `overflow-x-auto no-scrollbar`. Exports `ViewId` union type.
- **`app/tournaments/history/HistorySkeleton.tsx`** — Pulse skeleton: header bar + 6-card grid.
- **`app/tournaments/history/HistoryClient.tsx`** — `"use client"` island. Fetches `/data/nationals-history.json` on mount; renders `HistorySkeleton` until loaded. URL state via `useSearchParams` + `router.replace`. `setView(view, opts?)` and `back()` helpers. Wraps content in `SeedContext.Provider`. Accepts `initialLeaderboard?: LeaderboardEntry[]` (default `[]`). All 9 ViewId cases render placeholder `<div className="p-6 text-muted-foreground">{view} — coming soon</div>`.
- **`app/tournaments/history/page.tsx`** — Server component with `export const metadata`, `TopNav`, `SponsorFooter`, `Suspense` boundary wrapping `HistoryClient`.

## tsc result

`npx tsc --noEmit` — exit 2 with exactly 3 errors, all in `__tests__/forge-anon-leak.test.ts` (pre-existing). **Zero new errors.**

## vitest result

`npx vitest run` — 2 failing test suites (`forge-anon-leak.test.ts`, `store-route.test.ts`), both pre-existing. **Zero new failures.** 960 tests pass.

## Files changed

| Path | Action |
|------|--------|
| `lib/nationals/types.ts` | Modified — added `LeaderboardEntry` + `SeedData` |
| `components/top-nav.tsx` | Modified — added History nav link |
| `app/tournaments/history/seed-context.ts` | Created |
| `app/tournaments/history/NavTabs.tsx` | Created |
| `app/tournaments/history/HistorySkeleton.tsx` | Created |
| `app/tournaments/history/HistoryClient.tsx` | Created |
| `app/tournaments/history/page.tsx` | Created |

## Self-review findings

- `FaBookOpen` is imported from `react-icons/fa6` in top-nav, not `react-icons/fa` as the brief suggested; used the existing import correctly.
- `ViewId` is exported from `NavTabs.tsx` rather than a separate file; this keeps it colocated with the tab definitions and is what the brief implies.
- `void initialLeaderboard` comment prevents the "unused variable" lint warning while making Task 15's wiring point obvious.
- Used theme tokens throughout (`text-primary`, `border-primary`, `text-muted-foreground`, etc.) — no hardcoded colors.
- No `focus:ring-*` anywhere per project preference.

## Concerns

None. Implementation is straightforward and matches the brief exactly.

---

## Fix pass (review)

### Changes made

1. **`app/tournaments/history/HistoryClient.tsx`** — Two fixes:
   - Added a `VALID_VIEWS` `Set<ViewId>` and a `parseView()` helper that validates the `?view=` URL param, falling back to `"tournaments"` for any unknown value.
   - Added `fetchError` state; the `.fetch()` chain now has a `.catch(() => setFetchError(true))`. When `fetchError` is true, renders a `<div className="p-6 text-center text-muted-foreground">Couldn't load Nationals history. Please refresh.</div>` instead of the perpetual skeleton.
   - Converted the nine `{view === "..."}` conditional blocks to a `renderView()` switch with an explicit `default` case that renders the tournaments placeholder, ensuring no blank content area can appear.

2. **`app/tournaments/history/HistorySkeleton.tsx`** — Added `"use client"` directive to make intent explicit (it's used as a client-side Suspense/loading fallback).

3. **`app/tournaments/history/NavTabs.tsx`** — Added a one-line comment above the `TABS` array noting that `"detail"` and `"player"` are intentionally excluded as drill-down views.

### tsc result

`npx tsc --noEmit` — exit 2 with exactly 3 errors, all in `__tests__/forge-anon-leak.test.ts` (pre-existing Supabase client type mismatch). **Zero new errors introduced.**

### vitest summary

`npx vitest run` — 2 failing test files (`forge-anon-leak.test.ts`, `store-route.test.ts`), both pre-existing. **Zero new failures.** 960 tests pass, 8 skipped.
