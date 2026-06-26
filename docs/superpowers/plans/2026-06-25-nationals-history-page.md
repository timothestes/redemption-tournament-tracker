# Nationals History Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the externally-developed `nationals-history (36).html` single-page app into the Redemption Tournament Tracker as a new `/tournaments/history` page (Tournaments dropdown), faithful to all 7 views, re-skinned to the app's themes, with a Supabase-backed trivia leaderboard.

**Architecture:** A server shell (`page.tsx`) renders `TopNav` + a single `"use client"` island (`HistoryClient`) + `SponsorFooter`. The island fetches a committed static dataset (`public/data/nationals-history.json`) on mount behind a skeleton, holds it in React context, and renders one of 7 views (plus tournament/player drill-downs) selected by React state mirrored to `?view=`/`?t=`/`?p=` URL params. All non-trivial computation lives as pure functions in `lib/nationals/*` (unit-tested with Vitest); views are thin. The trivia leaderboard persists in a new Supabase table via server actions.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (tsconfig `strict:false`), Tailwind + shadcn/ui, Supabase (Postgres + RLS), Vitest, `d3-geo` + `topojson-client` (new deps for the state map), `react-icons`.

## Global Constraints

- Work entirely in the worktree at `.claude/worktrees/nationals-history` (branch `worktree-nationals-history`); do not touch the concurrent forge branch.
- Source of truth for behavior: `nationals-history (36).html` at repo root (copied into the worktree, gitignored). Cited as `SRC:<line>`. **Never read SRC line 556** (the 3.1 MB `SEED_DATA` blob) into context — extract it with shell only.
- **Never commit** the source's hardcoded `WRITE_SECRET='RollTide1'`, the Cloudflare Worker sync, or any `localStorage` persistence.
- Theming: re-skin to the app's semantic Tailwind tokens (`bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-primary`/`bg-primary`). No new global CSS variables. Categorical colors (format badges, medals, win/loss, trivia right/wrong, champions gold) use fixed-hue Tailwind maps with `dark:` + `[.jayden_&]:` variants. Every view must be legible in light / dark / jayden.
- Pure logic → `lib/nationals/*.ts` with co-located `*.test.ts` (Vitest), mirroring `lib/rnrs/`. View components → `app/tournaments/history/`.
- Frequent commits: one per task minimum. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Migration numbering: use `056_` unless `git log`/`supabase/migrations/` shows it taken at implementation time — then use the next free number.
- Run `npm install` once before Task 1 (worktree has no `node_modules`). Baseline: `npx vitest run` should pass before starting.

---

## Data model (defined in Task 1, used everywhere)

```ts
// lib/nationals/types.ts
export interface BreakdownRow { format: string; pts: number }
export interface FantasyPlayer { name: string; pts: number; breakdown: BreakdownRow[]; draftPick: number }
export interface FantasyTeam { gm: string; pts: number; players: FantasyPlayer[] }
export interface DraftPick { pick: number; player: string; gm: string }
export interface FantasyDraft { year: number; teams: FantasyTeam[]; picks?: DraftPick[] }

export interface Tournament {
  id: string; year: number; location: string; dates: string; venue: string;
  attendance: number; formats: string[]; notes: string; fantasyDraft?: FantasyDraft;
}
export interface PlayerRow { id: string; name: string; handle?: string; region?: string; notes?: string }
export interface ResultRow { id?: string; playerName: string; placement: number; deck?: string; record?: string; notes?: string }
export interface MatchRow {
  id?: string; round?: number | string; table?: number;
  playerA: string; playerB: string; scoreA?: number | null; scoreB?: number | null;
  winner?: string; topCut?: boolean; notes?: string;
}
export interface SeedData {
  tournaments: Tournament[]; players: PlayerRow[];
  results: Record<string, ResultRow[]>;   // key = `${year}_${format}`
  matches: Record<string, MatchRow[]>;     // key = `${year}_${format}`
}
export interface Question { q: string; correct: string; options: string[] }
export interface LeaderboardEntry { name: string; score: number; created_at: string }
```

---

### Task 1: Dependencies, data extraction, types, format utilities

**Files:**
- Create: `lib/nationals/types.ts`
- Create: `lib/nationals/format.ts`
- Create: `lib/nationals/format.test.ts`
- Create: `public/data/nationals-history.json` (extracted, not hand-written)
- Create: `public/data/us-states-10m.json` (from `us-atlas`)
- Modify: `.gitignore` (ignore the source HTML reference copy)
- Modify: `package.json` (add `d3-geo`, `topojson-client`, `@types/d3-geo`)

**Interfaces:**
- Produces: all types above; `fmtClass(f: string): string`, `placeBadgeClass(p: number): string`, `stateAbbr(loc: string): string | null`, `STATE_FIPS: Record<string,string>`, `shuffle<T>(arr: T[]): T[]`, `parseKey(k: string): { year: number; format: string }`, `buildKey(year: number, format: string): string`, `ordinal(n: number): string`.

- [ ] **Step 1: Install deps and copy the source reference**

```bash
cd .claude/worktrees/nationals-history
npm install
cp "/Users/timestes/projects/redemption-tournament-tracker/nationals-history (36).html" ./nationals-history-source.html
printf '\nnationals-history-source.html\n' >> .gitignore
npm install d3-geo topojson-client
npm install -D @types/d3-geo
```

- [ ] **Step 2: Extract SEED_DATA → public/data/nationals-history.json**

The blob is `const SEED_DATA = {...};` on line 556. Extract the JSON object and validate it parses:

