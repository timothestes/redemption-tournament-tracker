# Nationals History Page — Design Spec

**Date:** 2026-06-25
**Status:** Approved design (pending user spec review)
**Route:** `/tournaments/history` · **Nav label:** "History" (Tournaments dropdown)

## 1. Goal

Port a self-contained, externally-developed HTML single-page app
(`nationals-history (36).html`, 3.2 MB) into the Redemption Tournament Tracker as a
new page under the **Tournaments** dropdown. The page presents the complete history of
Redemption Nationals tournaments (back to 2003): tournaments, champions, players, an
interactive trivia game with a persistent leaderboard, advanced metrics, head-to-head
comparison, and global search.

The external author had no context about our app, so the port must:

- Look and feel like the rest of the app (TopNav, SponsorFooter, shadcn/Tailwind, design tokens).
- Work correctly in **light / dark / jayden** themes.
- Fix a known bug where grids with fewer than 3 cards render the cards oversized.
- Replace the source's ad-hoc data/persistence layer (a Cloudflare Worker + `localStorage`)
  with app-native patterns (static committed data + a Supabase-backed leaderboard).

## 2. Source app summary (what we're porting)

Single HTML file structure: `<style>` (lines 1–225, a hardcoded dark teal/gold palette via
CSS custom properties), body HTML (227–546), `<script>` (547+) whose **line 556 is a single
3.1 MB `const SEED_DATA = {...}`** blob, followed by ~2700 lines of vanilla JS render logic.

**Data shape** (`SEED_DATA`):
- `tournaments[]` — `{ id, year, location, dates, venue, attendance, formats[], notes, fantasyDraft? }`
- `players[]` — `{ id, name, handle, region, notes }`
- `results{}` — keyed `"<year>_<format>"` → `[{ playerName, placement, deck, record, notes }]`
- `matches{}` — keyed `"<year>_<format>"` → `[{ round, table, playerA, playerB, scoreA, scoreB, winner, topCut, notes }]`

**Seven views** (tabs toggled by `switchView()`), plus two drill-down views:
1. **Tournaments** — cards grid (`#tournamentGrid`) → **Tournament Detail** (`#view-detail`): header,
   format filter tabs, per-format results + rounds/matches, prev/next-year nav, **US-state map**
   (host state + city pin), and a **Promo Cards** modal.
2. **Hall of Champions** — format filter + 4 sorts (wins / name / recent / oldest).
3. **Players** — searchable list → **Player Profile** (`#view-player`): appearances, placements,
   match record, fantasy-draft history.
4. **Trivia** — Start → 10 questions generated client-side from the data → score (10/correct,
   +5 streak bonus at streak ≥ 2; max 150) → **Submit Score** → persistent leaderboard.
5. **Advanced Metrics** — 10 modes (`AM_MODES`: winpct, placement, podiums, lsd, pts, multiwl,
   topcut, rivalry, unique, vsp) with format multiselect, year range / custom years,
   min/max appearances, min/max Nationals attended, and a compare-player overlay.
6. **Tale of the Tape** — two-player head-to-head from match data.
7. **Search** — global search across players / tournaments / locations.

**To drop / replace:**
- Cloudflare Worker DB-sync (`USE_WORKER`, `WORKER_URL`) and its **hardcoded secret
  `WRITE_SECRET='RollTide1'`** — must never be committed. Data becomes static/read-only.
- `localStorage` trivia leaderboard → Supabase (Section 8).
- The promo-card image source: a GitHub-raw fetch of *our own* `lib/cards/generated/cardData.json`
  (line 2561) → use the local card data instead.
- The US-map CDN `<script>` injection → bundled npm deps (Section 7).

## 3. Resolved design decisions

These were settled by two independent design passes + a two-reviewer reconciliation.

