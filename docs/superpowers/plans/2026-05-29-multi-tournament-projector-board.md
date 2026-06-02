# Multi-Tournament Projector Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-screen, display-only `/board` route that shows live countdown timers for all of a host's currently-active tournaments, for projecting at a venue.

**Architecture:** Pure round-timer math lives in `lib/tournament/roundTimer.ts` (Node-testable). A thin `useRoundCountdown` hook wraps it with a 1s interval; the existing `CountdownTimer` is refactored onto the hook with no behavior change. A client `ProjectorBoard` fetches the host's active tournaments (RLS-scoped) plus each one's current round, renders a responsive grid of `BoardPanel`s with explicit dark colors, subscribes to Supabase Realtime (the repo's first consumer — requires a publication migration) and refetches on any change, keeps the screen awake via the Wake Lock API, and persists a hidden-tournament set in localStorage.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (`@supabase/ssr` browser client + Realtime), Tailwind, Vitest (Node env).

---

## File Structure

**Create:**
- `lib/tournament/roundTimer.ts` — pure functions: remaining seconds, time formatting, urgency, panel-state derivation.
- `lib/tournament/__tests__/roundTimer.test.ts` — Node unit tests for the above.
- `components/ui/useRoundCountdown.ts` — client hook wrapping the pure math with a 1s interval (no audio, no theme classes).
- `supabase/migrations/040_enable_realtime_for_board.sql` — add `rounds` + `tournaments` to the `supabase_realtime` publication.
- `app/board/page.tsx` — full-screen route (server component shell).
- `app/board/boardData.ts` — `BoardTournament` type + `fetchActiveBoardData()` client fetch.
- `app/board/useWakeLock.ts` — screen wake-lock hook.
- `app/board/BoardPanel.tsx` — one tournament panel (name, round progress, board-sized timer, loud expiry, placeholders).
- `app/board/ProjectorBoard.tsx` — grid, realtime, hide/show toggle, wake lock, empty state.

**Modify:**
- `components/ui/CountdownTimer.tsx` — reimplement on `useRoundCountdown` (no visual change).
- `components/ui/background.tsx:9` — add `/board` to `SKIP_BACKGROUND_PREFIXES`.
- `app/tracker/tournaments/page.tsx:~127` — add "Projector view" button to the header.

**Confirmed schema (live DB):** `tournaments` has `id, name, host_id, current_round, n_rounds, round_length` (minutes), `has_started, has_ended, created_at`. `rounds` has `tournament_id, round_number, started_at, is_completed` (no `created_at`, no `has_started`). RLS: `tournaments` SELECT scoped to `auth.uid() = host_id`; `rounds` scoped via its tournament's `host_id`.

---

## Task 1: Pure round-timer logic (`lib/tournament/roundTimer.ts`)

**Files:**
- Create: `lib/tournament/roundTimer.ts`
- Test: `lib/tournament/__tests__/roundTimer.test.ts`

This is the only logic with real branches, so it gets full TDD in Node (matches the existing `lib/tournament/__tests__/` pattern). The board and the refactored `CountdownTimer` both consume these functions, guaranteeing they never disagree.

- [ ] **Step 1: Write the failing test**

Create `lib/tournament/__tests__/roundTimer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  getRemainingSeconds,
  formatRemaining,
  getUrgency,
  derivePanelState,
} from "../roundTimer";

const T0 = "2026-05-29T12:00:00.000Z";
const t0ms = new Date(T0).getTime();

describe("getRemainingSeconds", () => {
  it("returns full duration when startTime is null", () => {
    expect(getRemainingSeconds(null, 45, t0ms)).toBe(45 * 60);
  });
  it("counts down from start", () => {
    // 10 minutes into a 45 minute round -> 35 minutes left
    expect(getRemainingSeconds(T0, 45, t0ms + 10 * 60 * 1000)).toBe(35 * 60);
  });
  it("clamps to zero at and past the end", () => {
    expect(getRemainingSeconds(T0, 45, t0ms + 45 * 60 * 1000)).toBe(0);
    expect(getRemainingSeconds(T0, 45, t0ms + 60 * 60 * 1000)).toBe(0);
  });
});

describe("formatRemaining", () => {
  it("formats mm:ss under an hour", () => {
    expect(formatRemaining(35 * 60 + 5)).toBe("35:05");
    expect(formatRemaining(0)).toBe("00:00");
  });
  it("formats h:mm:ss at/over an hour", () => {
    expect(formatRemaining(60 * 60 + 2 * 60 + 3)).toBe("1:02:03");
  });
});

describe("getUrgency", () => {
  it("expired at zero", () => {
    expect(getUrgency(0, 45)).toEqual({ isExpired: true, isWarning: false, isUrgent: false });
  });
  it("warning within last 10%", () => {
    // 45min round, 10% = 4.5min = 270s; 200s left is warning
    expect(getUrgency(200, 45)).toEqual({ isExpired: false, isWarning: true, isUrgent: false });
  });
  it("urgent within last 25% but above 10%", () => {
    // 600s left of 2700s = 22.2% -> urgent
    expect(getUrgency(600, 45)).toEqual({ isExpired: false, isWarning: false, isUrgent: true });
  });
  it("calm above 25%", () => {
    expect(getUrgency(2000, 45)).toEqual({ isExpired: false, isWarning: false, isUrgent: false });
  });
});

describe("derivePanelState", () => {
  it("not-started when round missing", () => {
    expect(derivePanelState(null)).toBe("not-started");
  });
  it("not-started when started_at is null", () => {
    expect(derivePanelState({ started_at: null, is_completed: false })).toBe("not-started");
  });
  it("between-rounds when completed", () => {
    expect(derivePanelState({ started_at: T0, is_completed: true })).toBe("between-rounds");
  });
  it("running when started and not completed", () => {
    expect(derivePanelState({ started_at: T0, is_completed: false })).toBe("running");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournament/__tests__/roundTimer.test.ts`
Expected: FAIL — cannot resolve `../roundTimer` (module not found).

- [ ] **Step 3: Write the implementation**

Create `lib/tournament/roundTimer.ts`:

```ts
export type PanelState = "not-started" | "running" | "between-rounds";

export interface CurrentRound {
  started_at: string | null;
  is_completed: boolean;
}

export interface Urgency {
  isExpired: boolean;
  isWarning: boolean;
  isUrgent: boolean;
}

/** Seconds remaining in the round. Null startTime => full duration (round not started). */
export function getRemainingSeconds(
  startTime: string | null,
  durationMinutes: number,
  nowMs: number,
): number {
  if (!startTime) return durationMinutes * 60;
  const startMs = new Date(startTime).getTime();
  const endMs = startMs + durationMinutes * 60 * 1000;
  return Math.floor(Math.max(0, endMs - nowMs) / 1000);
}

/** mm:ss, or h:mm:ss when an hour or more remains. */
export function formatRemaining(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/** Escalation flags. Mirrors the existing CountdownTimer thresholds (10% / 25%). */
export function getUrgency(remainingSeconds: number, durationMinutes: number): Urgency {
  const totalSeconds = durationMinutes * 60;
  const pct = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const isExpired = remainingSeconds === 0;
  const isWarning = !isExpired && pct <= 0.1;
  const isUrgent = !isExpired && !isWarning && pct <= 0.25;
  return { isExpired, isWarning, isUrgent };
}

/** Which panel state to show, derived from the current round row. */
export function derivePanelState(round: CurrentRound | null): PanelState {
  if (!round || !round.started_at) return "not-started";
  if (round.is_completed) return "between-rounds";
  return "running";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournament/__tests__/roundTimer.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add lib/tournament/roundTimer.ts lib/tournament/__tests__/roundTimer.test.ts
git commit -m "feat: add pure round-timer logic for projector board"
```

---

## Task 2: `useRoundCountdown` hook + refactor `CountdownTimer`

**Files:**
- Create: `components/ui/useRoundCountdown.ts`
- Modify: `components/ui/CountdownTimer.tsx`

No automated test: Vitest runs in a Node environment with no DOM and `@testing-library`/`jsdom` are not installed, so hooks/components can't be rendered in tests. The math is already covered by Task 1; this task is verified by the existing test suite still passing, a typecheck, and a manual check of the per-tournament page.

- [ ] **Step 1: Create the hook**

Create `components/ui/useRoundCountdown.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import {
  getRemainingSeconds,
  formatRemaining,
  getUrgency,
  type Urgency,
} from "@/lib/tournament/roundTimer";

export interface RoundCountdown extends Urgency {
  remainingSeconds: number;
  timeString: string;
}

/** Ticks every second off `startTime` + `durationMinutes`. Pure of audio/theme. */
export function useRoundCountdown(
  startTime: string | null,
  durationMinutes: number,
): RoundCountdown {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    getRemainingSeconds(startTime, durationMinutes, new Date().getTime()),
  );

  useEffect(() => {
    setRemainingSeconds(
      getRemainingSeconds(startTime, durationMinutes, new Date().getTime()),
    );
    if (!startTime) return;
    const id = setInterval(() => {
      setRemainingSeconds(
        getRemainingSeconds(startTime, durationMinutes, new Date().getTime()),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [startTime, durationMinutes]);

  return {
    remainingSeconds,
    timeString: formatRemaining(remainingSeconds),
    ...getUrgency(remainingSeconds, durationMinutes),
  };
}
```

- [ ] **Step 2: Refactor `CountdownTimer` onto the hook**

Replace the entire contents of `components/ui/CountdownTimer.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRoundCountdown } from "./useRoundCountdown";

interface CountdownTimerProps {
  startTime: string | null;
  durationMinutes: number;
  soundNotifications?: boolean;
}

export default function CountdownTimer({
  startTime,
  durationMinutes,
  soundNotifications = false,
}: CountdownTimerProps) {
  const { remainingSeconds, timeString, isExpired, isWarning, isUrgent } =
    useRoundCountdown(startTime, durationMinutes);
  const [soundPlayed, setSoundPlayed] = useState(false);

  // Reset the once-per-round sound guard whenever a new round starts.
  useEffect(() => {
    setSoundPlayed(false);
  }, [startTime]);

  // Play the alert once when the running round hits zero.
  useEffect(() => {
    if (!soundNotifications || soundPlayed || !startTime) return;
    if (remainingSeconds !== 0) return;
    setSoundPlayed(true);
    try {
      const audio = new Audio("/notification-alert.mp3");
      audio.volume = 0.5;
      audio.play().catch((error) => {
        console.warn("Could not play notification sound:", error);
      });
    } catch (error) {
      console.warn("Could not play notification sound:", error);
    }
  }, [remainingSeconds, startTime, soundNotifications, soundPlayed]);

  const sizeClass =
    isExpired || isWarning
      ? "text-3xl sm:text-4xl font-bold"
      : "text-xl sm:text-2xl font-semibold";
  const colorClass =
    isExpired || isWarning
      ? "text-destructive animate-pulse"
      : isUrgent
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";

  return (
    <span
      className={`font-mono tabular-nums leading-none whitespace-nowrap ${sizeClass} ${colorClass}`}
      aria-label={isExpired ? "Time's up" : `Round timer: ${timeString} remaining`}
      role="status"
    >
      {timeString}
    </span>
  );
}
```

- [ ] **Step 3: Typecheck and run the existing suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run test`
Expected: PASS (existing tests unaffected; the new roundTimer tests pass).

- [ ] **Step 4: Manual verification on the per-tournament page**

Run: `npm run dev`, open a started tournament at `/tracker/tournaments/<id>` with a running round.
Expected: the header timer counts down exactly as before — same size/colors, amber in the last 25%, red pulsing in the last 10% and at 0:00. No visual difference from `main`.

- [ ] **Step 5: Commit**

```bash
git add components/ui/useRoundCountdown.ts components/ui/CountdownTimer.tsx
git commit -m "refactor: extract useRoundCountdown hook, reimplement CountdownTimer on it"
```

---

## Task 3: Enable Supabase Realtime (migration)

**Files:**
- Create: `supabase/migrations/040_enable_realtime_for_board.sql`

The `supabase_realtime` publication currently contains zero tables; without this the board's `.subscribe()` silently delivers nothing.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/040_enable_realtime_for_board.sql`:

```sql
-- Enable Supabase Realtime for the projector board.
--
-- Why: the projector board (/board) is the app's first Realtime consumer. The
-- supabase_realtime publication currently contains zero tables, so a client
-- .subscribe() on rounds/tournaments would receive no change events. This adds
-- both tables to the publication and sets REPLICA IDENTITY FULL so UPDATE/DELETE
-- payloads carry old-row values (lets the client confirm an event belongs to a
-- tournament it is already showing). RLS still governs which rows are delivered.

ALTER PUBLICATION supabase_realtime ADD TABLE rounds, tournaments;

ALTER TABLE rounds REPLICA IDENTITY FULL;
ALTER TABLE tournaments REPLICA IDENTITY FULL;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name: `040_enable_realtime_for_board`, the SQL above), or run the SQL directly against the project.
Expected: success, no error.

- [ ] **Step 3: Verify the publication**

Run this query (Supabase MCP `execute_sql`):

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' ORDER BY tablename;
```

Expected: rows include `rounds` and `tournaments`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/040_enable_realtime_for_board.sql
git commit -m "feat: enable supabase realtime on rounds and tournaments for board"
```

---

## Task 4: Board data fetch (`app/board/boardData.ts`)

**Files:**
- Create: `app/board/boardData.ts`

Client-side fetch of the host's active tournaments plus each one's current round. RLS scopes `tournaments` to the host; the round query mirrors the per-tournament page exactly (`round_number = current_round`) so the board never disagrees with it.

- [ ] **Step 1: Create the fetch module**

Create `app/board/boardData.ts`:

```ts
import { createClient } from "@/utils/supabase/client";
import type { CurrentRound } from "@/lib/tournament/roundTimer";

export interface BoardTournament {
  id: string;
  name: string;
  current_round: number;
  n_rounds: number;
  round_length: number;
  created_at: string;
  round: CurrentRound | null;
}

/**
 * Active tournaments for the logged-in host (RLS-scoped), each with its current
 * round row. Sorted by created_at so panel order is stable across refetches.
 */
export async function fetchActiveBoardData(): Promise<BoardTournament[]> {
  const supabase = createClient();

  const { data: tournaments, error } = await supabase
    .from("tournaments")
    .select("id, name, current_round, n_rounds, round_length, created_at")
    .eq("has_started", true)
    .eq("has_ended", false)
    .order("created_at", { ascending: true });

  if (error || !tournaments) return [];

  return Promise.all(
    tournaments.map(async (t) => {
      const { data: round } = await supabase
        .from("rounds")
        .select("started_at, is_completed")
        .eq("tournament_id", t.id)
        .eq("round_number", t.current_round)
        .maybeSingle();
      return { ...t, round: (round as CurrentRound) ?? null } as BoardTournament;
    }),
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/board/boardData.ts
git commit -m "feat: add active-board data fetch for projector board"
```

---

## Task 5: Wake-lock hook (`app/board/useWakeLock.ts`)

**Files:**
- Create: `app/board/useWakeLock.ts`

- [ ] **Step 1: Create the hook**

Create `app/board/useWakeLock.ts`:

```ts
"use client";

import { useEffect } from "react";

/**
 * Keeps the screen awake while mounted (projector won't sleep mid-event).
 * Re-acquires on tab re-show, since browsers release the lock when hidden.
 * No-ops where the Wake Lock API is unavailable.
 */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        if ("wakeLock" in navigator) {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Denied or unsupported — acceptable, just no lock.
      }
    };

    request();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
    };
  }, []);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`WakeLockSentinel` and `navigator.wakeLock` are in the DOM lib types shipped with TypeScript 5; if your tsconfig `lib` excludes them, change `lock`'s type to `any` and guard with `(navigator as any).wakeLock`.)