```bash
mkdir -p public/data
sed -n '556p' nationals-history-source.html \
  | sed -E 's/^[[:space:]]*const SEED_DATA[[:space:]]*=[[:space:]]*//; s/;[[:space:]]*$//' \
  > public/data/nationals-history.json
node -e "const d=require('./public/data/nationals-history.json'); console.log('tournaments',d.tournaments.length,'players',d.players.length,'resultKeys',Object.keys(d.results).length,'matchKeys',Object.keys(d.matches).length)"
```
Expected: prints non-zero counts for all four (e.g. `tournaments 20+ players 100+ ...`). If `MATCH_DATA_START_YEAR`/other consts share the line, adjust the `sed` to capture only the `{...}` object.

- [ ] **Step 3: Vendor the us-atlas states topojson**

```bash
npm install -D us-atlas
cp node_modules/us-atlas/states-10m.json public/data/us-states-10m.json
node -e "const t=require('./public/data/us-states-10m.json'); console.log('objects', Object.keys(t.objects))"
```
Expected: prints `objects [ 'states', ... ]`.

- [ ] **Step 4: Write `lib/nationals/types.ts`** — paste the full data model block above.

- [ ] **Step 5: Write the failing test `lib/nationals/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fmtClass, placeBadgeClass, stateAbbr, parseKey, buildKey, shuffle } from "./format";

describe("fmtClass", () => {
  it("maps known formats", () => {
    expect(fmtClass("T1 2-Player")).toBe("fmt-T1");
    expect(fmtClass("T2 2-Player")).toBe("fmt-T2");
    expect(fmtClass("Sealed")).toBe("fmt-Sealed");
    expect(fmtClass("Booster Draft")).toBe("fmt-Booster");
    expect(fmtClass("Teams")).toBe("fmt-Teams");
    expect(fmtClass("Type A")).toBe("fmt-TypeA");
    expect(fmtClass("")).toBe("fmt-default");
  });
});
describe("placeBadgeClass", () => {
  it("medals + fallback", () => {
    expect(placeBadgeClass(1)).toBe("place-1");
    expect(placeBadgeClass(4)).toBe("place-n");
  });
});
describe("stateAbbr", () => {
  it("extracts trailing 2-letter state", () => {
    expect(stateAbbr("Rogers, AR")).toBe("AR");
    expect(stateAbbr("Somewhere")).toBeNull();
  });
});
describe("key helpers", () => {
  it("round-trips", () => {
    expect(buildKey(2025, "Sealed")).toBe("2025_Sealed");
    expect(parseKey("2025_Sealed")).toEqual({ year: 2025, format: "Sealed" });
  });
});
describe("shuffle", () => {
  it("preserves members", () => {
    expect(shuffle([1, 2, 3]).sort()).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 6: Run test — verify it fails**

Run: `npx vitest run lib/nationals/format.test.ts`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 7: Write `lib/nationals/format.ts`** — port verbatim, swapping DOM for params:
  - `fmtClass` from SRC:633-642 (exact logic above).
  - `placeBadgeClass` from SRC:644.
  - `stateAbbr` from SRC:648-653.
  - `STATE_FIPS` from SRC:655.
  - `shuffle` from SRC:1251.
  - `parseKey` from `amParseKey` SRC:1638-1645 (splits `"<year>_<format>"`; note formats may contain underscores — split on the **first** underscore: `const i=k.indexOf('_'); return { year:+k.slice(0,i), format:k.slice(i+1) }`).
  - `buildKey(year, format)` = `` `${year}_${format}` ``.
  - `ordinal(n)` standard helper (1→"1st", 2→"2nd", 3→"3rd", else "nth").

- [ ] **Step 8: Run test — verify it passes**

Run: `npx vitest run lib/nationals/format.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/nationals/types.ts lib/nationals/format.ts lib/nationals/format.test.ts public/data .gitignore package.json package-lock.json
git commit -m "feat(nationals): data extraction, types, and format utils

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Route shell, nav link, HistoryClient island (data fetch + view/URL state)

**Files:**
- Modify: `components/top-nav.tsx` (add History link to `tournamentLinks` ~line 136)
- Create: `app/tournaments/history/page.tsx`
- Create: `app/tournaments/history/HistorySkeleton.tsx`
- Create: `app/tournaments/history/HistoryClient.tsx`
- Create: `app/tournaments/history/NavTabs.tsx`
- Create: `app/tournaments/history/seed-context.ts`

**Interfaces:**
- Produces: `useSeed(): SeedData` (context hook); `ViewId = 'tournaments'|'champions'|'players'|'trivia'|'stats'|'tape'|'search'|'detail'|'player'`; `useHistoryNav()` providing `{ view, tournamentId, playerName, setView(view, opts?), back() }`. View components consume these.

- [ ] **Step 1: Add the nav link.** In `components/top-nav.tsx`, add to `tournamentLinks` after the RNRS Points entry:
```ts
{ href: "/tournaments/history", label: "History", icon: FaBookOpen },
```
Ensure `FaBookOpen` is imported from `react-icons/fa` (it is already used in the file; if not, add it). No other nav changes — `isActive('/tournaments')` already highlights the group.

- [ ] **Step 2: Write `seed-context.ts`** — a React context `SeedContext` of type `SeedData | null` and a `useSeed()` hook that throws if used outside the provider (asserts non-null).

- [ ] **Step 3: Write `NavTabs.tsx`** (`"use client"`) — the 7 tabs (SRC:237-247 labels: Tournaments / Hall of Champions / Players / Trivia / Advanced Metrics / Tale of the Tape / Search). Map each to a `ViewId`. Active tab: `text-primary border-b-2 border-primary`; inactive: `text-muted-foreground hover:text-foreground border-b-2 border-transparent`. Container: `flex gap-1 overflow-x-auto border-b border-border` (reuse `.no-scrollbar` if present). `onClick={() => setView(id)}`.

