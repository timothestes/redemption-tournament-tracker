# Multi-Tournament Projector Board — Design

**Date:** 2026-05-29
**Status:** Approved (design)

## Problem

A host running several tournaments at once has no single place to see all their round timers. To check time remaining on each event they navigate between tournament tabs. At a venue they want to project one screen that shows every active tournament's clock so all players in the room can glance up and see how much time is left in their round.

## Goal

A full-screen, display-only board that shows the live countdown for every tournament the host currently has running, suitable for projecting on a wall. Set-and-forget: it reflects round starts/ends made elsewhere without manual refresh.

## Scope decisions

- **Display device:** the host's own logged-in device drives the projector. No new auth — we reuse existing Supabase RLS, which already scopes a host to their own tournaments.
- **Tournament set:** auto-include all active tournaments (`has_started = true AND has_ended = false`), with a presentational quick hide/show toggle.
- **Per-panel content:** tournament name, round progress ("Round 3 of 5"), and the big countdown. No player/table counts.
- **Freshness:** Supabase Realtime for row-change events; countdown ticks stay client-side.

### Out of scope (v1)

- No shareable public link / separate-device access. (Host's logged-in device only.)
- No host controls (start/end round) on the board — display only.
- No player or table counts.
- No flashing/alarm cues on expiry beyond the existing timer's expired state.

## Route & entry point

- New full-screen route: **`/tracker/tournaments/board`**.
- A **"Projector view"** button in the header of the existing `/tracker/tournaments` list page opens it with `target="_blank"`, so the host can move that tab to the projector and keep managing rounds in the original tab.
- The route renders a minimal layout — no site nav/header/footer — so the entire viewport is the board.
- Data access relies on existing RLS: query `tournaments` where `has_started = true AND has_ended = false`; RLS returns only the logged-in host's rows.

## Layout

A responsive CSS grid that keeps the timer the dominant element at any tournament count:

| Active tournaments | Grid |
|---|---|
| 1 | single full-screen panel, maximal timer |
| 2 | side-by-side halves |
| 3–4 | 2×2 |
| 5–6 | 2×3 / 3×2 |
| 7+ | grid keeps subdividing |

- Timer numerals scale with viewport units so they stay the largest element on each panel as the grid subdivides.
- **Dark-optimized:** the board forces a dark, high-contrast palette (light text on near-black) regardless of system/site theme — best for projection and across-the-room legibility. This is a board-local style choice, not a change to the app's theme system.
- Typography: Cinzel for the tournament name header; mono tabular numerals for the clock (consistent with the existing `CountdownTimer`).

## Panel content & states

Each panel stacks three things, top to bottom:

1. **Tournament name** (header)
2. **Round progress** — "Round {current_round} of {n_rounds}"
3. **Countdown timer** — giant.

State is derived from the latest round's `started_at` / `is_completed`:

| State | Condition | Display |
|---|---|---|
| Round running | latest round has `started_at`, not completed, time remaining > 0 | live countdown |
| Round not started | latest round paired but `started_at` is null | quiet "Round {n} — starting soon" placeholder (no clock) |
| Between rounds | latest round `is_completed = true`, next not yet started | "Round {n} complete" |
| Time expired | running round reached 0 | existing timer expired state ("0:00", destructive color) — restrained, no flashing |

## Quick hide/show toggle

- Board auto-includes all active tournaments. An unobtrusive control (corner button revealing a checkbox list) lets the host hide a tournament from the board.
- Hidden set persists in `localStorage` keyed to the host, so it survives refresh on that display device.
- Purely presentational — never writes to the DB, never affects the tournament itself.

## Realtime freshness

- **On mount:** fetch active tournaments plus each one's latest round. Fields needed per tournament: `id`, `name`, `current_round`, `n_rounds`, `round_length`, `has_started`, `has_ended`; per latest round: `started_at`, `is_completed`, `round_number`.
- **Subscribe** via Supabase Realtime to changes on `rounds` and `tournaments`. On any relevant insert/update (round started, round ended, new round paired, tournament started/ended), re-derive the affected panel.
  - A tournament transitioning to `has_ended = true` drops off the board automatically.
  - A newly started tournament appears automatically.
- **Countdown ticks stay pure client-side math** off `started_at` + `round_length`. Realtime carries only row changes, never per-second ticks — tiny payload.

### Realtime subscription note

The existing per-tournament page does **not** use realtime for the timer; this board is the first consumer of realtime on `rounds`/`tournaments`. Implementation must confirm Realtime is enabled (publication) for these tables and add it via migration if not. RLS still governs which rows the subscription delivers.

## Components & reuse

Reuse the existing countdown math so the board can never disagree with the per-tournament page's timer.

- **Refactor:** extract the countdown calculation from `components/ui/CountdownTimer.tsx` into a shared hook, e.g. `useRoundCountdown(startTime, durationMinutes)`, returning `{ timeString, remainingSeconds, isExpired, isWarning, isUrgent }`. The existing `CountdownTimer` is reimplemented on top of the hook with its current hardcoded sizing unchanged (no visual change to existing pages). This is necessary because `CountdownTimer`'s display sizes are hardcoded (`text-xl`/`text-2xl`) and cannot scale to projector size.
- **New components:**
  - `app/tracker/tournaments/board/page.tsx` — route + minimal full-screen layout, initial data fetch.
  - `ProjectorBoard` (client) — responsive grid, Realtime subscription, hide/show toggle, localStorage.
  - `BoardPanel` — one tournament: name, round progress, and a board-sized timer built on `useRoundCountdown`.

## Data flow summary

```
/tracker/tournaments  ──"Projector view"──▶  /tracker/tournaments/board (new tab)
                                                   │
                                          initial fetch (RLS-scoped):
                                          active tournaments + latest round each
                                                   │
                                          ProjectorBoard renders grid of BoardPanel
                                                   │
                                          Supabase Realtime sub (rounds, tournaments)
                                          ── row change ──▶ re-derive affected panel
                                                   │
                                          each BoardPanel: useRoundCountdown ticks
                                          locally every 1s off started_at + round_length
```

## Testing

- **`useRoundCountdown` hook:** unit-test the math — time remaining for a given `started_at`/duration, expired at/after end, warning/urgent thresholds, null `startTime` returns full duration.
- **Panel state derivation:** unit-test mapping of round fields → panel state (running / not-started / between-rounds / expired).
- **Board behavior:** manual verification with multiple active tournaments — grid scales 1→6 panels; starting a round on one tournament (from another tab) updates the board via Realtime; ending a tournament removes its panel; hide/show toggle persists across refresh.

## Risks / open questions

- **Realtime not yet enabled** on `rounds`/`tournaments` — implementation must verify and enable via migration if needed.
- **Many tournaments** (8+) make timers small; acceptable for v1 since a single host rarely runs that many simultaneously. No pagination in v1.
- **Clock skew:** countdown uses the display device's local clock against the server `started_at`. A badly-wrong device clock skews the displayed time. Same behavior as today's per-tournament timer; not addressed in v1.
