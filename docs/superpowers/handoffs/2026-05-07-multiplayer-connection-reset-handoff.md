# Multiplayer Connection Resilience — Handoff

**Date:** 2026-05-07
**Status:** Minimal-port shipped to `main`, but **a regression is suspected** (full page reloads on alt-tab during pregame). Diagnosis in progress; awaiting user-supplied console output to confirm root cause.

## TL;DR

We shipped a community-validated SpacetimeDB connection-reset pattern ("null-tick remount") to fix zombie WebSocket freezes. The implementation is on `main`, all unit tests pass. **Manual verification surfaced a UX problem:** the user reports that during the pregame ritual, every alt-tab back to the play tab causes a full page reload. A Firefox profile confirms full HTML page loads of `/play/NKUO` are happening, but the pattern doesn't match what our `triggerReset()` actually does — so the cause is not yet pinned down. Next step is to read console output during one alt-tab cycle.

## What was built

Six commits on `main`, in dependency order:

```
60cf82c feat(spacetimedb): add ping procedure for connection liveness checks
ccc1ffd chore: regenerate SpacetimeDB client bindings
983f34e feat(play): add pure decision logic for visibility-resume reconnect
a7b2adc feat(play): add SpacetimeConnectionResetWrapper
b8013f6 feat(play): add ReconnectOnResume component
bf16771 feat(play): wire SpacetimeConnectionResetWrapper into the play page
```

Plus an unrelated `d7f98e5 fix not filters` that landed mid-stream — not part of this work.

### Files touched

**New:**
- `spacetimedb/src/index.ts` — appended `export const ping = spacetimedb.procedure(t.string(), (_ctx) => 'pong');`
- `lib/spacetimedb/module_bindings/ping_procedure.ts` (regenerated)
- `lib/spacetimedb/module_bindings/index.ts` (regenerated, registers procedure)
- `lib/spacetimedb/module_bindings/types/procedures.ts` (regenerated, types)
- `app/play/lib/connectionResetDecision.ts` — pure decision functions, exports `HIDDEN_DURATION_THRESHOLD_MS`, `shouldRequireResetWithoutPing`, `shouldRequirePingCheck`, `ConnectionHealthKind`
- `app/play/lib/__tests__/connectionResetDecision.test.ts` — 8 vitest tests, all pass
- `app/play/components/SpacetimeConnectionResetWrapper.tsx` — owns `idle ↔ restarting` state machine + null-tick remount + 2s cooldown floor + `triggerReset()` context
- `app/play/components/ReconnectOnResume.tsx` — visibility/focus listeners, ping verification

**Modified:**
- `app/play/[code]/client.tsx:7-8,95-103` — replaced `<SpacetimeProvider>` with `<SpacetimeConnectionResetWrapper>`, added `<ReconnectOnResume />` as first child

**Untouched (intentionally):**
- `app/play/hooks/useSpacetimeConnection.ts` — wrapper takes its `connectionBuilder` as a prop, chains its own callbacks via the SDK's multi-subscriber emitter pattern
- `app/play/lib/spacetimedb-provider.tsx` — still used by lobby (`GameLobby.tsx:107`) and spectator (`spectate/[code]/client.tsx:28`)

## The regression (current blocker)

**User's report:** "during the pregame ritual, the entire screen would reload each time I tabbed away from it."

**Profile evidence** (`Firefox 2026-05-07 00.41 profile.json` at the repo root):

In 21 seconds on the play tab (PID 31117, thread 28), four full HTML page loads of `/play/NKUO` fired:

```
RSC prefetch:  90367313.7   /play/NKUO?_rsc=...      42ms
HTML load #1:  90370031.1   /play/NKUO              815ms
HTML load #2:  90370846.0   /play/NKUO              547ms   (815ms after #1)
HTML load #3:  90375216.3   /play/NKUO              576ms   (4.4s after #2)
HTML load #4:  90375793.7   /play/NKUO              619ms   (577ms after #3)
```

Hot stacks confirm full JS parsing each time (`js::frontend::SourceUnits`, `InflateUTF8ToUTF16`). These are **real full HTML reloads**, not RSC fetches.