- [ ] **Step 4: Write `HistorySkeleton.tsx`** — a simple `bg-muted animate-pulse` block layout (header bar + grid of card placeholders) matching `.app-main` width `max-w-[1200px] mx-auto px-5 py-6`.

- [ ] **Step 5: Write `HistoryClient.tsx`** (`"use client"`):
  - On mount, `fetch('/data/nationals-history.json')` → `res.json()` → `setSeed(...)`. While null, render `<HistorySkeleton/>`.
  - View state: `view`, `tournamentId`, `playerName`, plus a `backTo` ref. Initialize from `useSearchParams` (`?view`, `?t`, `?p`); on change, `router.replace` with updated query (no scroll). Provide `setView(view, {tournamentId, playerName, backTo})` and `back()`.
  - Wrap content in `<SeedContext.Provider value={seed}>`; render `<NavTabs .../>` then a `switch(view)` rendering the active view component. For this task, render placeholder `<div className="p-6 text-muted-foreground">{view} — coming soon</div>` for every view (replaced in later tasks).
  - Layout wrapper: `<div className="max-w-[1200px] mx-auto px-5 py-6">`.
  - Accept prop `initialLeaderboard?: LeaderboardEntry[]` (passed through to Trivia later; default `[]`).

- [ ] **Step 6: Write `page.tsx`** (server component):
```tsx
import { Suspense } from "react";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
import HistoryClient from "./HistoryClient";

export const metadata = {
  title: "Nationals History | Redemption CCG",
  description: "Complete history of Redemption Nationals tournaments: champions, players, stats, and trivia.",
};

export default function Page() {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1">
        <Suspense fallback={null}>
          <HistoryClient />
        </Suspense>
      </div>
      <SponsorFooter />
    </div>
  );
}
```
(`loadLeaderboard` SSR wiring is added in Task 15.)

- [ ] **Step 7: Verify**

Run: `npm run dev` then open `http://localhost:3000/tournaments/history` in the browser.
Expected: TopNav shows; "History" appears in the Tournaments dropdown (desktop + mobile) and links here; the 7 tabs render and switch the placeholder text; `?view=` updates in the URL and survives reload; no console errors; the page is laid out with footer at the bottom. Confirm in light, dark, and jayden themes.

- [ ] **Step 8: Commit**
```bash
git add components/top-nav.tsx app/tournaments/history
git commit -m "feat(nationals): route shell, nav link, client island with view/URL state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Shared UI primitives (theme-aware)

**Files:**
- Create: `app/tournaments/history/components/FormatBadge.tsx`
- Create: `app/tournaments/history/components/PlacementBadge.tsx`
- Create: `app/tournaments/history/components/SectionTitle.tsx`
- Create: `app/tournaments/history/components/EmptyState.tsx`

**Interfaces:**
- Produces: `<FormatBadge format={string} />`, `<PlacementBadge place={number} />` (and a `rank` variant), `<SectionTitle title={string} sub?={string} />`, `<EmptyState icon={string} title={string} />`.

- [ ] **Step 1: `FormatBadge.tsx`** — use `fmtClass` to pick a key, then a class map (pill: `inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide`):
```ts
const FORMAT_STYLES: Record<string,string> = {
  "fmt-T1":      "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  "fmt-T2":      "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30 [.jayden_&]:text-rose-200",
  "fmt-Sealed":  "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  "fmt-Booster": "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  "fmt-Teams":   "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  "fmt-TypeA":   "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  "fmt-default": "bg-muted text-muted-foreground border-border",
};
```
Render the original format string as the label.

- [ ] **Step 2: `PlacementBadge.tsx`** — medals via `placeBadgeClass`:
```ts
const PLACE_STYLES: Record<string,string> = {
  "place-1": "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
  "place-2": "bg-slate-400/20 text-slate-700 dark:text-slate-300 border-slate-400/40",
  "place-3": "bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/40",
  "place-n": "bg-muted text-muted-foreground border-border",
};
```
Pill style as above; label = `ordinal(place)`. Add an optional `variant="rank"` (used by the leaderboard) using the same color tiers keyed by index.

- [ ] **Step 3: `SectionTitle.tsx`** — `<div className="flex items-baseline gap-3 mb-4"><h2 className="font-serif text-2xl text-foreground">{title}</h2>{sub && <span className="text-sm text-muted-foreground">{sub}</span>}</div>`. (App uses Cinzel for display; use the project's display font class if one exists, else `font-serif`.)

- [ ] **Step 4: `EmptyState.tsx`** — centered `text-muted-foreground` block: big emoji `icon`, `h3` title. Padding `py-16 text-center`.

- [ ] **Step 5: Verify** — temporarily render all four in `TournamentsView` placeholder (or a scratch route) and visually confirm contrast in light/dark/jayden. Then remove the scratch usage.

- [ ] **Step 6: Commit**
```bash
git add app/tournaments/history/components
git commit -m "feat(nationals): theme-aware shared UI primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tournaments grid view (+ grid bug fix)

**Files:**
- Create: `app/tournaments/history/views/TournamentsView.tsx`
- Modify: `app/tournaments/history/HistoryClient.tsx` (render `TournamentsView` for `view==='tournaments'`)

**Interfaces:**
- Consumes: `useSeed()`, `useHistoryNav()`, `FormatBadge`, `SectionTitle`, `EmptyState`.