- [ ] **Step 3: Commit**

```bash
git add app/board/useWakeLock.ts
git commit -m "feat: add screen wake-lock hook for projector board"
```

---

## Task 6: Board panel (`app/board/BoardPanel.tsx`)

**Files:**
- Create: `app/board/BoardPanel.tsx`

One tournament: name (Cinzel), round progress, and a board-sized timer with a loud full-panel expiry. Uses explicit dark colors (NOT semantic tokens), since the host's theme (`light`/`dark`/`jayden`) must not change the board.

- [ ] **Step 1: Create the component**

Create `app/board/BoardPanel.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import { useRoundCountdown } from "@/components/ui/useRoundCountdown";
import { derivePanelState } from "@/lib/tournament/roundTimer";
import type { BoardTournament } from "./boardData";

export function BoardPanel({ tournament }: { tournament: BoardTournament }) {
  const state = derivePanelState(tournament.round);
  const { timeString, isExpired } = useRoundCountdown(
    tournament.round?.started_at ?? null,
    tournament.round_length,
  );
  const expired = state === "running" && isExpired;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border p-6 text-center transition-colors",
        expired ? "border-red-500 bg-red-700" : "border-neutral-800 bg-neutral-900",
      )}
    >
      <h2 className="line-clamp-2 font-cinzel text-2xl font-bold text-neutral-50 sm:text-3xl md:text-4xl">
        {tournament.name}
      </h2>
      <p className="text-lg text-neutral-400 sm:text-xl">
        Round {tournament.current_round} of {tournament.n_rounds}
      </p>

      {state === "running" && !expired && (
        <span className="font-mono text-[12vw] font-bold leading-none tabular-nums text-neutral-50 md:text-[9vw]">
          {timeString}
        </span>
      )}
      {expired && (
        <span className="font-mono text-[12vw] font-extrabold leading-none tabular-nums text-white md:text-[9vw] animate-pulse">
          TIME
        </span>
      )}
      {state === "not-started" && (
        <span className="text-2xl text-neutral-400 sm:text-3xl">
          Round {tournament.current_round} — starting soon
        </span>
      )}
      {state === "between-rounds" && (
        <span className="text-2xl text-neutral-400 sm:text-3xl">
          Round {tournament.current_round} complete — pairings coming
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/board/BoardPanel.tsx
git commit -m "feat: add BoardPanel for projector board"
```

