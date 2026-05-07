# Multiplayer Connection Reset — Minimal Port

**Status:** Design
**Date:** 2026-05-07
**Scope:** Port the community-validated `SpacetimeConnectionProvider` pattern verbatim, adapted for our codebase. No telemetry, no watchdog, no banner, no tracked reducers. Just reactive reset on visibility / disconnect events.

## Why this spec exists

We have a longer companion spec at [`2026-05-06-multiplayer-connection-resilience-design.md`](2026-05-06-multiplayer-connection-resilience-design.md) describing a comprehensive, production-grade ("FAANG-shaped") connection-resilience system: state machine, watchdog, telemetry, SLOs, tiered UX, tracked reducers, image cache hoist, four phases.

That plan is the right destination, but it's a multi-week project. **This spec is the minimum first step that solves the most common failure mode.** It ports a working community pattern verbatim, ships in a day, and gives us a foundation to layer additional capability onto if real-world data shows it's needed.

If after shipping this we observe (a) ongoing freezes that aren't resolved by visibility-triggered reset, (b) a need to measure incidents in production, or (c) UX feedback that "the canvas flickered" is unacceptable — then we open the longer spec and build the next layer. Until then, this is enough.

## Problem (brief)

Players' browsers occasionally freeze mid-game. The board still renders but actions don't propagate. Confirmed root cause via Firefox profile: a half-open WebSocket where the server tore down the connection (15s ping interval, 30s idle timeout on Maincloud) but the client's `WebSocket.onclose` never fired. The SDK doesn't detect this and has no built-in reconnect ([SpacetimeDB issue #1936](https://github.com/clockworklabs/SpacetimeDB/issues/1936)).

The dominant trigger is **laptop sleep / lid close / screen lock / alt-tab → return**: tab loses visibility, OS suspends or network state changes, server tears down the WS, browser never gets the close frame. When the user returns to the tab, the page sits frozen.

Detailed diagnosis lives in the longer spec; not duplicated here.

## Design

### What we're porting

The reference implementation is the [`SpacetimeConnectionProvider`](https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx) referenced in issue #1936. It's a wrapper around `SpacetimeDBProvider` with two responsibilities:

1. **State machine** (`idle` ↔ `restarting`) that uses the "null tick" remount pattern to actually force the SDK's `ConnectionManager` to build a fresh connection. (See longer spec section 3b for why this specific sequence is necessary; the short version: render `null` for one tick between unmount and remount, so `setTimeout(0)` cleanup fires before the next `retain()`.)
2. **Visibility/focus reactivity** via an inner `ReconnectOnResume` component that pings the server when the tab returns from being hidden, and triggers a reset if the ping fails.

### Files

**New:**

- `app/play/components/SpacetimeConnectionResetWrapper.tsx` — port of the community provider, adapted to our codebase. Mounted in place of the existing thin `<SpacetimeProvider>` at the play-page tree only. Owns the `idle ↔ restarting` state machine, the null-tick remount sequence, the `RECONNECT_COOLDOWN_MS = 2000` floor, and the `triggerReset()` API exposed via context.

  Key integration choice: the wrapper accepts a `connectionBuilder` prop (matching the existing `SpacetimeProvider`'s prop shape) so it's a **drop-in replacement** — no changes to `useSpacetimeConnection.ts` or its consumers. Internally the wrapper chains its own `.onConnect()` / `.onDisconnect()` / `.onConnectError()` callbacks onto the passed-in builder via `useMemo`. The SDK supports multiple callbacks per event, so the existing callbacks in `useSpacetimeConnection.ts` (which drive `isConnected` for the lobby UI) coexist with the wrapper's callbacks (which drive the reset state machine).

  The `ConnectionStatusIndicator` component from the community code is **omitted** in this spec. Connection status is silent (the user sees a brief canvas re-render on reset, no UI label). Easy to add later if real-world feedback wants it.

- `app/play/components/ReconnectOnResume.tsx` — small component used inside the provider's children. Listens for `visibilitychange` and `focus`. On return-to-visible, pings the server; if ping fails or returns unexpected, calls `triggerReset()` from the wrapper's context.

  Lives outside the wrapper file because it needs `useSpacetimeDB().getConnection()` from inside the provider tree — has to render as a child of the inner `SpacetimeDBProvider`, not within the wrapper itself.

**Modified server-side (requires `make` to regenerate bindings + redeploy module):**

- `spacetimedb/src/index.ts` — add a `ping` procedure:
  ```typescript
  export const ping = spacetimedb.procedure(t.string(), () => 'pong');
  ```
  Procedures (unlike reducers) can return values to the caller. This one returns `'pong'`. Used by `ReconnectOnResume` to verify the WS round-trip after visibility resume.

**Modified:**

- `app/play/[code]/client.tsx:7,94` — replace `import { SpacetimeProvider }` with `SpacetimeConnectionResetWrapper`, and swap `<SpacetimeProvider>` for the new wrapper. Render `<ReconnectOnResume />` as a sibling to existing children inside the wrapper. ~3-line change.

- `app/play/lib/spacetimedb-provider.tsx` — **leave alone.** The lobby ([`GameLobby.tsx:107`](../../../app/play/components/GameLobby.tsx#L107)) and spectator page ([`spectate/[code]/client.tsx:28`](../../../app/play/spectate/[code]/client.tsx#L28)) still use this thin wrapper. The reset-wrapper is play-page-only for this minimal port; lobby and spectator are short-lived enough that their freeze risk is acceptable. They can be migrated later if needed. The BigInt polyfill at the top of the existing file stays where it is.

### What this implements

| Trigger | Behavior |
|---|---|
| Tab regains visibility after being hidden ≥ 30s | Send `ping` procedure with 5s timeout. If `'pong'` returned → no action. Else → `triggerReset()`. |
| Tab regains visibility but state is anything other than `live` | `triggerReset()` immediately (no ping check needed; we already know the connection is bad). |
| `window.focus` event | Same as visibility-visible. |
| SDK fires `onDisconnect` | `triggerReset()` immediately. |
| SDK fires `onConnectError` | `triggerReset()` after recording the error. |
| Two reset attempts within 2s | The second one is a no-op (`RECONNECT_COOLDOWN_MS = 2000` floor). |

### What this does NOT implement

Honest list of capabilities deferred to the longer spec:

- **No watchdog.** If the user keeps the tab focused but the WS dies silently mid-game (rare but real — e.g., NAT timeout while actively playing), this spec doesn't detect it. Recovery requires the user to alt-tab or trigger a visibility event.
- **No banner UX.** The user sees a brief flash on reset; there is no "Connection lost — reconnecting" message.
- **No telemetry.** We have no production data on how often resets fire or whether they succeed.
- **No SLOs.** We can't measure detection latency or recovery duration.
- **No tracked reducers.** A reducer call in flight at the moment of reset is silently dropped. The user's optimistic UI gets reverted to the server's authoritative state with no signal to retry.
- **No image cache hoist.** On reset, the Konva canvas re-initializes and the image preloader's cache is destroyed. In practice, the browser's HTTP cache should serve card images instantly on re-fetch, so the visible flicker is typically <2 seconds. On a cold cache it could be up to 8 seconds (`IMAGE_GATE_TIMEOUT_MS`). If this is unacceptable, see the longer spec's Phase 2.
- **No modal at terminal failure.** If reconnect attempts fail repeatedly, there's no explicit UI; the connection silently keeps trying. The user can manually refresh.

### Failure modes

| Failure | Mitigation |
|---|---|
| Reset happens mid-turn while user is dragging a card | Drag operation resets along with the canvas. User has to start over. Acceptable tradeoff for the simplicity. |
| Two visibility events fire in rapid succession (debounced/queued by the OS) | `RECONNECT_COOLDOWN_MS = 2000` floor in the wrapper prevents pile-on. |
| `ping` procedure call hangs indefinitely on a half-open WS | `ReconnectOnResume`'s ping uses a 5s timeout via `Promise.race`. On timeout, `triggerReset()` is called. |
| `onDisconnect` fires during a `restarting` phase | The wrapper's `requestReconnect` early-returns when `resetPhase === 'restarting'`. No double-reset. |
| Reset succeeds but the game's 5-minute server-side `DisconnectTimeout` already fired | The reconnect rehydrates the `Game` row with `disconnectTimeoutFired === true`. The existing UI ([`opponentConnectionStatus`](../../../app/play/hooks/useGameState.ts#L234-L247) / [`GameOverOverlay`](../../../app/play/components/GameOverOverlay.tsx)) handles the "game already over" case cleanly. No new code needed. |

## Definition of done

1. **Manual test in Chrome / Firefox / Safari:**
   - Open `/play/<code>` for a game in progress.
   - Open DevTools → Network → set throttling to "Offline" for 35 seconds.
   - Re-enable network.
   - Connection should auto-reset within 5 seconds of bringing the network back.
2. **Manual test, alt-tab scenario:**
   - Open `/play/<code>`.
   - Alt-tab to another window. Wait 35 seconds.
   - Return to the play tab.
   - `ReconnectOnResume` should ping; if ping succeeds, no visible change. If the connection actually died during the alt-tab, a brief canvas flicker, then the game resumes.
3. **No regressions:**
   - Two-player games can be created, joined, played to completion.
   - The `joinAsSpectator` flow still works.
   - No console errors in steady-state play.
4. **Server-side `ping` procedure deployed to Maincloud** and confirmed callable via the SpacetimeDB CLI or a one-off client script.

## References

- [SufyaanKhateeb/my-exness `SpacetimeConnectionProvider`](https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx) — the canonical implementation we're porting.
- [SpacetimeDB issue #1936](https://github.com/clockworklabs/SpacetimeDB/issues/1936) — official acknowledgment that auto-reconnect is the consumer's responsibility; references this community pattern.
- [Companion FAANG-shaped spec](2026-05-06-multiplayer-connection-resilience-design.md) — describes the longer-term roadmap if/when this minimal port proves insufficient.
- [Existing `useSpacetimeConnection`](../../../app/play/hooks/useSpacetimeConnection.ts) — current connection hook we're integrating with.
- [Existing thin `SpacetimeProvider` wrapper](../../../app/play/lib/spacetimedb-provider.tsx) — kept as-is for lobby and spectator; only the play page swaps to the reset wrapper.

## Open questions (deferable)

- **Do we want a status indicator?** The community code includes one; we omitted it for simplicity. Easy to add later as a single component.
- **Should the `ping` procedure include a server timestamp** so we can use it for clock-skew detection or RTT measurement? Probably not for this port; revisit if/when telemetry comes in.
- **Should we set the WebSocket idle-timeout via a SpacetimeDB module config?** Maincloud's defaults are 15s ping / 30s idle. Self-hosted would let us tune these. Out of scope.