- [ ] **Step 1: Build `TournamentsView`** — port `renderTournamentGrid` (SRC:741-772): sort `seed.tournaments` by year **descending**; render a card per tournament. Card content (SRC:744-766): big serif `year`, `location`, a meta line (`venue` · `attendance` players · `dates`), and a wrapped row of `<FormatBadge>` per `formats[]`. `<SectionTitle title="Nationals History" sub={`${n} tournaments`} />`. Empty → `<EmptyState icon="🏛️" title="No tournaments yet" />`.
- Card classes: `group cursor-pointer rounded-lg border border-border bg-card p-5 transition hover:border-primary hover:shadow-lg hover:-translate-y-0.5`. Top accent bar via a `before:` or a 2px `bg-primary` strip. `onClick={() => setView('detail', { tournamentId: t.id, backTo: 'tournaments' })}`.

- [ ] **Step 2: Apply the grid-bug fix** — the grid container:
```tsx
<div className="grid gap-4 justify-start [grid-template-columns:repeat(auto-fill,minmax(240px,320px))]">
```
This caps each track at 320px and left-aligns, so 1–2 cards no longer balloon.

- [ ] **Step 3: Verify**

Run dev; open `/tournaments/history`.
Expected: the Tournaments tab shows all years (newest first) as fixed-width cards (240–320px), format badges colored per type. **Grid-bug check:** temporarily filter the array to 1 then 2 then 3 items (or note a year-filtered subset) and confirm cards stay ~240–320px wide, not stretched. Revert the temporary filter. Confirm light/dark/jayden.

- [ ] **Step 4: Commit**
```bash
git add app/tournaments/history/views/TournamentsView.tsx app/tournaments/history/HistoryClient.tsx
git commit -m "feat(nationals): tournaments grid view + grid-sizing fix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Tournament detail view (header, format tabs, results + rounds/matches)

**Files:**
- Create: `app/tournaments/history/views/TournamentDetailView.tsx`
- Modify: `app/tournaments/history/HistoryClient.tsx` (render for `view==='detail'`)

**Interfaces:**
- Consumes: `useSeed()`, `useHistoryNav()`, `FormatBadge`, `PlacementBadge`. Uses `buildKey`, `parseKey`. Player names link via `setView('player', { playerName, backTo:'detail' })`.

- [ ] **Step 1: Header + nav** — port `openTournament` (SRC:774-810): back button (`← Back` calling `back()`), header with year/venue/location/dates/attendance, prev/next-year buttons (find adjacent tournaments by sorted year; `setView('detail',{tournamentId})`). Leave placeholders (buttons) for "🎴 Promo Cards" (Task 7) and the fantasy-draft link, and a slot for `<StateMap>` (Task 6) — wire them in those tasks.

- [ ] **Step 2: Format filter tabs** — from `tournament.formats`; selected format in local state (default first). Tab styling like `NavTabs` (active `text-primary border-primary`).

- [ ] **Step 3: Results + rounds/matches** — port `renderDetailContent` (SRC:817-927): for the selected `key = buildKey(year, format)`:
  - Results table from `seed.results[key]` sorted by `placement`: columns Place (`<PlacementBadge>`), Player (link), Deck, Record, Notes.
  - Rounds/matches from `seed.matches[key]`: group by `round`; handle the Teams special-casing (SRC:866-908, `notes` `Teams:` grouping) and the top-cut bracket (SRC:837-861). Score display `scoreA–scoreB` or `—`. Winner cell emphasis: `text-primary font-medium`; loser `text-muted-foreground`.
  - Use `bg-card`/`border-border` tables; zebra rows `odd:bg-muted/40`.

- [ ] **Step 4: Verify** — open a tournament card → detail shows header, format tabs switch the results/matches, placement medals correct, player names navigate to (placeholder) player view and back returns to detail. Check a Teams-format year and a year with top-cut. Light/dark/jayden.

- [ ] **Step 5: Commit**
```bash
git add app/tournaments/history/views/TournamentDetailView.tsx app/tournaments/history/HistoryClient.tsx
git commit -m "feat(nationals): tournament detail view (results, rounds, matches)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: State map component (d3-geo + topojson, lazy, fail-soft)

**Files:**
- Create: `app/tournaments/history/components/StateMap.tsx`
- Create: `app/tournaments/history/components/StateMap.loader.tsx` (dynamic wrapper)
- Modify: `app/tournaments/history/views/TournamentDetailView.tsx` (mount the map)
- Create: `lib/nationals/cityCoords.ts` (the `CITY_COORDS` map, SRC:681-707)

**Interfaces:**
- Consumes: `stateAbbr`, `STATE_FIPS`. Produces: `<StateMap location={string} />` (renders the host state + a city pin, or nothing on failure).

- [ ] **Step 1: `cityCoords.ts`** — copy `CITY_COORDS` (SRC:681-707) as `Record<string,[number,number]>`.

- [ ] **Step 2: `StateMap.tsx`** (`"use client"`) — port `renderStateSvg` (SRC:708-740) using npm modules instead of CDN globals:
```ts
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
```
On mount: fetch `/data/us-states-10m.json` once (module-scope cached promise), `feature(topo, topo.objects.states).features`, find the feature by `STATE_FIPS[stateAbbr(location)]`, project with `geoMercator().fitSize([W,H], feature)` + `geoPath`, render an inline `<svg>` path; add a `<circle>` pin at the projected `CITY_COORDS[city]` if present. Stroke/fill use `currentColor`/`text-primary`/`text-muted-foreground` so it themes. **Fail-soft:** wrap in try/catch and an error/loading state that renders `null` (or a tiny placeholder) — never throw.

- [ ] **Step 3: `StateMap.loader.tsx`** — `const StateMap = dynamic(() => import('./StateMap'), { ssr: false, loading: () => null });` and re-export. TournamentDetailView imports the loader.

- [ ] **Step 4: Mount in detail** — place the map in the detail header area (small, e.g. `w-40 h-28`), passing `location={tournament.location}`.