---

## Task 7: Projector board container (`app/board/ProjectorBoard.tsx`)

**Files:**
- Create: `app/board/ProjectorBoard.tsx`

Full-bleed `fixed inset-0` container (covers the root `<main>` and any chrome). Holds the responsive grid, realtime subscription (refetch on any event), hide/show toggle with localStorage, wake lock, and the empty state.

- [ ] **Step 1: Create the component**

Create `app/board/ProjectorBoard.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";
import { fetchActiveBoardData, type BoardTournament } from "./boardData";
import { BoardPanel } from "./BoardPanel";
import { useWakeLock } from "./useWakeLock";

const HIDDEN_KEY = "board:hidden-tournament-ids";

function gridClassFor(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]";
}

export function ProjectorBoard() {
  const [tournaments, setTournaments] = useState<BoardTournament[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [showControls, setShowControls] = useState(false);
  useWakeLock();

  // Restore hidden set from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      if (raw) setHidden(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const refetch = useCallback(async () => {
    setTournaments(await fetchActiveBoardData());
  }, []);

  // Initial fetch + realtime: refetch the whole active set on any change.
  useEffect(() => {
    refetch();
    const supabase = createClient();
    const channel = supabase
      .channel("projector-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  const toggleHidden = (id: string) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write failures
      }
      return next;
    });
  };

  const visible = tournaments.filter((t) => !hidden.includes(t.id));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-neutral-950 p-4 text-neutral-50">
      {visible.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center">
          <p className="font-cinzel text-3xl text-neutral-500 sm:text-4xl">
            No active tournaments
          </p>
        </div>
      ) : (
        <div className={cn("grid h-full w-full auto-rows-fr gap-4", gridClassFor(visible.length))}>
          {visible.map((t) => (
            <BoardPanel key={t.id} tournament={t} />
          ))}
        </div>
      )}

      {/* Hide/show control — unobtrusive, host-facing only. */}
      <div className="absolute right-3 top-3">
        <button
          onClick={() => setShowControls((s) => !s)}
          aria-label="Board settings"
          className="rounded-md bg-neutral-800/70 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
        >
          &#9881;
        </button>
        {showControls && (
          <div className="mt-1 max-h-[60vh] w-64 overflow-auto rounded-md bg-neutral-900 p-2 text-sm shadow-lg">
            {tournaments.length === 0 ? (
              <p className="p-2 text-neutral-500">No tournaments</p>
            ) : (
              tournaments.map((t) => (
                <label key={t.id} className="flex items-center gap-2 p-1 text-neutral-200">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(t.id)}
                    onChange={() => toggleHidden(t.id)}
                  />
                  <span className="truncate">{t.name}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/board/ProjectorBoard.tsx
git commit -m "feat: add ProjectorBoard container with realtime, hide/show, wake lock"
```

