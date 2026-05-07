# Multiplayer Connection Resilience

**Status:** Design
**Date:** 2026-05-06
**Scope:** Desktop browsers only. Mobile is explicitly out of scope.

## Problem

Multiplayer players occasionally experience their browser "freezing" mid-game. The board appears connected (the OPP dot stays green), the user takes actions that have no effect, and the only known recovery is a full page refresh. The freeze can persist for minutes before it resolves on its own (when the server's 5-minute `DisconnectTimeout` fires and the game forfeits).

### Confirmed root cause

A Firefox profile of a frozen tab ([prompt_context/Firefox 2026-05-06 22.54 profile.json](../../../prompt_context/Firefox%202026-05-06%2022.54%20profile.json)) shows:

- Tab's JS event loop is healthy: 60fps `RefreshDriverTick`, 3,359 `requestAnimationFrame` callbacks, 176 DOM events over 28 seconds.
- **Zero WebSocket traffic** in the same window. No SpacetimeDB messages, no network markers.
- Meanwhile the opponent's tab shows the user as yellow ("reconnecting") in [TurnIndicator.tsx:295-310](../../../app/play/components/TurnIndicator.tsx#L295-L310), proving the SpacetimeDB server already fired `clientDisconnected` ([spacetimedb/src/index.ts:5531](../../../spacetimedb/src/index.ts#L5531)).

This is a **zombie WebSocket**: the TCP connection went half-open (laptop sleep/wake, Wi-Fi flap, NAT timeout), the server tore down the WS, but the client's `WebSocket` object never received the `close` event. The SDK's [`onDisconnect`](../../../app/play/hooks/useSpacetimeConnection.ts#L36-L39) callback never fires, [`useSpacetimeConnection().isConnected`](../../../app/play/hooks/useSpacetimeConnection.ts#L26) stays `true`, and the React tree is stranded with stale data on a dead pipe. OS-level TCP keepalive defaults to ~2 hours, so the browser won't notice on its own.

**Server-side timing context:** SpacetimeDB Maincloud uses a 15s WebSocket ping interval and 30s idle timeout ([`crates/client-api/src/routes/subscribe.rs`](https://github.com/clockworklabs/SpacetimeDB/blob/master/crates/client-api/src/routes/subscribe.rs)). When laptop sleep / Wi-Fi flap kills the WS, the server tears down at the 30s mark; in the typical case where the client OS swallows the close frame, this is exactly when the zombie state begins.

### Why the SDK doesn't fix this

The SpacetimeDB TypeScript SDK (`spacetimedb@2.1.0`) implements no application-level liveness:

- Source verified: zero hits for `ping`, `pong`, `heartbeat`, or `keepalive` in `node_modules/spacetimedb/src/sdk/`. The only WebSocket logic is `ws.onclose` propagation in [`db_connection_impl.ts:258`](../../../node_modules/spacetimedb/src/sdk/db_connection_impl.ts#L258).
- No automatic reconnect on disconnect. Consumers must rebuild `DbConnection` manually.
- Acknowledged gap in [SpacetimeDB issue #1936](https://github.com/clockworklabs/SpacetimeDB/issues/1936) ("Opt-in automated reconnect for SDK clients"), open since 2024. The official guidance from a Clockwork contributor: *"construct a new `DbConnection` manually in response to whatever event signals that the user has returned focus to your page."* When asked specifically about React, the same maintainer admitted *"I am unsure how to do this with our React hooks specifically."*
- A community PR ([#4631](https://github.com/clockworklabs/SpacetimeDB/pull/4631) "feat(ts-sdk): add reconnect() method to DbConnectionImpl") proposed exactly this missing API in March 2026 — opened and closed unmerged the same day with no maintainer engagement. **Treat this as a permanent gap.**
- The connection-rebuild story we land on here must be a workaround at the application layer.
- Maincloud's server-side `ping-interval` / `idle-timeout` (documented for [standalone deployments](https://spacetimedb.com/docs/cli-reference/standalone-config/) only) help the *server* detect dead clients (which it does — that's why the opponent sees yellow), but provide no help to the client.

### Why not "just refresh"

Today the player has no signal that anything is wrong. They sit through the game's 5-minute timeout — or, if observant, notice their actions stop working and refresh manually after some unknown delay. There is no in-product affordance for either *detecting* the stale state or *recovering* without losing local UI state.

## Goals and Non-goals

### Goals

1. **Detect stale connections within p99 < 20s** of the WebSocket actually dying.
2. **Recover automatically** in the most common cases (laptop wake, alt-tab return, BFCache restore) without the user noticing.
3. **Surface a banner** when auto-recovery fails or hasn't been attempted, so the player can take action.
4. **Capture telemetry** sufficient to measure incidents in production and tune thresholds.
5. **Preserve game flow** — recovery must not cause mid-turn UI flicker, lost reducer calls, or desynced state.

### Non-goals

- Mobile support. Desktop browsers (Chrome, Firefox, Safari, Edge) only. iOS Safari background-tab handling explicitly excluded.
- Replacing the SpacetimeDB SDK or contributing upstream to issue #1936.
- Cross-tab connection sharing. One tab, one connection.
- Offline-first / local-first play. The player needs a live connection; recovery means restoring it, not faking it.

## Design

### Architecture overview

Five components, four phases. Phases ship independently; each phase is gated on data from the previous one.

```
┌─────────────────────────────────────────────────────────────┐
│                  ConnectionStateMachine                      │
│  (single source of truth — replaces scattered isConnected)   │
└────┬─────────────────────────────────┬──────────────────────┘
     │                                 │
     ▼                                 ▼
┌─────────────┐                ┌──────────────────┐
│  Detection  │                │  Recovery (UX)   │
│             │                │                  │
│ - heartbeat │                │ - ambient dot    │
│ - watchdog  │                │ - banner         │
│ - lifecycle │                │ - modal          │
└─────────────┘                │ - auto-reconnect │
                               └────────┬─────────┘
                                        │
                                        ▼
                               ┌──────────────────┐
                               │   Telemetry      │
                               │  (Supabase)      │
                               └──────────────────┘
```

### Component 1 — Connection State Machine

A single hook, `useConnectionState`, that exposes one discriminated union:

```ts
type ConnectionState =
  | { kind: 'connected'; lastInboundAt: number }
  | { kind: 'stale'; lastInboundAt: number; staleSinceMs: number; trigger: StaleTrigger }
  | { kind: 'reconnecting'; attempt: number; nextDelayMs: number }
  | { kind: 'disconnected'; reason: DisconnectReason; finalAttempt: number };

type StaleTrigger = 'watchdog' | 'visibilityChange' | 'pageshow' | 'navigatorOffline' | 'sdkOnDisconnect';
type DisconnectReason = 'maxAttemptsExceeded' | 'gameFinished' | 'userResigned';
```

This replaces every read of `useSpacetimeConnection().isConnected` in the play tree. The state machine is the only thing the UI binds to. All transitions emit telemetry events.

**Transitions:**
- `connected → stale` when the watchdog trips or `visibilitychange → visible` finds the tab was hidden ≥30s AND `ping` fails. **Note:** `sdkOnDisconnect` does *not* go through `stale` — see below.
- `connected → reconnecting` directly when SDK `onDisconnect` fires. The connection is provably dead; no point observing for `stale` first. (Matches the community provider's `handleDisconnect` calling `requestReconnect` immediately.)
- `stale → reconnecting` when auto-recovery attempts a `triggerReset()` call.
- `reconnecting → connected` on a successful rebuild + first inbound row callback.
- `reconnecting → reconnecting` on retry (exponential backoff, with 2s cooldown floor).
- `reconnecting → disconnected` (`reason: 'maxAttemptsExceeded'`) when 60s budget exhausted without a successful rebuild.
- `reconnecting → disconnected` (`reason: 'gameFinished'`) when, after a successful rebuild, the rehydrated `Game` row has `disconnectTimeoutFired === true` (the server already forfeited the game during the outage). The state machine reads this from the same source as the existing [`opponentConnectionStatus`](../../../app/play/hooks/useGameState.ts#L234-L247) derivation. The blocking modal text changes to reflect "the game ended while you were disconnected" rather than "lost connection."
- `* → disconnected` (`reason: 'userResigned'`) when the user explicitly resigns via the existing UI; this isn't a connection-failure path but is included so the modal isn't shown over a normal end-of-game.
- `connected ↔ stale` is reversible — if the watchdog trips and a row callback then fires before recovery starts, transition straight back to `connected`.

### Component 2 — Detection layer

Three independent inputs feed the state machine:

#### 2a. Inbound traffic watchdog

A `lastInboundAtRef` updated to `Date.now()` whenever **any** of the following fires:
- A subscribed SpacetimeDB row callback (`onInsert`, `onUpdate`, `onDelete` on every table the play page subscribes to: `Game`, `Player`, `CardInstance`, `CardCounter`, `ChatMessage`, `GameAction`, `DisconnectTimeout`, etc.).
- The Promise resolution from awaited `conn.reducers.registerPresence({ gameId })` calls. **Critical implementation note:** the SpacetimeDB SDK does not expose a generic "subscribe to all reducer events" API ([verified in `node_modules/spacetimedb/src/sdk/db_connection_impl.ts`](../../../node_modules/spacetimedb/src/sdk/db_connection_impl.ts) — `#reducerCallbacks` is a private map keyed by `requestId`, exposed only via the Promise returned from each `conn.reducers.X(...)` call). The watchdog must `await` the heartbeat reducer call directly and bump `lastInboundAtRef` on resolution. Do not assume any other callback mechanism exists.

A `setInterval(check, 1000)` computes `silentMs = Date.now() - lastInboundAtRef.current`. If `silentMs > 20_000` and `game.status === 'playing'`, transition to `stale` with `trigger: 'watchdog'`.

The watchdog is the **authoritative** signal. Lifecycle hooks below are *triggers* that prompt an immediate check, but the watchdog decides.

#### 2b. Application-level heartbeat

A second `setInterval(maybeHeartbeat, 1000)` that fires `conn.reducers.registerPresence({ gameId })` only when:

- `Date.now() - lastInboundAtRef.current > 15_000` (no inbound for 15s — gates against unnecessary load when the game is already producing traffic).
- `game.status === 'playing'`.
- State is `connected` (don't ping while reconnecting).
- `myPlayer` row exists and is loaded (initial render protection only — before the first `Player` row arrives, no heartbeat fires; the existing one-shot `register_presence` from [`client.tsx:223`](../../../app/play/[code]/client.tsx#L223) handles initial presence).

**Note on "is the server's view consistent with mine?":** earlier drafts gated the heartbeat on `myPlayer.isConnected === true` to avoid presence-flip thrash. That gate was wrong. The exact failure case we are detecting is "server has flipped `isConnected = false` and we never received the row update" — under that condition, our local `myPlayer.isConnected` stays `true` regardless. The gate would have done nothing protective in the failure case while masking the recovery path in benign cases. Drop it. Heartbeat fires whenever the gates above pass, and `register_presence` does whatever the server-side state requires (no-op or full presence revival). Any opponent-visible flicker from a presence flip during recovery is documented under failure modes.

Effective interval: ~20s in idle play, ~0 during active turns. Each heartbeat is wrapped in `Promise.race([reducerCall.catch(() => undefined), sleep(5000)])`. **Why both the race and the catch:** the SDK's `#reducerCallbacks` map has no per-call timeout — if the WebSocket half-opens, the Promise from `conn.reducers.registerPresence(...)` may never resolve. The 5s race timeout caps in-flight heartbeats and lets us treat the timeout itself as a signal. The `.catch(() => undefined)` on the underlying call prevents `unhandledrejection` events when the underlying reducer rejects late (e.g., `SenderError` arriving after the race already resolved via timeout) — without it, the browser's `unhandledrejection` handler fires repeatedly under network instability. Max one heartbeat in flight at a time; if `maybeHeartbeat` fires while the previous heartbeat hasn't resolved or timed out, skip this tick.

Each heartbeat is an idempotent server transaction (the [`register_presence`](../../../spacetimedb/src/index.ts#L1537-L1562) reducer is a no-op when `isConnected === true` and no `DisconnectTimeout` exists). The heartbeat exists to (a) generate an observable signal on quiet turns so the watchdog can confirm liveness even when no row changes are happening, and (b) force an outbound TCP write that will eventually surface a half-open socket as RST → `WebSocket.onclose` → SDK `onDisconnect`.

#### 2c. Browser lifecycle hooks

Three event listeners attached on the play page mount:

| Event | Action |
|---|---|
| `visibilitychange` → `hidden` | Record `lastHiddenAtRef.current = Date.now()`. No state change. |
| `visibilitychange` → `visible` (or `window.focus`) | Compute `hiddenDuration = Date.now() - (lastHiddenAtRef.current ?? Date.now())`. Branch on conditions matching the community provider: (a) if state is anything other than `connected`, `triggerReset()` immediately. (b) if state is `connected` but `hiddenDuration >= 30_000`, fire a `ping` procedure call with a 5s timeout. If `ping` returns `'pong'` → mark connection live, no reset. If ping fails / times out / returns unexpected → `triggerReset()`. (c) otherwise no action. Reset `lastHiddenAtRef.current = null`. |
| `pageshow` with `event.persisted === true` | BFCache restore. Existing `WebSocket` is dead. Reset `lastInboundAtRef` to `Date.now()` to avoid a stale-time false positive on the first watchdog tick after restore, then `triggerReset()` immediately without waiting for the watchdog. Trigger: `'pageshow'`. |
| `pagehide` with `event.persisted === true` | BFCache freeze. Emit `state_from='session_started', state_to='session_paused'` telemetry event so the SLO denominator isn't undercounted if the page is evicted before resume. (See "session event reliability" below.) |
| `online` | Hint only. Force an immediate watchdog check (recompute `silentMs`, fire heartbeat). Do not directly transition state. Watchdog remains authoritative — `navigator.onLine` returns `true` for captive portals. |
| `offline` | Hint only. Force an immediate watchdog check. Do not directly transition state. `navigator.onLine === false` can fire transiently on Wi-Fi scans that resolve in milliseconds — letting it directly drive transitions creates false-positive flapping that contradicts the watchdog-authority contract. The watchdog's missed heartbeats will catch a real outage within 20s. |

The SDK's `onDisconnect` callback is also wired in: it calls `triggerReset()` immediately, transitioning straight from `connected → reconnecting` (skipping `stale` entirely).

**`ping` procedure (new server-side addition):** the spec adds a SpacetimeDB *procedure* (not reducer — procedures can return values to the caller, reducers can't) at `spacetimedb/src/index.ts`:

```typescript
export const ping = spacetimedb.procedure(t.string(), () => 'pong');
```

Used by the visibility-resume verification path above. Procedure call returns 'pong' on a healthy WS round-trip; anything else (timeout, throw, unexpected payload) is treated as confirmation that the connection is dead. This is belt-and-suspenders verification — strictly speaking, awaiting `register_presence` and observing Promise resolution is sufficient — but the explicit `'pong'` payload check matches community-validated production code and gives us a side-effect-free liveness probe distinct from the presence-side-effect-having heartbeat.

**Session event reliability:**
- **React strict mode:** `useEffect` runs cleanup→effect twice on first mount in dev. The session telemetry must be guarded with a `useRef` flag to ensure exactly one `session_started` per real mount. (Check the ref before emitting on mount, set on emit; clear on unmount.)
- **BFCache freeze without unmount:** `pagehide.persisted=true` does NOT run effect cleanup — the page is frozen. The session row stays "open" indefinitely from the SLO query's perspective. The mitigation is the synthetic `session_paused` event above. The SLO query treats `session_paused` as terminating the denominator for that session id; if the page later resumes via `pageshow.persisted=true`, a fresh `session_started` is emitted with a new `session_id` so prior dangling rows don't pollute analysis.

### Component 3 — Recovery layer

Two recovery mechanisms, layered UX feedback.

#### 3a. UX tiers

| State | UI |
|---|---|
| `connected` | YOU dot green (`#22c55e`, exact match of OPP dot at [TurnIndicator.tsx:305](../../../app/play/components/TurnIndicator.tsx#L305)). |
| `stale`, no recovery in flight | YOU dot yellow (`#eab308`, matches OPP yellow) + non-blocking banner: *"Connection stale — last update {N}s ago. Reconnect"*. The Reconnect button forces an immediate recovery action (in phase 1, `window.location.reload()`; from phase 2 onward, in-place `DbConnection` rebuild). |
| `reconnecting` | YOU dot yellow pulsing + banner: *"Reconnecting… (attempt {n})"* with a Refresh option. |
| `disconnected` (60s budget exhausted) | Blocking modal: *"Lost connection. The game is still in progress on the server. Refresh to rejoin."* with refresh as the only action. |

Banner appears as soon as the state machine enters `stale`. In phase 1 there is no auto-recovery, so banner shows immediately at `silentMs ≥ 20s`. From phase 3 onward, when watchdog-triggered staleness enters the backoff schedule, the banner is suppressed during the first ~5s of attempts and surfaces only if early attempts fail. Lifecycle-triggered recovery (phase 2) attempts a single immediate rebuild before the banner appears.

The YOU dot lives next to the YOU score in [TurnIndicator.tsx](../../../app/play/components/TurnIndicator.tsx) — exact mirror of the existing OPP dot pattern (same colors, same sizes, same positioning).

#### 3b. Auto-reconnect

**Architectural constraint:** the `DbConnection` is owned by the React `SpacetimeDBProvider` via the SDK's internal `ConnectionManager` ([`node_modules/spacetimedb/src/sdk/connection_manager.ts`](../../../node_modules/spacetimedb/src/sdk/connection_manager.ts)), which refcounts connections keyed by `URI::moduleName` with deferred cleanup via `setTimeout(0)`. Two naïve approaches *do not work* and the spec calls them out so future readers don't try them:

- **`useMemo([rebuildEpoch])` to produce a fresh builder, holding the provider in place.** When the provider effect re-runs with a new builder ref, cleanup runs `release()` (schedules `setTimeout(0)`), then the effect body runs `retain()`, which **cancels the pending release** at [connection_manager.ts:122-126](../../../node_modules/spacetimedb/src/sdk/connection_manager.ts#L122-L126) and returns the cached `managed.connection` at [lines 128-130](../../../node_modules/spacetimedb/src/sdk/connection_manager.ts#L128-L130). The new builder is never invoked. The dead `DbConnectionImpl` persists.
- **`<SpacetimeDBProvider key={rebuildEpoch}>` remount, in place.** React's commit phase batches unmount cleanup and new mount setup synchronously. The `setTimeout(0)` cleanup runs *after* the commit completes — i.e., after `retain()` has already cancelled `pendingRelease`. Same outcome: cached connection returned. This is structurally identical to React StrictMode's unmount/remount, which `ConnectionManager` was [explicitly designed to survive](../../../node_modules/spacetimedb/src/sdk/connection_manager.ts#L13-L26).

**The rebuild mechanism that actually works is the "null tick" pattern**, established by the [`SpacetimeConnectionProvider`](https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx) referenced in the comments of issue #1936. The trick: render `null` for one tick between unmount and remount, giving the `setTimeout(0)` cleanup room to actually fire before the next `retain()`.

The exact community-validated implementation is the reference for our `SpacetimeConnectionResetWrapper`. Concretely:

```tsx
// Conceptual shape (full implementation in app/play/components/SpacetimeConnectionResetWrapper.tsx)
type ResetPhase = 'idle' | 'restarting';

const [providerInstanceId, setProviderInstanceId] = useState(0);
const [resetPhase, setResetPhase] = useState<ResetPhase>('idle');
const isProviderMounted = resetPhase === 'idle';

useEffect(() => {
  if (resetPhase !== 'restarting') return;
  const t = window.setTimeout(() => {
    setProviderInstanceId(n => n + 1);
    setResetPhase('idle');
  }, 0);
  return () => window.clearTimeout(t);
}, [resetPhase]);

return isProviderMounted
  ? <SpacetimeDBProvider key={providerInstanceId} connectionBuilder={builder}>{children}</SpacetimeDBProvider>
  : null;
```

Sequence:

1. **Render N (steady state):** `<SpacetimeDBProvider connectionBuilder={builder} key={epoch}>` mounted with old (dead) connection.
2. **State machine triggers rebuild:** sets `resetPhase = 'unmounting'`.
3. **Render N+1:** the wrapper component renders `null` instead of the provider. React unmounts the provider → effect cleanup → `release(key)` → refcount drops to 0 → `setTimeout(0)` is scheduled.
4. **Same task ends; macrotask runs:** the `setTimeout(0)` fires. `pendingRelease` is non-null. `managed.connection.disconnect()` is called. `connections.delete(key)` runs. The old connection is gone.
5. **State machine sets `resetPhase = 'remounting'` and increments `epoch`** in a `useEffect` (or `requestAnimationFrame`) that runs after the null render commits.
6. **Render N+2:** wrapper renders `<SpacetimeDBProvider connectionBuilder={builder} key={epoch+1}>`. React mounts a fresh provider → effect runs `retain(key, builder)` → no entry exists in `connections` → builder is invoked → fresh connection built.
7. **Wait for `onConnect`** on the new connection OR 5s timeout OR `onConnectError` — whichever first.
8. **`useTable` hooks under the new provider** auto-subscribe on mount.
9. **Wait for the first inbound row callback** OR 5s timeout to confirm subscriptions are delivering data.
10. On full success → `connected`. On any timeout/error → increment `epoch` again for the next attempt (still going through the null-tick sequence).

The wrapper component owns `epoch` and `resetPhase`, plus a `triggerReset()` callback exposed via context. Any component that needs to force a reconnect — the state machine, the banner's "Reconnect" button, the lifecycle handlers — calls `triggerReset()`.

**Why this works where the previous attempts didn't:** the `null` render forces React to commit the unmount alone, with no immediately-following remount. The macrotask boundary is the only thing that lets `setTimeout(0)` fire before the next `retain()`. This is undocumented SDK behavior — neither Clockwork's docs nor the `ConnectionManager` source describe this pattern — but it has been validated in production by the cited community provider.

**Pre-requisite work: image cache hoist (Phase 2).** The Konva canvas's image cache lives inside `useMultiplayerImagePreloader` ([`app/play/hooks/useMultiplayerImagePreloader.ts`](../../../app/play/hooks/useMultiplayerImagePreloader.ts)), called from `GameInner` *below* the provider. A provider remount destroys the cache; on remount, every card image refetches, gated by `IMAGE_GATE_TIMEOUT_MS = 8000` ([`app/play/components/ImageLoadingGate.tsx`](../../../app/play/components/ImageLoadingGate.tsx)). Without this fix, every reconnect causes up to 8 seconds of blank canvas.

The fix: refactor the preloader so its `Map<string, HTMLImageElement>` cache lives in a context provider above `<SpacetimeProvider>`. The URL-derivation logic (which depends on `useTable` data) stays below, but writes into the hoisted cache. Cache survives provider remount. The reconnect flicker drops to a fraction of a second (one Konva re-init, but with images already loaded). Estimated effort: half a day.

**Cost of this approach (acknowledged):** even with the image cache hoist, provider remount unmounts every consumer of `useTable`, every memo, every component below the provider. Konva Stage and Layers re-create. Animations restart. Local UI state below the provider (selected card, hover, drag-in-progress) resets unless hoisted to the wrapper component. The visual experience after the cache hoist: a single-frame canvas re-initialization, similar to a tab refocus animation. Acceptable for visibility-triggered recovery (Phase 3), still noticeable for mid-game watchdog-triggered recovery (Phase 4).

**Local UI state preservation:** the wrapper component (call it `GameRoute`) holds any state that must survive a reset:
- Chat scroll position.
- Paragon drawer open/closed.
- Card preview / loupe visibility (already in `CardPreviewProvider` above the SpacetimeProvider — already safe).
- User preferences read from localStorage.

State that's tied to live game data and is acceptable to reset on reconnect:
- Currently-hovered card.
- Drag operation in progress.
- Right-click context menu open.
- Dice overlay animation state.

**Backoff schedule:** delays of 500ms → 1s → 2s → 4s → 8s → 16s, each ±25% jitter, with a 5s rebuild timeout per attempt. Total budget capped at **60s wall time from entering `stale`**; whichever attempt is in flight when the budget exhausts is allowed to complete, then transition to `disconnected` and show the blocking modal.

**2s reconnect cooldown floor.** Independent of the backoff schedule, `triggerReset()` enforces a minimum 2s gap between consecutive reset attempts (`RECONNECT_COOLDOWN_MS = 2000`, matching the community provider's value). This prevents pile-on when multiple events fire near-simultaneously: e.g., `onDisconnect` + `visibilitychange → visible` + watchdog stale all within 100ms of each other. Without the floor, three resets queue up; with it, only the first executes and the rest are no-ops.

**Triggers:**
- `pageshow` with `persisted === true` → immediate `triggerReset()` (skip backoff entirely; the WS is definitely dead).
- `visibilitychange → visible` AND state is anything other than `connected` → immediate `triggerReset()`. Per the community provider, also call `triggerReset()` when state is `connected` but the tab was hidden ≥ 30s, *after* a `ping` procedure check fails or returns unexpectedly.
- **SDK `onDisconnect` callback fires** → immediate `triggerReset()`. The connection is provably dead; there is no value in transitioning through `stale` and waiting for the watchdog. Bypass the 20s threshold.
- `stale` from watchdog (no lifecycle trigger) → backoff schedule begins immediately on entering `stale`, calling `triggerReset()` per attempt.
- User clicks "Reconnect" button on banner → immediate `triggerReset()`, reset backoff counter.

#### 3c. Pending-reducer tracking

Without this, auto-reconnect causes mid-turn UI flicker and silently lost actions. SpacetimeDB resubscription overwrites the client cache with authoritative state, so any optimistic update tied to an un-acked reducer call gets reverted with no signal to the user.

**Scope warning:** the play tree currently calls `conn.reducers.<name>(...)` from ~60 sites across [`useGameState.ts`](../../../app/play/hooks/useGameState.ts), [`client.tsx`](../../../app/play/[code]/client.tsx), and [`spectate/[code]/client.tsx`](../../../app/play/spectate/[code]/client.tsx). Wrapping all of these in a tracking abstraction is a mass refactor, not a single new hook. The Phase 2 plan must explicitly scope migration of every call site.

The replacement pattern: a `useTrackedReducers()` hook that returns a typed object mirroring `conn.reducers`, where every method:

1. Generates a client-side UUID before invoking the underlying reducer.
2. Adds `{ uuid, reducerName, args, attemptedAt }` to a shared `pendingCalls: Map<uuid, ...>`.
3. Awaits the reducer Promise; removes from the map on resolve/reject (with a 10s safety timeout that logs a `pendingReducerOrphaned` telemetry event).

On reconnect:

- **Do not auto-replay pending calls.** Replay risks double-applying for non-idempotent reducers (`move_card`, `play_card`, `discard`, etc.) since SpacetimeDB has no built-in dedup. The 10s safety timeout above means at most ~10s of pending calls are tracked at any moment.
- If the map is non-empty at the moment of `connected` re-entry after a reconnect, surface a single toast: *"{N} action(s) may not have been received. Replay them if needed."*
- Clear the map after the toast.

The map's size is included in telemetry (`pendingReducerCount`) so we can measure how often this happens.

A future enhancement (out of scope for the four phases below) would add server-side dedup via a `clientCallId` reducer parameter and a small `RecentReducerCalls` table, enabling true auto-replay without double-apply risk. Worth doing only if telemetry shows the manual-retry toast firing often enough to annoy users.

### Component 4 — Telemetry

A new Supabase table `connection_events`:

```sql
create table connection_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id text not null,           -- correlates events across reconnects in one tab
  game_id text,                        -- nullable; not all events happen during a game
  ts timestamptz not null default now(),
  state_from text not null,
  state_to text not null,
  trigger_source text not null,        -- 'watchdog' | 'visibilityChange' | 'pageshow' | etc.
  silent_ms integer,                   -- ms since last inbound when transition fired
  reconnect_attempt integer,           -- 0 if not reconnecting
  ws_close_code integer,               -- if onDisconnect fired with a CloseEvent
  bfcache_restored boolean default false,
  pending_reducer_count integer not null default 0,
  visibility_state text,               -- 'visible' | 'hidden' | 'prerender'
  navigator_online boolean,
  effective_type text,                 -- '4g' | 'wifi' | etc. via Network Information API
  rtt integer,                         -- via Network Information API; nullable
  downlink real,                       -- via Network Information API; nullable
  game_turn integer,                   -- snapshotted from game state
  is_my_turn boolean,
  user_agent text,
  app_version text,                    -- from a build-time injected env var
  -- The wall time the connection was in 'stale' or 'reconnecting' state at the
  -- moment of recovery. Set on any '* → connected' transition that recovered
  -- from stale/reconnecting (i.e., the original entry-into-stale timestamp is
  -- carried through reconnecting state and reported here). Null for transitions
  -- that didn't follow a stale period.
  stale_duration_ms integer,
  -- Whether the user-visible banner would have been rendered at the moment of
  -- this transition. Computed deterministically from the state machine's own
  -- state and banner-suppression rules in section 3a — NOT read from the DOM.
  -- The banner component reads the same state via the hook, so the two are
  -- consistent by construction.
  banner_visible boolean default false
);

create index connection_events_session_id on connection_events(session_id);
create index connection_events_user_id_ts on connection_events(user_id, ts desc);
create index connection_events_game_id on connection_events(game_id) where game_id is not null;
```

In addition to state-machine transitions, the play page emits a synthetic `state_from='page_unmounted', state_to='session_started'` event on mount and `state_from='session_started', state_to='session_ended'` event on unmount, providing a denominator for "% of sessions that hit terminal disconnect" SLO measurements. Without this, the schema has no count of total sessions and the SLO is uncomputable.

Events are inserted via a fire-and-forget Supabase RPC. Failures are silent (logging is best-effort, must not block recovery).

The state machine emits one event per transition. Expected event volume: ~5 events per game session under normal play, more during incidents.

### Component 5 — SLOs

Measured monthly from the `connection_events` table:

| SLO | Target | Measurement |
|---|---|---|
| Detection latency | p99 < 20s | `silent_ms` distribution where `state_from = 'connected' AND state_to = 'stale'` |
| Recovery duration | p99 < 5s | `stale_duration_ms` distribution where `state_to = 'connected' AND stale_duration_ms IS NOT NULL` (covers both direct `stale → connected` recovery and `reconnecting → connected` paths via the carry-through described in the schema) |
| Auto-recovery rate | ≥ 95% | `count(state_to = 'connected' AND stale_duration_ms IS NOT NULL AND banner_visible = false) / count(state_from = 'connected' AND state_to = 'stale')` over the period |
| Terminal failures | < 0.1% of game sessions | `count(state_to = 'disconnected') / count(state_to = 'session_started' WHERE game_id IS NOT NULL)` over the period |

**`stale_duration_ms` carry-through:** the state machine snapshots `staleEnteredAt` on every `connected → stale` transition. The value is held in machine state through any `stale → reconnecting → reconnecting → ...` chain. On the next `* → connected` transition, the elapsed wall time is computed and emitted; `staleEnteredAt` is then cleared. This ensures the SLO measures the user-experienced stall time (entry into stale → restoration of connected), not just the most recent sub-transition.

A monthly review of these numbers gates whether to invest in further phases (silent-reconnect tuning, additional triggers, etc.).

## Phased rollout

Each phase is independently shippable, behind no feature flag (the changes are additive enough that gating is unnecessary). Each phase is tagged in git and rolled back via revert if telemetry indicates regression.

### Phase 1 — Detection + UX + telemetry (one PR)

- `useConnectionState` hook with the full state machine.
- Inbound watchdog, heartbeat, lifecycle hooks (sections 2a–2c).
- YOU dot in [TurnIndicator.tsx](../../../app/play/components/TurnIndicator.tsx).
- `ConnectionBanner` component (new file).
- `connection_events` Supabase table + migration.
- Telemetry RPC + `session_started` / `session_ended` synthetic events.
- **No auto-reconnect yet.** The banner says "Reconnect" — clicking it triggers a manual `window.location.reload()`. (Same UX as today, but now with detection.)

**Definition of done:** in a controlled test (DevTools → Network → Offline), the banner appears within 25s of going offline and a manual refresh restores the game.

### Phase 2 — Image cache hoist (preparatory work)

Standalone refactor that's a hard prerequisite for Phase 3's reconnect UX, but also independently valuable.

- Refactor [`useMultiplayerImagePreloader`](../../../app/play/hooks/useMultiplayerImagePreloader.ts) so its `Map<string, HTMLImageElement>` cache lives in a context provider hoisted above `<SpacetimeProvider>`.
- The URL-derivation logic stays below the provider (it depends on `useTable` data), but writes into the hoisted cache via context.
- Verify [`ImageLoadingGate`](../../../app/play/components/ImageLoadingGate.tsx) sees the cache via the same context.

**Definition of done:** observable cache size on a fresh play page load → manually unmount and remount `GameInner` (e.g., via React DevTools) → cache size unchanged. No re-fetches in the Network tab.

### Phase 3 — Auto-reconnect on lifecycle triggers + tracked reducers

- Wrap `<SpacetimeProvider>` in a new `SpacetimeConnectionResetWrapper` component that owns `epoch` + `resetPhase` state (section 3b). Renders `null` between unmount and remount of the provider.
- `pageshow.persisted=true` and `visibilitychange → visible` (when state is `stale`) call `triggerReset()`.
- `useTrackedReducers` hook + migration of reducer call sites in [`app/play/[code]/client.tsx`](../../../app/play/[code]/client.tsx) and [`app/play/hooks/useGameState.ts`](../../../app/play/hooks/useGameState.ts) (section 3c).
- Banner's "Reconnect" button switches from `window.location.reload()` to `triggerReset()`.

**Definition of done:** alt-tab away for 30s with the watchdog mid-stale, return — connection restores within 5s, single-frame canvas flicker (image cache survives), no full page reload. Tracked-reducer toast surfaces if any reducer call was outstanding at reset time.

### Phase 4 — Backoff-driven reconnect via reset wrapper

- Watchdog-triggered staleness (no lifecycle event) attempts the reset wrapper's backoff schedule (section 3b backoff) before showing the banner.
- Banner appears after 2 failed reset attempts or 5s of attempting, whichever comes first.
- **User-facing behavior:** brief canvas flicker per reset attempt, then reconnects (or escalates to modal at 60s budget).

**Definition of done:** kill the WS via DevTools Offline → re-enable network within 8s → connection restores within ~3s with one brief canvas flicker. SLO "auto-recovery rate" computable from telemetry.

### Phase 5 — Terminal failure modal

- `disconnected` state shows the blocking modal (section 3a).
- Modal text varies by `reason`:
  - `maxAttemptsExceeded` → "Lost connection. The game is still in progress on the server. Refresh to rejoin."
  - `gameFinished` → "The game ended while you were disconnected. Return to the lobby."

**Definition of done:** with network permanently offline for 60s, `maxAttemptsExceeded` modal appears as the only available action. With network coming back after the 5-minute server-side timeout, `gameFinished` modal appears post-rebuild.

## Failure modes and mitigations

| Failure | Mitigation |
|---|---|
| Heartbeat reducer call hangs because WS is half-open | Outbound write surfaces TCP RST within OS retransmit window (~30–60s on Linux, configurable on macOS). The watchdog catches it first via inbound silence at 20s. |
| Watchdog false-positives during a legitimately quiet turn | Heartbeat at 15s of silence guarantees a row callback round-trip every ~20s. If that callback doesn't arrive, the state is genuinely stale. |
| `pageshow` fires with `persisted === false` (normal navigation) | Branch on `event.persisted` strictly. Normal nav doesn't trigger rebuild. |
| `navigator.onLine === true` but captive portal blocks Maincloud | Watchdog still authoritative; captive portal looks identical to a dead WS to it. |
| User refreshes during a `reconnecting` state | Existing presence handling (see [client.tsx:220](../../../app/play/[code]/client.tsx#L220-L227)) recreates the connection on mount. Telemetry session_id is regenerated; this is acceptable. |
| Telemetry RPC fails | Logged to console only. No retry. State machine is unaffected. |
| Multiple rapid stale ↔ connected oscillations | Each transition emits one event. If volume becomes a concern, dedupe at the RPC layer with a 1s debounce — but ship without debounce first; the data is more useful raw. |
| Reconnect succeeds but the game's `DisconnectTimeout` already fired (game forfeited) | Server-side `disconnectTimeoutFired === true` is already surfaced via [opponentConnectionStatus](../../../app/play/hooks/useGameState.ts#L234-L247) — the existing UI handles "game over" cleanly. Our reconnect is a no-op in that case. |
| Heartbeat Promise never resolves AND never rejects (true zombie WS) | Each heartbeat call is wrapped in `Promise.race([reducerCall, sleep(5000)])`. If the race resolves via timeout, treat as a missed heartbeat and don't update `lastInboundAtRef`. Max one heartbeat in flight at a time prevents Promise pile-up. |
| BFCache restore preserves React state but `lastInboundAtRef` is stale | On `pageshow` with `persisted === true`, reset `lastInboundAtRef` to `Date.now()` *before* triggering rebuild. Otherwise the watchdog computes a huge `silentMs` and emits a misleading transition event before the rebuild logic runs. |
| Auto-reconnect causes brief opponent flicker (yellow → green) on their side | Each `DbConnection` rebuild gets a fresh `connectionId` server-side. The server fires `clientDisconnected` for the old one (start of `DisconnectTimeout`), then `clientConnected` for the new one when `register_presence` runs. The opponent's UI will briefly transition opp dot yellow before settling. Acceptable; matches what they already see today during a refresh. Document in release notes; do not attempt to suppress. |
| Game finishes during an in-flight heartbeat | `register_presence` no-ops on `game.status === 'finished'`. Heartbeat Promise resolves successfully but produces no row updates. Watchdog observes the Promise resolution as inbound traffic — correct. The play page unmounts shortly after, ending the heartbeat interval. No special handling needed. |
| `useSpacetimeDB().getConnection()` returns null mid-render during ConnectionManager release | The state machine and heartbeat must null-guard every connection access. A null connection means "between connections" — treat as transient `reconnecting` state, do not emit telemetry events. |
| Heartbeat fires while `myPlayer` row hasn't loaded yet on first render | Gate the heartbeat on `myPlayer` existing in the table. Before the player row is observable, no heartbeat fires; the existing one-shot `register_presence` from [`client.tsx:223`](../../../app/play/[code]/client.tsx#L223) handles initial presence. |
| Heartbeat in flight when `triggerReset()` fires; the underlying Promise resolves later, against the new connection | Each heartbeat captures `epochAtSend = epoch` from the reset wrapper context at send time. On Promise resolution (or race timeout), only bump `lastInboundAt` if `epochAtSend === currentEpoch`. Stale resolutions from the old connection are silently dropped. Without this guard, the new connection's `lastInboundAt` would be falsely bumped by an old heartbeat's late ack. |
| `<SpacetimeProvider>` remount destroys image cache → 8s blank canvas | Phase 2 hoists the image cache above the provider. After Phase 2 ships, provider remount preserves the cache and reconnects flicker for ~one frame instead of up to 8s. **Phase 3 cannot ship without Phase 2.** |
| Phase 3's reset wrapper fails to actually rebuild because of `ConnectionManager` `pendingRelease` cancellation | Mitigated by the null-render-tick pattern in section 3b. The wrapper renders `null` for one tick between unmount and remount, giving `setTimeout(0)` cleanup room to fire before the next `retain()`. Validated against the community [`SpacetimeConnectionProvider`](https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx) pattern. **Implementation must include automated test coverage of this exact sequence to catch regression if a future SDK change breaks the assumption.** |
| User opens DevTools and watches Network — they see WS reconnects every time the watchdog trips | Acceptable; this *is* what's happening. Telemetry captures the same data; DevTools just makes it visible. No mitigation needed. |

## Open questions

None blocking implementation. Items below are explicitly deferred:

- **Should heartbeat interval adapt based on observed RTT?** Probably not for a 2-player game, but worth revisiting if telemetry shows wide RTT variance.
- **Cross-tab coordination?** Currently each tab maintains its own `DbConnection`. If users open multiple play tabs simultaneously, each connection is independent. Not addressed; not currently a reported issue.
- **Should the modal offer "abandon game" in addition to "refresh"?** Defer until phase 4 ship; depends on whether refresh consistently rejoins active games.

## File-touched inventory

New (phase 1):
- `app/play/hooks/useConnectionState.ts` — state machine, watchdog, heartbeat, lifecycle hooks.
- `app/play/components/ConnectionBanner.tsx`.
- `app/play/lib/connectionTelemetry.ts` — Supabase RPC client, fire-and-forget logger, `session_id` management.
- `supabase/migrations/20260506_create_connection_events.sql`.

Modified server-side (phase 1, requires `make` to regenerate bindings + redeploy module):
- `spacetimedb/src/index.ts` — add a `ping` procedure: `export const ping = spacetimedb.procedure(t.string(), () => 'pong');`. Used by visibility-resume verification (section 2c).

New (phase 2):
- `app/play/contexts/ImageCacheContext.tsx` — context provider that owns the `Map<string, HTMLImageElement>` cache, mounted above `<SpacetimeProvider>`.

New (phase 3):
- `app/play/components/SpacetimeConnectionResetWrapper.tsx` — owns `epoch` + `resetPhase`; renders `null` between unmount and remount of the provider; exposes `triggerReset()` via context.
- `app/play/hooks/useTrackedReducers.ts` — typed proxy over `conn.reducers` adding UUID tagging and `pendingCalls` map.

New (phase 5):
- `app/play/components/ConnectionDisconnectedModal.tsx`.

Modified (phase 1):
- `app/play/components/TurnIndicator.tsx` — add YOU dot mirroring OPP, driven by `useConnectionState`.
- `app/play/[code]/client.tsx` — instantiate `useConnectionState`; replace reads of `useSpacetimeConnection().isConnected`; emit `session_started` (strict-mode-guarded via `useRef`) and `session_ended` telemetry.
- `app/play/hooks/useGameState.ts` — feed every `useTable` row callback into the watchdog. **Implementation note:** the existing 9 `useTable(tables.X)` calls take no callback args today. Adding callbacks creates inline objects that — if not memoized — change identity every render and re-run `useTable`'s subscribe effect. The fix has two parts that are both required:
  1. Define the callback functions at **module scope** (not per-render) so their identities are stable. The functions all just bump a module-level `lastInboundAt` mutable.
  2. Wrap the *callbacks object* passed to each `useTable` in a `useMemo(() => ({ onInsert, onUpdate, onDelete }), [])` (empty deps — the object itself never needs to change). Without this wrapping, a new object literal every render triggers re-subscription regardless of function identity.

Modified (phase 2):
- `app/play/components/MultiplayerCanvas.tsx`, `app/play/hooks/useMultiplayerImagePreloader.ts`, `app/play/components/ImageLoadingGate.tsx` — migrate to context-based cache. Storage moves above `<SpacetimeProvider>`; URL-derivation stays below.
- `app/play/[code]/client.tsx` — wrap the play tree with `<ImageCacheProvider>` above `<SpacetimeProvider>`.

Modified (phase 3 — non-trivial refactor):
- `app/play/[code]/client.tsx` — wrap `<SpacetimeProvider>` in `<SpacetimeConnectionResetWrapper>`. Hoist any local UI state that must survive reset to the new wrapper layer (chat scroll, paragon drawer, user prefs).
- `app/play/hooks/useSpacetimeConnection.ts` — accept `epoch` from the reset wrapper context; pass through to the connection builder identity.
- `app/play/hooks/useGameState.ts` and `app/play/[code]/client.tsx` — migrate ~60 sites of direct `conn.reducers.<name>(...)` calls to `useTrackedReducers().<name>(...)`. Mass refactor; the implementation plan must scope this explicitly.
- **Spectator tree (`app/play/spectate/[code]/client.tsx`) is excluded from the tracked-reducers migration.** Spectators only call one reducer (`joinAsSpectator`), have no optimistic state to revert, and don't benefit from pending-call tracking. Spectators *do* get the rest of the connection-resilience treatment (detection, banner, reset wrapper) — those don't depend on `useTrackedReducers`.

## References

- [Firefox profile of the frozen tab](../../../prompt_context/Firefox%202026-05-06%2022.54%20profile.json)
- [SpacetimeDB issue #1936](https://github.com/clockworklabs/SpacetimeDB/issues/1936) — official acknowledgment that auto-reconnect is the consumer's responsibility
- [SpacetimeDB issue #4944](https://github.com/clockworklabs/SpacetimeDB/issues/4944) — known reconnect state-consistency caveats
- [SpacetimeDB SDK source: `db_connection_impl.ts`](../../../node_modules/spacetimedb/src/sdk/db_connection_impl.ts) — only `ws.onclose` propagation, no app-level liveness; `#reducerCallbacks` is the only path for reducer-success notification, exposed via the Promise returned from `conn.reducers.X(...)`
- [SpacetimeDB SDK source: `connection_manager.ts`](../../../node_modules/spacetimedb/src/sdk/connection_manager.ts) — refcounted connection ownership keyed by `URI::moduleName`, deferred cleanup via `setTimeout(0)`. Drives the rebuild constraint in section 3b.
- [Existing `register_presence` reducer](../../../spacetimedb/src/index.ts#L1537-L1562)
- [Existing `clientDisconnected` lifecycle](../../../spacetimedb/src/index.ts#L5531)
- [Existing OPP dot for opponent connection](../../../app/play/components/TurnIndicator.tsx#L295-L310)
- [websocket.org reconnection guide](https://websocket.org/guides/reconnection/) — exponential backoff w/ jitter pattern
- [SpacetimeDB issue #1936](https://github.com/clockworklabs/SpacetimeDB/issues/1936) — opt-in automated reconnect (still open)
- [SpacetimeDB PR #4631](https://github.com/clockworklabs/SpacetimeDB/pull/4631) — community PR adding `connection.reconnect()`, closed unmerged
- [Community `SpacetimeConnectionProvider`](https://github.com/SufyaanKhateeb/my-exness/blob/main/components/SpacetimeConnectionProvider.tsx) — **the canonical implementation our `SpacetimeConnectionResetWrapper` is based on.** Source of: the `idle ↔ restarting` two-phase state machine, the null-tick remount pattern, the `RECONNECT_COOLDOWN_MS = 2000` floor, the `onDisconnect → triggerReset` immediate reset, the `ReconnectOnResume` inner-component pattern, and the `ping` procedure approach.
- [SpacetimeDB Maincloud WS server config](https://github.com/clockworklabs/SpacetimeDB/blob/master/crates/client-api/src/routes/subscribe.rs) — 15s ping interval, 30s idle timeout. Source of the zombie-connection-formation timing.
- [Liveblocks WebSocket infrastructure](https://liveblocks.io/docs/platform/websocket-infrastructure) — comparable tiered UX
- [Phoenix Channels JS client](https://hexdocs.pm/phoenix/js/) — 30s heartbeat default
