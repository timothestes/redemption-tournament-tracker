# Multi-Tournament Projector Board — Design

**Date:** 2026-05-29
**Status:** Approved (design, revised after 3-reviewer pass)

## Problem

A host running several tournaments at once has no single place to see all their round timers. To check time remaining on each event they navigate between tournament tabs. At a venue they want to project one screen that shows every active tournament's clock so all players in the room can glance up and see how much time is left in their round.

## Goal

A full-screen, display-only board that shows the live countdown for every tournament the host currently has running, suitable for projecting on a wall. Set-and-forget: it reflects round starts/ends made elsewhere without manual refresh, and keeps the display awake.

## Scope decisions

- **Display device:** the host's own logged-in device drives the projector. No new auth — we reuse existing Supabase RLS, which already scopes a host to their own tournaments.
- **Tournament set:** auto-include all active tournaments (`has_started = true AND has_ended = false`), with a presentational quick hide/show toggle.
- **Per-panel content:** tournament name, round progress ("Round 3 of 5"), and the big countdown. No player/table counts. No secondary identifier line in v1 (name only).
- **Freshness:** Supabase Realtime for row-change events; countdown ticks stay client-side.
- **Silent:** the board never plays audio (see Sound below).

### Out of scope (v1)

- No shareable public link / separate-device access. (Host's logged-in device only.)
- No host controls (start/end round) on the board — display only.
- No player or table counts, and no secondary identifier line (e.g. table ranges) under the name.
- **No audio** of any kind on the board.

## Route & entry point

- New full-screen route at the **app root**: **`/board`** (a top-level `app/board/page.tsx`), **not** under `app/tracker/`.
  - Reason: `app/tracker/layout.tsx` unconditionally renders `<TopNav />`, `<HeaderServer />`, and `<SponsorFooter />`, and in the App Router a child route cannot opt out of an ancestor layout. To get a true full-screen board with no site chrome, the route must live outside the `tracker` subtree — mirroring how `/play` (the multiplayer mode) achieves full-screen today by living at the app root with no nav imports.
- A **"Projector view"** button in the header of the existing `/tracker/tournaments` list page opens `/board` with `target="_blank"`, so the host can move that tab to the projector and keep managing rounds in the original tab.
- The route renders a minimal layout — no site nav/header/footer — so the entire viewport is the board. (`components/ui/background.tsx` already skips its hero image for full-screen prefixes; add `/board` to that skip list.)
- Data access relies on existing RLS: query `tournaments` where `has_started = true AND has_ended = false`; RLS returns only the logged-in host's rows. (Confirmed against live DB: `tournaments` policy `host_can_access_tournaments` = `auth.uid() = host_id`; `rounds` policy `host_can_access_rounds` joins to the owning tournament's `host_id`.)

## Layout

A responsive CSS grid that keeps the timer the dominant element at any tournament count:

| Active tournaments | Grid |
|---|---|
| 1 | single full-screen panel, maximal timer |
| 2 | side-by-side halves |
| 3–4 | 2×2 |
| 5+ | `grid-template-columns: repeat(auto-fit, minmax(...))` fallback; timer scales with viewport units |

- No bespoke per-count rules past 4 — one `auto-fit` rule covers 5, 6, 8+. A single host rarely runs 5+ simultaneous events; we don't design dedicated layouts for it.
- Timer numerals scale with viewport units so they stay the largest element on each panel as the grid subdivides.
- **Panel order is stable** (sort by tournament `created_at` ascending) so realtime-driven re-renders never make panels jump around on the wall.
- **Dark-optimized via hardcoded colors, NOT theme tokens.** The app uses `next-themes` with a `class` attribute, so semantic tokens (`bg-background`, `text-foreground`, `text-destructive`) follow the host's active theme — a light-mode host would otherwise get a light board. The board uses explicit dark colors (e.g. `bg-neutral-950`, light neutral text) independent of the active theme. The reused countdown logic supplies **math only**; the board provides its own color mapping rather than reusing `CountdownTimer`'s theme-token classes.
- Typography: Cinzel for the tournament name header; mono tabular numerals for the clock.