- [ ] **Step 5: Verify** — detail view shows the correct highlighted state + city pin; switching tournaments updates it; throttle/network-fail the atlas and confirm the view still renders (map area empty, no crash). `next build` has no "document is not defined". Light/dark/jayden (map uses theme colors).

- [ ] **Step 6: Commit**
```bash
git add app/tournaments/history/components/StateMap.tsx app/tournaments/history/components/StateMap.loader.tsx lib/nationals/cityCoords.ts app/tournaments/history/views/TournamentDetailView.tsx
git commit -m "feat(nationals): lazy, fail-soft US state map in tournament detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Promo cards modal (local card data)

**Files:**
- Create: `lib/nationals/promos.ts` (the `PROMO_CARDS` map, SRC:2563+)
- Create: `app/tournaments/history/components/PromoCardsModal.tsx`
- Modify: `app/tournaments/history/views/TournamentDetailView.tsx` (wire the "🎴 Promo Cards" button)

**Interfaces:**
- Consumes: local card data via `@/lib/cards/lookup` (`findCard`/`CARDS`) and the image-URL helper at `app/shared/utils/cardImageUrl` (`getCardImageUrl`). Produces: `<PromoCardsModal year={number} open onClose />`, `promosForYear(year): {label,cardName,imgFile}[]`.

- [ ] **Step 1: `promos.ts`** — copy the `PROMO_CARDS` object (year → array of `{label, cardName, imgFile}`) from SRC:2563-2680 (read that range with `sed`). Export `promosForYear(year)`. Drop the `CARD_DATA_URL` GitHub-raw fetch entirely.

- [ ] **Step 2: `PromoCardsModal.tsx`** — port `openPromoModal` (SRC:2683+) as a React modal (use the app's existing dialog primitive if present, else a fixed overlay `bg-black/70` + `bg-card` panel). For each promo, resolve the image with the local helper (`getCardImageUrl(imgFile)` or by `findCard(cardName)`); show label + card image + name. Confirm the helper's expected input by reading `app/shared/utils/cardImageUrl`.

- [ ] **Step 3: Wire the button** in TournamentDetailView: show "🎴 Promo Cards" only when `promosForYear(year).length` and open the modal.

- [ ] **Step 4: Verify** — open a year with promos (e.g. 2016) → modal shows promo card images sourced locally (no network call to githubusercontent). Close works. Light/dark/jayden.

- [ ] **Step 5: Commit**
```bash
git add lib/nationals/promos.ts app/tournaments/history/components/PromoCardsModal.tsx app/tournaments/history/views/TournamentDetailView.tsx
git commit -m "feat(nationals): promo cards modal using local card data

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Derived selectors (champions, player index, head-to-head)

**Files:**
- Create: `lib/nationals/selectors.ts`
- Create: `lib/nationals/selectors.test.ts`

**Interfaces:**
- Produces:
  - `buildChampionData(seed): Champion[]` where `Champion = { name: string; wins: number; years: number[]; formats: string[] }` (port `buildChampionData` SRC:934-947).
  - `getAllFormats(seed): string[]` (SRC:928-933).
  - `playerProfile(seed, name): PlayerProfile` (port `openPlayerProfile` data math SRC:1011-1189: appearances, placements, per-format + per-opponent match stats, top-cut W/L, fantasy-draft history).
  - `headToHead(seed, a, b): { wins: number; losses: number; draws: number; matches: MatchRow[] }` (port `renderH2H` SRC:1190-1216).

- [ ] **Step 1: Write failing `selectors.test.ts`** — load the real dataset and assert invariants:
```ts
import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import { buildChampionData, getAllFormats, headToHead, playerProfile } from "./selectors";

const data = seed as any;
it("champions have >=1 win and sane shape", () => {
  const champs = buildChampionData(data);
  expect(champs.length).toBeGreaterThan(0);
  for (const c of champs) { expect(c.wins).toBeGreaterThanOrEqual(1); expect(c.wins).toBe(c.years.length); }
});
it("getAllFormats returns non-empty unique list", () => {
  const f = getAllFormats(data); expect(f.length).toBeGreaterThan(0);
  expect(new Set(f).size).toBe(f.length);
});
it("headToHead is symmetric in totals", () => {
  const champs = buildChampionData(data); const [a, b] = [champs[0].name, champs[1].name];
  const ab = headToHead(data, a, b), ba = headToHead(data, b, a);
  expect(ab.wins).toBe(ba.losses); expect(ab.losses).toBe(ba.wins);
});
it("playerProfile returns appearances for a champion", () => {
  const champs = buildChampionData(data);
  const p = playerProfile(data, champs[0].name);
  expect(p.appearances).toBeGreaterThanOrEqual(1);
});
```
(Adjust the `PlayerProfile` field name `appearances` to match what you implement; keep the test and impl in sync.)

- [ ] **Step 2: Run — verify fail.** `npx vitest run lib/nationals/selectors.test.ts` → FAIL.

- [ ] **Step 3: Implement `selectors.ts`** porting the cited ranges; replace all DOM/`innerHTML` with returned typed data; keep optional-chaining guards from the source.

- [ ] **Step 4: Run — verify pass.** Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/nationals/selectors.ts lib/nationals/selectors.test.ts
git commit -m "feat(nationals): champion/player/H2H selectors with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Hall of Champions view

**Files:**
- Create: `app/tournaments/history/views/ChampionsView.tsx`
- Modify: `app/tournaments/history/HistoryClient.tsx`

**Interfaces:** Consumes `buildChampionData`, `getAllFormats`, `useHistoryNav`, `FormatBadge`, `SectionTitle`, `EmptyState`.