| # | Decision | Resolution |
|---|----------|------------|
| D1 | **3.1 MB data delivery** | Commit as `public/data/nationals-history.json`; fetch client-side on mount with a loading skeleton. 0 bytes in the JS bundle and 0 in the RSC payload; served as an immutable-cached CDN asset (free repeat visits / tab switches). |
| D2 | **Trivia RLS** | Direct table policies: anon+authenticated `SELECT USING(true)` + `INSERT WITH CHECK(true)`; `REVOKE UPDATE/DELETE`. CHECK constraints are the real validation boundary. (Matches public-write precedent migrations 003/014.) |
| D3 | **Code layout** | Views + client components under `app/tournaments/history/`; pure logic/types/tests in a new `lib/nationals/` — mirrors `lib/rnrs/` + `app/tournaments/rnrs-points/`. |
| D4a | **US-state map** | **Keep** (user decision). Port via npm `d3-geo` + `topojson-client`, lazy-loaded with `next/dynamic({ ssr:false })`, fail-soft. Commit the `us-atlas` states topojson as a static asset (`public/data/us-states-10m.json`) instead of CDN-fetching. |
| D4b | **Promo card images** | Source from local card data (`lib/cards/lookup` / `lib/cards/generated`) + the existing image-URL helper (`app/shared/utils/cardImageUrl`). Remove the GitHub-raw fetch. |

**Chosen defaults** (changeable):
- Leaderboard stores all attempts; displays top 20 (matches original).
- Client-computed scores accepted as-is for a hobby board; the server clamps the range only.
- No profanity filter in v1 (names are anonymous public input) — flagged as an optional follow-up.
- New tournament data is added by regenerating the JSON and committing (no runtime admin UI in scope).

## 4. Architecture

**Server shell** `app/tournaments/history/page.tsx` (modeled on `app/tournaments/rnrs-points/page.tsx`):

```tsx
export const metadata = { title: "Nationals History | Redemption CCG", description: "…" };
export default async function Page() {
  const leaderboard = await loadLeaderboard(); // SSR top-20 for first paint
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1">
        <Suspense fallback={<HistorySkeleton />}>
          <HistoryClient initialLeaderboard={leaderboard} />
        </Suspense>
      </div>
      <SponsorFooter />
    </div>
  );
}
```

The page does **not** load the 3.1 MB blob; `HistoryClient` fetches `/data/nationals-history.json`
on mount and shows a skeleton while loading. `<Suspense>` is required because the client island
uses `useSearchParams`.

**One client island** `HistoryClient` owns: the fetched dataset (in context), the active `view`
(7 values + `detail`/`player` drill-downs), and the selected tournament/player ids. It mirrors
state to `?view=` / `?t=` / `?p=` query params (hydrated from the URL on mount) so views are
linkable and the back button works. Exactly one view renders at a time (conditional render,
replacing the source's `display:none` toggling). No nested routes (would remount and lose the
in-memory dataset).

### File layout

```
app/tournaments/history/
  page.tsx                      # server shell (metadata, SSR leaderboard, island)
  actions.ts                    # "use server": submitTriviaScore(), loadLeaderboard()
  HistoryClient.tsx             # "use client" island: data fetch + view/URL state + context
  HistorySkeleton.tsx           # loading skeleton (bg-muted animate-pulse)
  NavTabs.tsx                   # the 7-view tab bar
  views/
    TournamentsView.tsx
    TournamentDetailView.tsx    # incl. <StateMap/> + promo-cards modal
    ChampionsView.tsx
    PlayersView.tsx
    PlayerProfileView.tsx
    TriviaView.tsx              # quiz state machine + leaderboard (server actions)
    MetricsView.tsx             # 10 modes + filters
    TaleOfTheTapeView.tsx
    SearchView.tsx
  components/
    FormatBadge.tsx             # categorical format → token classes
    PlacementBadge.tsx          # medals (place/rank 1/2/3 + n)
    StateMap.tsx                # client-only, dynamic ssr:false, fail-soft
    PromoCardsModal.tsx         # promo images from local card data
    EmptyState.tsx
    SectionTitle.tsx

lib/nationals/
  types.ts                      # SeedData, Tournament, PlayerRow, ResultRow, MatchRow, LeaderboardEntry
  trivia.ts        (+ .test.ts) # buildTriviaQuestions(seed): Question[]  (pure)
  metrics.ts       (+ .test.ts) # one pure fn per AM mode; computeMetric(mode, seed, filters)
  search.ts        (+ .test.ts) # globalSearch, playerHeadToHead (pure)
  format.ts        (+ .test.ts) # fmtClass, stateAbbr, key parse, shuffle, date/ordinal fmt
  promos.ts                     # PROMO_CARDS map (year → [{label, cardName, imgFile}])

public/data/
  nationals-history.json        # the SEED_DATA blob
  us-states-10m.json            # us-atlas topojson (for StateMap)

supabase/migrations/
  056_nationals_trivia_leaderboard.sql
```