---

## Task 8: Route + background skip (`app/board/page.tsx`)

**Files:**
- Create: `app/board/page.tsx`
- Modify: `components/ui/background.tsx:9`

- [ ] **Step 1: Create the route**

Create `app/board/page.tsx`:

```tsx
import { ProjectorBoard } from "./ProjectorBoard";

export const metadata = {
  title: "Projector Board | RedemptionCCG",
  description: "Live round timers for your active tournaments.",
};

export default function BoardPage() {
  return <ProjectorBoard />;
}
```

- [ ] **Step 2: Add `/board` to the background skip list**

In `components/ui/background.tsx`, change line 9 from:

```tsx
const SKIP_BACKGROUND_PREFIXES = ["/decklist/", "/tracker/", "/admin/", "/play"];
```

to:

```tsx
const SKIP_BACKGROUND_PREFIXES = ["/decklist/", "/tracker/", "/admin/", "/play", "/board"];
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. As a host with at least one started tournament (running round), open `/board`.
Expected: full-screen dark board, no site nav/header/footer, tournament name + "Round X of Y" + a large counting-down timer. Confirm it still looks right in light, dark, and jayden themes (board stays dark in all three).

- [ ] **Step 5: Commit**

```bash
git add app/board/page.tsx components/ui/background.tsx
git commit -m "feat: add /board projector route and skip background image"
```

---

## Task 9: "Projector view" entry button

**Files:**
- Modify: `app/tracker/tournaments/page.tsx` (header block, ~lines 127–138)

- [ ] **Step 1: Add the button to the header**

In `app/tracker/tournaments/page.tsx`, the header currently is:

```tsx
<div className="flex items-center justify-between gap-3 flex-wrap mb-6">
  <h1 className="text-2xl font-bold mt-2">Your Tournaments</h1>
  <Button
    onClick={() => setisAddTournamentModalOpen(true)}
    className="flex items-center gap-3 mt-2 bg-primary text-primary-foreground hover:bg-primary/90"
  >
    <div className="flex items-center gap-1">
      <HiPlus className="w-4 h-4" />
      <span>Host a Tournament</span>
    </div>
  </Button>