- [ ] **Step 1: Build the view** — port `renderChampions` + `setChampFormat` + `setChampSort` (SRC:948-1010): format filter tabs (`All` + `getAllFormats`), sort tabs (Most Wins / Name A-Z / Most Recent / Oldest Win, SRC:41-44 + sort logic), and a champions grid. Each champion card: name, win count (gold/amber accent), years won, format badges. Click → `setView('player',{playerName:name, backTo:'champions'})`. Use the **same bounded grid** as Task 4: `[grid-template-columns:repeat(auto-fill,minmax(210px,300px))] justify-start`.

- [ ] **Step 2: Verify** — Champions tab: filter by format + all 4 sorts reorder correctly; clicking a champion opens their profile (Task 10) and back returns. Light/dark/jayden; gold accent legible (esp. jayden).

- [ ] **Step 3: Commit**
```bash
git add app/tournaments/history/views/ChampionsView.tsx app/tournaments/history/HistoryClient.tsx
git commit -m "feat(nationals): hall of champions view

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Players list + Player profile views

**Files:**
- Create: `app/tournaments/history/views/PlayersView.tsx`
- Create: `app/tournaments/history/views/PlayerProfileView.tsx`
- Modify: `app/tournaments/history/HistoryClient.tsx`

**Interfaces:** Consumes `useSeed`, `playerProfile`, `useHistoryNav`, `PlacementBadge`, `FormatBadge`, `SectionTitle`.

- [ ] **Step 1: PlayersView** — port `renderPlayerList` (SRC:1217-1232): a search input (`text-foreground bg-card border-border`, **no focus ring** per project preference — do not add `focus:ring-*`) filtering `seed.players` by name (case-insensitive); list rows → `setView('player',{playerName, backTo:'players'})`. `<SectionTitle title="Players" sub={`${count} players`} />`.

- [ ] **Step 2: PlayerProfileView** — render `playerProfile(seed, playerName)` (the profile card from SRC:1068-1189): header (name, handle, region), appearances/placements summary, per-format match record table, per-opponent record, top-cut W/L, fantasy-draft history. Back button calls `back()`. Player/opponent names that exist as profiles can link to themselves.

- [ ] **Step 3: Verify** — Players tab search filters; clicking a player shows a populated profile; back returns to the originating view (players vs champions vs detail). Light/dark/jayden.

- [ ] **Step 4: Commit**
```bash
git add app/tournaments/history/views/PlayersView.tsx app/tournaments/history/views/PlayerProfileView.tsx app/tournaments/history/HistoryClient.tsx
git commit -m "feat(nationals): players list and player profile views

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Advanced Metrics engine (`metrics.ts`)

**Files:**
- Create: `lib/nationals/metrics.ts`
- Create: `lib/nationals/metrics.test.ts`

**Interfaces:**
- Produces:
  - `AM_MODES: { id: string; label: string }[]` (SRC:1609-1622).
  - `AM_COLS: Record<string, Col[]>` where `Col = { id: string; label: string; dflt?: boolean; dfltAsc?: boolean; ... }` (SRC:1956-2059).
  - `MetricFilters` interface: `{ mode: string; formats: Set<string>; yearFrom: number; yearTo: number; customYears: Set<number>|null; minApp: number; maxApp: number; minNats: number; maxNats: number; comparePlayer: string|null; rivalryMode: 'wins'|'losses'; vspTarget: string|null }`.
  - `computeMetric(seed, filters): { columns: Col[]; rows: Record<string, any>[] }` — dispatches to one builder per mode and returns sorted-ready rows.
  - Helpers ported pure: `amBuildAttendance` (1715-1726), `amActiveYears`/`amValidYearsForFmt` (1670-1695), `amGetAllFmts` (1696-1714).

- [ ] **Step 1: Write failing `metrics.test.ts`** — load the dataset; for a default filter set per mode, assert shape:
```ts
import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import { AM_MODES, computeMetric } from "./metrics";

const data = seed as any;
const baseFilters = { formats: new Set(["All"]), yearFrom: 2003, yearTo: 2025, customYears: null,
  minApp: 1, maxApp: Infinity, minNats: 1, maxNats: Infinity, comparePlayer: null, rivalryMode: "wins", vspTarget: null } as any;

it("every mode returns columns and array rows without throwing", () => {
  for (const m of AM_MODES) {
    const out = computeMetric(data, { ...baseFilters, mode: m.id, vspTarget: m.id === "vsp" ? null : null });
    expect(Array.isArray(out.rows)).toBe(true);
    expect(out.columns.length).toBeGreaterThan(0);
  }
});
it("winpct rows have a name and numeric win pct", () => {
  const out = computeMetric(data, { ...baseFilters, mode: "winpct" });
  expect(out.rows.every(r => typeof r.name === "string")).toBe(true);
});
```

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement `metrics.ts`** — port each builder pure (no DOM, no `document.getElementById` for filter values — read from `filters` instead):
  - winpct 1739-1772, multiwl 1773-1811, placement 1812-1843, podiums 1844-1880, lsd 1881-1916, topcut 1917-1945, pts 2060-2091, rivalry 2096-2138, unique 2139-2164, vsp 2165-2195.
  - `amBuildData` dispatch 2196-2209; `round1` 2092.
  - Replace `amMinAppVal()`/`amMaxAppVal()`/`amMinNatsVal()`/`amMaxNatsVal()` (1734-1737) with the corresponding `filters.*` values.
  - Sorting (`amSortData` 2210-2231) can stay in the view or be exposed as `sortRows(rows, cols, col, asc)`.

- [ ] **Step 4: Run — verify pass.**