## 5. Porting strategy (~2700 lines vanilla JS → React/TS)

Separate **pure computation** (→ `lib/nationals/*`, no DOM) from **rendering** (→ JSX). Mechanical
translations: `innerHTML = arr.map(...).join('')` → JSX `.map()`; inline `onclick` → `onClick`;
`display`/`.active` toggles → conditional rendering; global mutable vars (`db`, `amMode`, …) →
`useState`/`useReducer`; `db` is immutable (no save path).

**Trickiest pieces:**
- **`buildTriviaQuestions`** (~260 lines, ~15 question categories incl. promo/host-from-notes/
  top-cut reconstruction) — port verbatim as a pure function over the dataset; keep the `>=3/>=4`
  option-count guards; seed-optional `shuffle` for deterministic tests. Quiz scoring/streak →
  `useReducer` in `TriviaView`.
- **Advanced Metrics** — `useReducer` for the filter cluster; `computeMetric(mode, seed, filters)`
  returns `{ columns, rows }`; each of the 10 modes is its own pure function; the view renders
  columns/rows and handles sort. Typeaheads (compare/vsp) are controlled inputs over the player index.
- **Search / Tale of the Tape** — `globalSearch(seed, q)` and `playerHeadToHead(seed, a, b)` are pure.

## 6. Theming (light / dark / jayden)

Full re-skin to the app's semantic Tailwind tokens (no scoped teal/gold palette, no new global vars):

| Source var | Token / class |
|---|---|
| `--bg` | `bg-background` |
| `--surface` / `--surface2` / `--surface3` | `bg-card` / `bg-muted` / `bg-secondary` |
| `--text` / `--text-muted` / `--text-dim` | `text-foreground` / `text-muted-foreground` / `text-muted-foreground/70` |
| `--border` / `--border-mid` | `border-border` |
| `--teal*` (primary accent, links, active tab) | `text-primary` / `bg-primary` / `border-primary` / `ring-primary` |
| `--teal-light` / `--teal-glow` | `bg-primary/10` / `bg-primary/15` |
| `--radius` / `--radius-sm` | `rounded-lg` / `rounded-md`; shadows → `shadow-sm` / `shadow-lg` |

Buttons → shadcn `<Button>` (default / `variant="outline"`). Active nav tab → `text-primary border-primary`.

**Categorical colors stay fixed-hue** (not tokens), via lookup maps with `dark:` + `[.jayden_&]:`
variants so they read on every theme:
- **Format badges** (`FormatBadge`): T1 blue / T2 pink / Sealed violet / Booster amber / Teams emerald /
  TypeA red — e.g. `bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30`.
- **Placement medals** (`PlacementBadge`): gold=amber, silver=slate, bronze=orange; `n` → `bg-muted text-muted-foreground`.
- **Win/loss + trivia correct/wrong**: emerald / red (winner also `font-medium`; loser `text-muted-foreground`).
- **Champions gold**: amber utilities in-component (optional `[.jayden_&]:` pink nudge).

## 7. US-state map (`StateMap.tsx`)

Used in **Tournament Detail** to show the host state with a city pin (`CITY_COORDS`).
- Add deps: `d3-geo`, `topojson-client`. Commit `public/data/us-states-10m.json` (us-atlas states-10m).
- Render via `next/dynamic(() => import('./StateMap'), { ssr: false })`; load the atlas once
  (module-scope memo). Project with `geoMercator().fitSize(...)` + `geoPath` (port lines 709–727).
- **Fail-soft**: if the atlas fetch or projection fails, render nothing (or a small placeholder) —
  never block the detail view.

## 8. Trivia backend

**Migration `056_nationals_trivia_leaderboard.sql`** (next after 055; bump if another branch claims it):