```

Wrap the two actions in a flex group and add the projector link before the "Host a Tournament" button:

```tsx
<div className="flex items-center justify-between gap-3 flex-wrap mb-6">
  <h1 className="text-2xl font-bold mt-2">Your Tournaments</h1>
  <div className="flex items-center gap-2 mt-2 flex-wrap">
    <a href="/board" target="_blank" rel="noopener noreferrer">
      <Button
        variant="outline"
        className="flex items-center gap-2"
      >
        <HiOutlineDesktopComputer className="w-4 h-4" />
        <span>Projector view</span>
      </Button>
    </a>
    <Button
      onClick={() => setisAddTournamentModalOpen(true)}
      className="flex items-center gap-3 bg-primary text-primary-foreground hover:bg-primary/90"
    >
      <div className="flex items-center gap-1">
        <HiPlus className="w-4 h-4" />
        <span>Host a Tournament</span>
      </div>
    </Button>
  </div>
```

(Note the `mt-2` moved from the inner buttons to the wrapping `<div>`; remove `mt-2` from the "Host a Tournament" `Button` className as shown.)

- [ ] **Step 2: Add the icon import**

The icons line (currently `import { HiPencil, HiTrash, HiPlus } from "react-icons/hi";`) needs the desktop icon. Update it to:

```tsx
import { HiPencil, HiTrash, HiPlus, HiOutlineDesktopComputer } from "react-icons/hi";
```

Confirm `Button` supports the `variant="outline"` prop — it does in this codebase's shadcn `components/ui/button.tsx`. If `variant` is unavailable, replace `variant="outline"` with `className="flex items-center gap-2 border border-input bg-background hover:bg-accent"`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open `/tracker/tournaments`.
Expected: a "Projector view" button sits in the header next to "Host a Tournament"; clicking it opens `/board` in a new tab.

- [ ] **Step 5: Commit**

```bash
git add app/tracker/tournaments/page.tsx
git commit -m "feat: add Projector view button to tournaments list"
```

---

## Task 10: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Realtime round transitions**

With `npm run dev` running and `/board` open in one tab, open a tournament's management page in another tab. Start a round.
Expected: within ~1–2s the board panel switches from "starting soon" to a live countdown — no manual refresh.

- [ ] **Step 2: Multi-tournament grid**

Have 2–4 active tournaments. Open `/board`.
Expected: grid is 1 / side-by-side / 2×2 as counts grow; each timer is the dominant element on its panel; panel order is stable (doesn't reshuffle on refetch).

- [ ] **Step 3: Expiry, end, hide/show, empty**

- Let a round reach 0:00 → panel goes full red with "TIME". (Set a short `round_length` on a test tournament to reach this quickly.)
- End a tournament → its panel disappears from the board on the next event.
- Open the ⚙ control, uncheck a tournament → it hides; refresh the page → it stays hidden (localStorage).
- End/hide all → board shows "No active tournaments".

- [ ] **Step 4: Final full test + build**

Run: `npm run test`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 5: Commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: projector board verification fixups"
```