**Important:** our `triggerReset()` does NOT do this. It swaps a React `key` prop on the inner `<SpacetimeDBProvider>`, which re-mounts the React subtree but doesn't trigger a Next.js navigation, doesn't re-fetch HTML, doesn't re-parse the JS bundle. Whatever's causing the four full reloads is something else.

The double-loads (#1+#2 within 815ms, #3+#4 within 577ms) are too fast for human refresh — pattern suggests programmatic `location.reload()` or auth middleware redirect chains.

**Hypotheses, ranked by likelihood:**

1. **Next.js Fast Refresh in dev mode is escalating to hard reload** when our wrapper unmounts/remounts the SpacetimeDBProvider subtree. Fast Refresh tries to preserve state across hot updates; when it can't, it falls back to full reload. **Test:** does the symptom persist with `npm run build && npm start`? If not, this is the cause and production is fine.
2. **Supabase auth middleware redirect chain.** `middleware.ts` runs `updateSession()` on every play-page navigation; if an auth refresh fails or redirects, that could cascade.
3. **Something in our wrapper IS firing reset AND another mechanism (HMR, middleware) escalates it.** Less likely, but the sequence of two reloads within ~600ms is suspicious.

**What I asked the user (not yet answered when context filled):**
- Were they in dev mode (`npm run dev`) or production build during the test?
- Did the console show `[connection-reset] triggering reset; reason: <X>` lines? The reason text would identify which path triggered it.
- Did they manually press Cmd-R or was it automatic?

## What to do next

**Step 1: confirm the cause.**

Get console output from a single alt-tab cycle:

```
1. npm run dev
2. Open /play/<code> in two windows, start a game (so it's in pregame)
3. DevTools open in one window, Console panel
4. Alt-tab to the other window for ~5 seconds
5. Alt-tab back
6. Read console for [connection-reset] and [game-debug] log lines
```

If `[connection-reset]` lines appear, our wrapper is firing — read the reason. If they don't appear, our wrapper isn't the cause.

**Step 2: try production build.**

```
npm run build && npm start
```

Repeat the alt-tab test. If reloads stop, the cause is dev-mode Fast Refresh; the fix is "ship it, this is a dev-only annoyance." Note this in release notes.

**Step 3: if the bug is real in production, the options are:**

- **(a) Revert the wire-up commit (`bf16771`).** Lobby and spectator already keep working. The play page goes back to using the existing thin `<SpacetimeProvider>`. The zombie-WS bug returns, but the alt-tab reload regression is gone. Manual refresh is the workaround until something better lands.
- **(b) Tighten the wrapper's behavior:**
  - Remove `onDisconnect → triggerReset()` (currently in [`SpacetimeConnectionResetWrapper.tsx`](../../app/play/components/SpacetimeConnectionResetWrapper.tsx) lines ~119-125). Rely only on visibility-resume + ping. This avoids resetting on every spurious SDK disconnect (e.g., browsers may close idle WebSockets when the tab is hidden, then the SDK fires `onDisconnect` when JS resumes, triggering our reset).
  - Change `connectionHealth` initial state from `'dropped'` to `'live'` (optimistic). If the wrapper's `onConnect` callback for some reason doesn't fire (timing race with the SDK provider's effect), the wrapper won't be stuck thinking the connection is dead.
- **(c) Implement the image-cache hoist (see "FAANG roadmap" below).** Even if reset triggers correctly, the canvas re-render is jarring. Hoisting the image cache above the provider means provider remount preserves the cache → flicker drops from up to 8s to ~one frame.

## What we know works

- The minimal-port unit tests pass (`npx vitest run app/play/lib/__tests__/connectionResetDecision.test.ts` — 8/8).
- The full project test suite passes (9831/9831). The 7 "failed" files are unrelated svix package noise inside nested `.claude/worktrees/`.
- The `ping` procedure is deployed to Maincloud (Task 1 verified by the spacetimedb-deploy skill — both dev and prod databases updated).
- Type checking passes for the new files.
- Final code reviewer's verdict: "ship as-is" architecturally; only minor follow-ups.

## What was tried and didn't work (avoid repeating)

These were proposed in earlier drafts of the FAANG-shaped spec; later reviews disproved them. Don't reinvent.

1. **`useMemo([rebuildEpoch])` on the connection builder, holding the provider in place.** Doesn't work. The SDK's `ConnectionManager.retain()` cancels the deferred `setTimeout(0)` cleanup at [`connection_manager.ts:122-126`](../../node_modules/spacetimedb/src/sdk/connection_manager.ts#L122-L126) and returns the cached dead connection at lines 128-130.
2. **`<SpacetimeDBProvider key={epoch}>` remount in place (without the null tick).** Doesn't work either. React's commit phase batches unmount cleanup and new mount setup synchronously; the SDK's `setTimeout(0)` cleanup runs *after* the new `retain()` already cancelled `pendingRelease`. Same outcome as #1.
3. **Calling `connection.disconnect()` directly.** Doesn't work. The `ConnectionManager` refcount stays high; subsequent `retain()` returns the same disconnected connection.
4. **Appending `?epoch=N` to the connection URI** to fool `ConnectionManager.getKey()` into seeing a different cache key. *This actually works mechanically* (verified by the research subagent), but it depends on undocumented `getKey()` string-concat behavior and could regress silently in any future SDK version. The community-validated null-tick pattern is more durable.
5. **A `forceRebuild()` method on the SDK.** A community PR ([#4631](https://github.com/clockworklabs/SpacetimeDB/pull/4631)) proposed this in March 2026, was opened and closed unmerged the same day. Not coming any time soon. Issue [#1936](https://github.com/clockworklabs/SpacetimeDB/issues/1936) has been open since 2024.

## The "null tick" — why it actually works

This is the architectural crux of the implementation; preserve it through any rewrites.

The SDK's `ConnectionManager` (at [`node_modules/spacetimedb/src/sdk/connection_manager.ts`](../../node_modules/spacetimedb/src/sdk/connection_manager.ts)) refcounts connections keyed by `URI::moduleName`. When the refcount drops to zero, cleanup is deferred via `setTimeout(0)` so React StrictMode's unmount/remount doesn't accidentally tear down a still-needed connection.

Our wrapper does this:
1. `resetPhase = 'restarting'` → wrapper renders `null` synchronously (provider unmounts, `release()` schedules `setTimeout(0)`).
2. The wrapper's own `useEffect` watching `resetPhase` schedules its own `setTimeout(0)` to bump `providerInstanceId` and set `resetPhase = 'idle'`.
3. Macrotask FIFO: `release()`'s `setTimeout(0)` was queued first, fires first → `disconnect()` runs, entry deleted from `connections` Map.
4. The wrapper's `setTimeout(0)` then fires → bumps `providerInstanceId` → re-render → wrapper renders provider with new key → React mounts fresh provider → `retain()` finds no entry → builder is invoked → fresh connection.

The `null` render between unmount and remount is what gives the SDK's `setTimeout(0)` room to run before the next `retain()`. Without it, `retain()` cancels `pendingRelease` and returns the cached dead connection.

## Reference docs

All in `docs/superpowers/`:

- **Spec (current, minimal port):** [`specs/2026-05-07-multiplayer-connection-reset-port-design.md`](../specs/2026-05-07-multiplayer-connection-reset-port-design.md) — what we shipped
- **Spec (FAANG roadmap):** [`specs/2026-05-06-multiplayer-connection-resilience-design.md`](../specs/2026-05-06-multiplayer-connection-resilience-design.md) — the larger plan if/when this minimal port proves insufficient. Includes telemetry pipeline, watchdog, tracked reducers, image cache hoist, tiered UX, SLOs.
- **Plan (executed):** [`plans/2026-05-07-multiplayer-connection-reset-port.md`](../plans/2026-05-07-multiplayer-connection-reset-port.md) — six tasks, all complete.

External:
- [Community `SpacetimeConnectionProvider`](https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx) — the canonical implementation we ported
- [SpacetimeDB issue #1936](https://github.com/clockworklabs/SpacetimeDB/issues/1936) — official acknowledgment of the gap
- [SpacetimeDB Maincloud server config (15s ping, 30s idle timeout)](https://github.com/clockworklabs/SpacetimeDB/blob/master/crates/client-api/src/routes/subscribe.rs)

Diagnostic profiles in `prompt_context/`:
- `Firefox 2026-05-06 22.54 profile.json` — original zombie-WS reproduction (28s, established the root cause)
- `Firefox 2026-05-07 00.41 profile.json` — post-implementation regression evidence (21s, the four full HTML reloads)

The script for inspecting these is `scripts/inspect-firefox-profile.py`. Don't `cat` the profile JSONs — they're 100+ MB single-line files that will blow context.

## Decisions worth knowing about

These aren't obvious from the code; capturing them so they don't get re-litigated.

1. **Why we ported a community pattern rather than building from scratch.** Three rounds of subagent review on the FAANG-shaped design kept finding architectural problems with our own approach. The third reviewer pointed at the [SufyaanKhateeb workaround](https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx) and noted the null-tick pattern is the only thing the community has validated against the actual SDK behavior. Adopting it verbatim was strictly safer than rolling our own.

2. **Why `useSpacetimeConnection` was left untouched.** Was tempted to absorb its callbacks into the new wrapper. Backed off because: (a) the lobby and spectator pages also depend on it, (b) the SDK supports multi-subscriber callbacks via `EventEmitter`, so chaining ours on top of the existing ones works fine, (c) keeping the hook stable means lobby/spectator don't need to change.

3. **Why the spec is a separate file from the FAANG-shaped spec.** They have genuinely different scopes. Folding them via a "Phase 0" addendum was considered and rejected — it muddied both. The FAANG spec stays as the future-roadmap reference.

4. **Why we didn't add component-level tests for the wrapper.** The project doesn't have `@testing-library/react` or jsdom installed. Adding them was out of scope per the minimal-port spec — it would've doubled the work. Pure decision logic IS unit-tested. Wrapper correctness was supposed to be validated by manual definition-of-done tests (Task 6) — which is exactly where the regression surfaced. The trade-off bit us in the right place: the bug is observable from manual testing.

5. **Why `connectionHealth` initial state is `'dropped'`.** Mirrors the community provider exactly. Considered changing to `'live'` (optimistic), didn't because (a) deviation from the reference implementation, (b) the visibility-resume handler shouldn't fire on initial mount (`lastHiddenAtRef.current` starts null, so `hiddenDuration === 0`, so `shouldRequirePingCheck` returns false). If the regression turns out to be the wrapper's `onConnect` not firing, switching to `'live'` initial state is option (b) under "What to do next."

## Final reviewer's flagged minor follow-ups (not blockers)

1. `app/play/components/SpacetimeConnectionResetWrapper.tsx:123` reads `resetPhase` from a closure that's frozen at memo-creation time (always `'idle'`). Harmless because `triggerReset()`'s internal check is authoritative, but the line is misleading code. Remove the redundant guard or rely entirely on `triggerReset`'s internal check.
2. `app/play/components/ReconnectOnResume.tsx:75` uses `(conn as any).procedures.ping({})` — typed bindings exist (`PingArgs`, `PingResult` in `lib/spacetimedb/module_bindings/types/procedures.ts`); could drop the cast. Cosmetic only.
3. `connectionResetDecision.test.ts` — could add a test for `hiddenDurationMs: 0` explicitly (currently only via `null`) and a negative-duration regression test for clock skew. Not blocking.

## Working environment

- User chose to work directly on `main` (declined worktree). Acceptable given the user's explicit consent; the unrelated DeckPickerModal mod from before this conversation was committed by the user as `c68b6c7 fix buttons` and is unrelated to our work.
- All commits include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Vitest is the test runner. Run with `npx vitest run <path>` (no `npm test` script defined).
- The `spacetimedb-deploy` skill must be invoked after any change to `spacetimedb/src/index.ts` or `schema.ts`. It handles `spacetime publish` + `spacetime generate` together.
- Project has memory feedback: don't run full `next build` after small changes (CLAUDE.md context).

## Open question I want answered when work resumes

The most actionable single thing: **is the user running `npm run dev` (Next.js Fast Refresh on) or a production build?** That answer alone narrows the diagnosis from "unknown bug" to either "Fast Refresh quirk, fine in prod" or "real regression, dig deeper."