## Panel content & states

Each panel stacks three things, top to bottom:

1. **Tournament name** (header)
2. **Round progress** — "Round {current_round} of {n_rounds}"
3. **Countdown timer** — giant.

State is derived from the **current round** (the `rounds` row where `round_number = tournaments.current_round`) — matching exactly how the per-tournament page derives its active round, so the two surfaces can never disagree:

| State | Condition | Display |
|---|---|---|
| Round running | current round has `started_at`, not completed, time remaining > 0 | live countdown |
| Round not started | current round exists but `started_at` is null | quiet "Round {n} — starting soon" placeholder (no clock) |
| Between rounds | current round `is_completed = true`, next not yet started | "Round {n} complete — pairings coming" |
| **Time expired** | running round reached 0 | **loud, room-legible: the whole panel goes a bold red wash with large "TIME" text.** The point of a wall display is that players notice time is up — restraint (a phone principle) is deliberately not applied here. |

### Empty state (zero active tournaments)

When the host has no active tournaments (e.g. projecting before the day starts, or after the last event ends), the board shows a calm centered idle message — "No active tournaments" — on the same dark background, not a blank screen. A new tournament starting appears automatically (see Realtime).

## Sound

The board is **silent**. `CountdownTimer`'s expiry audio alert (`/notification-alert.mp3`) is a per-tournament-page concern; on a board with multiple panels it would produce overlapping alerts, and browser autoplay policy would block it on a passively-projected tab anyway. The extracted `useRoundCountdown` hook is **pure** (math/display only, no audio side effect); the sound logic stays inside `CountdownTimer`. `BoardPanel` never plays audio regardless of each tournament's `sound_notifications` setting.

## Screen wake lock

The board requests a **Screen Wake Lock** (`navigator.wakeLock.request('screen')`) on mount so the projector display doesn't hit OS sleep mid-event, and re-acquires it on `visibilitychange` (browsers release the lock when a tab is hidden). Gracefully no-ops where the API is unsupported. This protects the "project it and walk away" promise.

## Quick hide/show toggle

- Board auto-includes all active tournaments. An unobtrusive control (corner button revealing a checkbox list) lets the host hide a tournament from the board.
- Hidden set persists in `localStorage` under a single key (`board:hidden-tournament-ids`). localStorage is already per-device and per-origin, and the board is explicitly the host's own device, so no per-host keying is needed.
- Purely presentational — never writes to the DB, never affects the tournament itself.

## Realtime freshness

This board is the **repo's first Supabase Realtime consumer** (confirmed: no `.channel`/`postgres_changes` usage anywhere; the `/play` subscriptions are SpacetimeDB, unrelated). The realtime work is therefore real, net-new infrastructure, and includes:

- **Required migration:** enable the publication for the two tables —
  `ALTER PUBLICATION supabase_realtime ADD TABLE rounds, tournaments;`
  (The `supabase_realtime` publication currently contains zero tables; without this, `.subscribe()` silently delivers nothing.) Set `REPLICA IDENTITY FULL` on these tables if event filtering on old-row values proves necessary.