(Skip if nothing changed.)

---

## Self-Review notes

- **Spec coverage:** route at app root (Task 8) · entry button (Task 9) · auto-include active + RLS (Task 4) · hide/show + localStorage single key (Task 7) · name + round progress + giant timer (Task 6) · loud full-panel TIME (Task 6) · not-started / between-rounds states (Task 6) · empty state (Task 7) · dark via explicit colors (Tasks 6–7) · realtime publication migration + refetch-on-event + client backstop via known IDs (Tasks 3, 7) · pure countdown hook, no audio (Tasks 1–2) · `current_round` keying (Task 4) · wake lock (Tasks 5, 7) · stable order by `created_at` (Task 4) · CountdownTimer behavior-preserving (Task 2). All covered.
- **Realtime RLS caveat:** the spec calls for client-side re-filtering as a backstop. Because the board **refetches the full RLS-scoped set on every event** (rather than trusting event payloads), rows that don't belong to the host never reach a panel — the refetch is the backstop. No per-event payload filtering is needed; if future code consumes payloads directly, re-filter by the fetched tournament IDs then.
- **Test environment:** only Task 1 has automated tests (pure functions, Node). Hooks/components are verified by typecheck + manual steps, matching the repo's Node-only Vitest setup (no jsdom/testing-library installed). This is a deliberate, documented constraint, not a gap.
```