```sql
CREATE TABLE public.nationals_trivia_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 12),
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 150),  -- 10 Qs × (10 + 5 streak bonus)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nationals_trivia_scores_score
  ON public.nationals_trivia_scores (score DESC, created_at ASC);

ALTER TABLE public.nationals_trivia_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trivia_scores_select" ON public.nationals_trivia_scores
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "trivia_scores_insert" ON public.nationals_trivia_scores
  FOR INSERT TO anon, authenticated WITH CHECK (true);
REVOKE UPDATE, DELETE ON public.nationals_trivia_scores FROM anon, authenticated;
```

**Server actions** (`app/tournaments/history/actions.ts`, `"use server"`, `createClient()` from
`utils/supabase/server`):

```ts
export interface LeaderboardEntry { name: string; score: number; created_at: string; }

loadLeaderboard(limit = 20): Promise<LeaderboardEntry[]>
  // SELECT name, score, created_at ORDER BY score DESC, created_at ASC LIMIT 20

submitTriviaScore(input: { name: string; score: number }):
  Promise<{ ok: true; leaderboard: LeaderboardEntry[] } | { ok: false; error: string }>
  // trim name to 12 + clamp score 0..150, insert, return fresh top-20
```

The leaderboard SSR-renders on first paint (passed as `initialLeaderboard`); after a submit, the
view replaces local state with the returned list and shows a success toast. Display date =
`new Date(created_at).toLocaleDateString()`.

**Anti-abuse:** server trim/clamp + DB CHECK constraints; no IP rate-limit in v1 (a flooded board is
a manual `DELETE` by an admin). Scores are client-computed and thus spoofable within range — accepted
for a hobby board (matches the original's trust model).

## 9. Top-nav integration

In `components/top-nav.tsx`, add to `tournamentLinks` (~line 136):

```ts
{ href: "/tournaments/history", label: "History", icon: FaBookOpen },
```

Renders in both the desktop dropdown and the mobile section automatically. The existing active-state
logic (`isActive('/tournaments')`, startsWith) already lights the "Tournaments" group for the new path.

## 10. The grid bug

**Cause:** `.cards-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)) }` — `1fr` lets
the few existing cards stretch to fill the row, so 1–2 cards balloon (≈ half/third of a 1200px container).

**Fix (in the React/Tailwind port):** bound the track and left-align so sparse rows keep natural size:

```tsx
<div className="grid gap-4 justify-start
                [grid-template-columns:repeat(auto-fill,minmax(240px,320px))]">
```

Champions grid uses `minmax(210px,300px)`. Verify with 1, 2, 3, and 8 cards.

## 11. Build / perf / verification

- `npx tsc --noEmit` clean (tsconfig `strict:false` — keep the source's optional-chaining guards; type
  the `lib/nationals` signatures).
- `next build` clean: route's First Load JS comparable to `rnrs-points`; the 3.1 MB blob appears only
  as `/public/data/...json`, never in a JS chunk or the RSC payload; `d3-geo`/`topojson` are in the
  async `StateMap` chunk; no "document is not defined" (StateMap is `ssr:false`); no missing-Suspense warning.
- Manual: all 7 views + both drill-downs in light/dark/jayden (badge/medal/win-loss contrast); grid
  with 1/2/3/8 cards; mobile throttled (skeleton shows, nav tabs scroll); state map renders and
  fails soft; promo modal images resolve from local card data.
- Trivia E2E (anon browser): play → submit → persists in `nationals_trivia_scores` → appears on board →
  survives reload → visible logged-out; attempted UPDATE via anon client is denied; `score=999999` /
  50-char name rejected/clamped. Run `get_advisors` after the migration.

## 12. Implementation isolation

Another agent is working in the repo concurrently. Implement this feature in a **dedicated git
worktree** to avoid colliding edits, then integrate per the finishing-a-development-branch flow.

## 13. Open items / risks

- Migration number `056` may collide if a concurrent branch also adds one — verify and bump at merge.
- Profanity on public leaderboard names — optional follow-up (banned-words check) if it becomes a problem.
- Dataset freshness — document the regenerate-JSON-and-commit workflow; current source is the worker's stored DB.
- If the dataset grows materially (>~10 MB), revisit the summary/heavy split for first-load.