- [ ] **Step 5: Commit**
```bash
git add lib/nationals/metrics.ts lib/nationals/metrics.test.ts
git commit -m "feat(nationals): advanced-metrics engine (10 modes) with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Advanced Metrics view (filters + table)

**Files:**
- Create: `app/tournaments/history/views/MetricsView.tsx`
- Modify: `app/tournaments/history/HistoryClient.tsx`

**Interfaces:** Consumes `AM_MODES`, `AM_COLS`, `computeMetric`, `MetricFilters`, `useSeed`. Player typeaheads filter `seed.players`.

- [ ] **Step 1: Filter state** — `useReducer` over `MetricFilters`. UI ported from SRC:357-430 + the `am*` change handlers (2296-2482): mode tabs (`amModeTabs`), format select/modal, year range selects + custom-year picker + reset, min/max appearances, min/max Nats, compare-player typeahead (`amCompareSearch`), and mode-specific controls — rivalry wins/losses toggle (shown for `rivalry`), vsp target typeahead (shown for `vsp`). Inputs: `bg-card border-border text-foreground`, **no focus rings**.

- [ ] **Step 2: Table** — `useMemo(() => computeMetric(seed, filters), [seed, filters])`; render `columns` as sortable headers (click toggles `sortCol`/`sortAsc`, arrow ▲/▼ per SRC:2247-2258) and `rows`. Compare-player row pinned/highlighted (`bg-primary/10`) per SRC:2236-2239, 2272. Result count + subtitle (SRC:2278-2295). Empty → `<EmptyState>`.

- [ ] **Step 3: Verify** — Advanced Metrics tab: switch all 10 modes; apply each filter (format, year range, custom years, min/max app, min/max nats); compare a player (row highlights); rivalry toggle + vsp target work; column sort toggles. Numbers match the original for a spot-checked mode/year. Light/dark/jayden; horizontal scroll on mobile.

- [ ] **Step 4: Commit**
```bash
git add app/tournaments/history/views/MetricsView.tsx app/tournaments/history/HistoryClient.tsx
git commit -m "feat(nationals): advanced metrics view (filters, sortable table)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Search + Tale of the Tape views

**Files:**
- Create: `lib/nationals/search.ts`
- Create: `lib/nationals/search.test.ts`
- Create: `app/tournaments/history/views/SearchView.tsx`
- Create: `app/tournaments/history/views/TaleOfTheTapeView.tsx`
- Modify: `app/tournaments/history/HistoryClient.tsx`

**Interfaces:** Produces `globalSearch(seed, q): { players: PlayerRow[]; tournaments: Tournament[] }` (port `globalSearch` SRC:1233-1250) and reuses `headToHead` from selectors. TaleOfTheTape uses `renderTape`/`renderTapeOutput` (SRC:2896-2990).

- [ ] **Step 1: Failing `search.test.ts`** — assert `globalSearch(data, "")` returns empty-ish and a known champion's surname returns that player.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement `search.ts`.**
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: SearchView** — debounced input → grouped results (players → profile, tournaments → detail).
- [ ] **Step 6: TaleOfTheTapeView** — two player typeaheads; on both set, render `headToHead` output + per-player career summary (port `renderTapeOutput` SRC:2901-2990 layout). Win/loss colors emerald/red.
- [ ] **Step 7: Verify** — Search returns and navigates; Tale of the Tape compares two players with correct H2H. Light/dark/jayden.
- [ ] **Step 8: Commit**
```bash
git add lib/nationals/search.ts lib/nationals/search.test.ts app/tournaments/history/views/SearchView.tsx app/tournaments/history/views/TaleOfTheTapeView.tsx app/tournaments/history/HistoryClient.tsx
git commit -m "feat(nationals): global search and tale-of-the-tape views

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Trivia question generation (`trivia.ts`)

**Files:**
- Create: `lib/nationals/trivia.ts`
- Create: `lib/nationals/trivia.test.ts`

**Interfaces:** Produces `buildTriviaQuestions(seed): Question[]` (port SRC:1253-1514 verbatim, replacing `db`/`allResults` with `seed`; keep the inner `winners`/`allWinners` helpers and all `>=3/>=4` option-count guards; use the `shuffle` from `format.ts`).

- [ ] **Step 1: Failing `trivia.test.ts`**:
```ts
import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import { buildTriviaQuestions } from "./trivia";

const data = seed as any;
it("generates a healthy pool of well-formed questions", () => {
  const qs = buildTriviaQuestions(data);
  expect(qs.length).toBeGreaterThanOrEqual(10);
  for (const q of qs) {
    expect(typeof q.q).toBe("string");
    expect(q.options).toContain(q.correct);
    expect(new Set(q.options).size).toBe(q.options.length); // no dup options
    expect(q.options.length).toBeGreaterThanOrEqual(2);
  }
});
```
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement `trivia.ts`** (port the full range; read SRC:1253-1514 with `sed`).
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit**
```bash
git add lib/nationals/trivia.ts lib/nationals/trivia.test.ts
git commit -m "feat(nationals): trivia question generation with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Trivia backend (migration + actions) and Trivia view

**Files:**
- Create: `supabase/migrations/056_nationals_trivia_leaderboard.sql`
- Create: `app/tournaments/history/actions.ts`
- Create: `app/tournaments/history/views/TriviaView.tsx`
- Modify: `app/tournaments/history/page.tsx` (SSR `loadLeaderboard` → `initialLeaderboard`)
- Modify: `app/tournaments/history/HistoryClient.tsx` (thread `initialLeaderboard` to TriviaView)

**Interfaces:** Produces `submitTriviaScore({name,score}): Promise<{ok:true;leaderboard:LeaderboardEntry[]}|{ok:false;error:string}>` and `loadLeaderboard(limit?=20): Promise<LeaderboardEntry[]>`.