- **Auth + filtering:** ensure the browser client forwards the session JWT to the realtime socket so RLS scopes delivery to the host's rows. As defense-in-depth, the client **re-filters** every incoming event against the tournament IDs from the RLS-scoped initial fetch — a row that doesn't belong to a known panel is ignored regardless of realtime's filtering behavior.
- **Event handling — refetch, don't patch:** on mount, fetch active tournaments plus each one's current round. Subscribe to changes on `rounds` and `tournaments`. On **any** relevant event (round started/ended, new round paired, tournament started/ended), **refetch the active set + their current rounds** rather than incrementally patching individual panels. At the realistic 1–4 tournament scale this is simpler and less bug-prone than per-row patching, and avoids ordering hazards (a new tournament's round insert arriving before its `tournaments` update).
  - A tournament transitioning to `has_ended = true` drops off on the next refetch; a newly started tournament appears.
- **Countdown ticks stay pure client-side math** off `started_at` + `round_length`. Realtime carries only row changes, never per-second ticks.

### Data fetch shape

Per tournament, fetch: `id`, `name`, `current_round`, `n_rounds`, `round_length`, `has_started`, `has_ended`, `created_at`. For each, fetch the current round (`round_number = current_round`) with `started_at`, `is_completed`, `round_number`. This is N+1 (one round query per tournament) — acceptable at 1–4 tournaments; may be batched with an `in (...)` filter if desired. All field names confirmed against the live DB (note: `prompt_context/context.md` is stale and omits `round_length`).

## Components & reuse

Reuse the existing countdown math so the board can never disagree with the per-tournament page's timer.

- **Refactor:** extract the countdown calculation from `components/ui/CountdownTimer.tsx` into a shared **pure** hook, `useRoundCountdown(startTime, durationMinutes)`, returning `{ timeString, remainingSeconds, isExpired, isWarning, isUrgent }` — **no audio, no theme classes**. Reimplement the existing `CountdownTimer` on top of the hook with its current hardcoded sizing, theme-token colors, and sound behavior unchanged (no visual or behavioral change to the per-tournament page — it's the hook's only other consumer, confirmed via grep: a single usage at `app/tracker/tournaments/[id]/page.tsx:755`). The extraction is necessary because `CountdownTimer`'s display sizes are hardcoded (`text-xl`/`text-2xl`) and cannot scale to projector size.
- **New components:**
  - `app/board/page.tsx` — full-screen route + minimal layout, initial data fetch.
  - `ProjectorBoard` (client) — responsive grid, realtime subscription, hide/show toggle, localStorage, wake lock, empty state.
  - `BoardPanel` — one tournament: name, round progress, and a board-sized timer built on `useRoundCountdown` with board-local (hardcoded-dark) colors and the loud expired treatment.

## Data flow summary

```
/tracker/tournaments  ──"Projector view"──▶  /board (new tab, app root, no site chrome)
                                                   │
                                          initial fetch (RLS-scoped):
                                          active tournaments + current round each
                                                   │
                                          ProjectorBoard: grid of BoardPanel,
                                          wake lock, empty state, hide/show
                                                   │
                                          Supabase Realtime sub (rounds, tournaments)
                                          ── any relevant event ──▶ refetch active set
                                          (client re-filters to known tournament IDs)
                                                   │
                                          each BoardPanel: useRoundCountdown ticks
                                          locally every 1s off started_at + round_length
```

## Testing

- **`useRoundCountdown` hook:** unit-test the math — time remaining for a given `started_at`/duration, expired at/after end, warning/urgent thresholds, null `startTime` returns full duration.
- **`CountdownTimer` behavior-preserving:** assert the existing component still renders the same `timeString` and classes after the hook extraction (cheap insurance for the only edit to shared, in-production code).
- **Panel state derivation:** unit-test mapping of current-round fields → panel state (running / not-started / between-rounds / expired).
- **Board behavior (manual):** multiple active tournaments — grid scales 1→4 then auto-fit; starting a round on one tournament (from another tab) updates the board via Realtime; ending a tournament removes its panel; empty state shows with zero active; hide/show toggle persists across refresh; wake lock keeps the display awake.

## Risks / open questions

- **Realtime RLS on payloads:** classic `postgres_changes` row filtering by RLS must be verified during implementation (JWT forwarded to socket), with client-side re-filtering as the guaranteed backstop. Do not assume it "just works."
- **Many tournaments** (5+) make timers small; acceptable for v1 since a single host rarely runs that many simultaneously. No pagination in v1.
- **Clock skew:** countdown uses the display device's local clock against the server `started_at`. A badly-wrong device clock skews the displayed time — and here it's projected as authoritative to a whole room, a larger blast radius than the existing per-phone timer. Same underlying behavior as today; not code-mitigated in v1, but the host should verify the projector machine's clock. A one-time server-time offset at mount is a possible future hardening.
- **Realtime drop:** if the subscription silently drops (venue network blip), round-state changes stop arriving while the client-side countdown keeps ticking — an ended round could keep counting visibly with no one noticing. v1 accepts this; a future host-visible "live" heartbeat dot would protect the set-and-forget promise.