- [ ] **Step 1: Migration** (verify `056` is free; else next number):
```sql
CREATE TABLE public.nationals_trivia_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 12),
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 150),
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
Apply via Supabase MCP `apply_migration` (or the project's migration runner). Then run `get_advisors` (security) and confirm no new warnings on this table.

- [ ] **Step 2: `actions.ts`** (`"use server"`):
```ts
"use server";
import { createClient } from "@/utils/supabase/server";
import type { LeaderboardEntry } from "@/lib/nationals/types";

export async function loadLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nationals_trivia_scores")
    .select("name, score, created_at")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data as LeaderboardEntry[]) ?? [];
}

export async function submitTriviaScore(input: { name: string; score: number }) {
  const name = (input.name ?? "").trim().slice(0, 12);
  const score = Math.max(0, Math.min(150, Math.floor(input.score ?? 0)));
  if (!name) return { ok: false as const, error: "Enter a name first" };
  const supabase = await createClient();
  const { error } = await supabase.from("nationals_trivia_scores").insert({ name, score });
  if (error) return { ok: false as const, error: "Could not submit score" };
  const leaderboard = await loadLeaderboard(20);
  return { ok: true as const, leaderboard };
}
```

- [ ] **Step 3: SSR wiring** — `page.tsx` becomes `async`, calls `const initialLeaderboard = await loadLeaderboard();` and passes it to `<HistoryClient initialLeaderboard={initialLeaderboard} />`; `HistoryClient` forwards it to `TriviaView`.

- [ ] **Step 4: `TriviaView.tsx`** — port the quiz state machine (SRC:1515-1565) with `useReducer` (`{questions, index, score, streak, answered}`): Start → `buildTriviaQuestions(seed).slice(0,10)` (run on click, not mount) → per-question options (correct → emerald, wrong → red, SRC:1541-1554) → streak bonus (+5 at streak≥2) → end screen with final score. Name-entry modal (port `submitScore`/`saveScore` SRC:1567-1583) calls `submitTriviaScore`; on `ok`, replace local leaderboard state with the returned list and toast "Score submitted! 🏆". Leaderboard table (port `renderLeaderboard` SRC:1587-1600): rank badge (`PlacementBadge variant="rank"`), name, score (serif `text-primary`), date `new Date(created_at).toLocaleDateString()`. Initialize the table from `initialLeaderboard`.

- [ ] **Step 5: Verify (E2E, anon)** — in a logged-out browser: play a full quiz → submit a score → it appears on the board, persists across reload, and is visible to a second anonymous browser. In the DB, confirm the row exists. Attempt via devtools/supabase-js anon client: an UPDATE/DELETE is denied; an INSERT with `score=999999` or a 30-char name is rejected by the CHECK constraints; the action clamps a 999999 score to 150. Light/dark/jayden.

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/056_nationals_trivia_leaderboard.sql app/tournaments/history/actions.ts app/tournaments/history/views/TriviaView.tsx app/tournaments/history/page.tsx app/tournaments/history/HistoryClient.tsx
git commit -m "feat(nationals): trivia leaderboard (migration, actions, view)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Cross-theme QA, build, and final verification

**Files:** (fixes only, as needed)

- [ ] **Step 1: Type + unit checks** — `npx tsc --noEmit` clean; `npx vitest run` all green.
- [ ] **Step 2: Build** — `npm run build`. Confirm: route `/tournaments/history` builds; First Load JS is comparable to other routes; the 3.1 MB blob does **not** appear in any JS chunk (only as `/public/data/nationals-history.json`); `d3-geo`/`topojson` are in the async StateMap chunk; no "document is not defined"; no missing-Suspense warnings.
- [ ] **Step 3: Theme + responsive QA** — walk all 7 views + both drill-downs in **light, dark, jayden**, desktop + mobile width. Verify token usage (no hardcoded teal/gold leaking), format-badge/medal/win-loss/leaderboard contrast in each theme, nav-tab horizontal scroll on mobile, and the **grid bug** is gone (Tournaments + Champions with 1/2/3/8 cards stay bounded). Fix any stragglers.
- [ ] **Step 4: Grep guard** — confirm no `RollTide1`, no `raw.githubusercontent`, no `localStorage` leaderboard, no CDN `<script>` injection remain in the new code:
```bash
grep -rIn "RollTide1\|raw.githubusercontent\|cdn.jsdelivr" app/tournaments/history lib/nationals && echo "FOUND — remove" || echo "clean"
```
- [ ] **Step 5: Commit any fixes**
```bash
git add -A
git commit -m "chore(nationals): cross-theme QA, build fixes, final verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** All 7 views (T4/5, T9, T10, T12, T13, T15), detail drill-down (T5), player drill-down (T10), map kept (T6), promo local (T7), theming re-skin (T3 + T16), data delivery via `/public` client-fetch (T1/T2), `lib/nationals` + route-component split (all tasks), trivia migration/actions/RLS (T15), grid bug fix (T4 + verified T16), nav link (T2), drop worker/secret (Global Constraints + T16 grep). ✓
- **Placeholder scan:** Logic bodies reference exact `SRC:<line>` ranges (the source is the detailed reference) plus full signatures, test code, and token maps — no "TBD"/"handle edge cases"/"similar to". ✓
- **Type consistency:** Types defined once in T1 (`SeedData`, `Question`, `LeaderboardEntry`, etc.); `computeMetric`/`MetricFilters` (T11) consumed by T12; `buildChampionData`/`playerProfile`/`headToHead` (T8) consumed by T9/T10/T13; action signatures (T15) match `LeaderboardEntry`. ✓
- **Open risk:** Migration number `056` (verify free at T15). Component behavior verified manually (repo has no component-test infra; pure logic is Vitest-tested) — intentional.
