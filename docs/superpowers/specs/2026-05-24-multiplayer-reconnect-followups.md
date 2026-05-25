# Multiplayer Reconnect — Known Limitations & Follow-ups

**Status:** Deferred. The first-pass fix shipped 2026-05-24 to stop users from being permanently kicked on a single transient WS drop. This doc tracks what *wasn't* fixed and how to address it next time.

**Trigger to revisit this doc:** If users report any of:
- Cave loading screen flashing repeatedly during gameplay (during a brief network blip, not on initial entry)
- Lost undo stack / chat history / hand state after a reconnect that "succeeded"
- Sluggish UI or extra reconnects after navigating from `/play` lobby into a game
- Persistent "Connection lost" screen even when network appears fine
- No visible feedback when their WS dies (game looks fine but reducer calls fail silently)

## Background — what shipped

See git log around 2026-05-24 for the commit. Files touched:
- [app/play/hooks/useSpacetimeConnection.ts](../../../app/play/hooks/useSpacetimeConnection.ts) — became a builder *factory* (`createBuilder`) that re-reads the JWT each call; still tracks `isConnected` via its own `onDisconnect`.
- [app/play/components/SpacetimeConnectionResetWrapper.tsx](../../../app/play/components/SpacetimeConnectionResetWrapper.tsx) — replaced cooldown-skip with exponential-backoff scheduler (`[0, 500, 1k, 2k, 4k, 8k, 15k, 30k]ms`, MAX_ATTEMPTS=8). Owns retry orchestration. Inline `FatalConnectionScreen` (Try again / Back to lobby) appears after `gaveUp`.
- [app/play/[code]/client.tsx](../../../app/play/[code]/client.tsx) — removed the fatal `if (error)` early-return that was tearing down the wrapper on first failure.
- [app/play/spectate/[code]/client.tsx](../../../app/play/spectate/[code]/client.tsx) — wrapped (was using bare `SpacetimeProvider` with the same fatal-screen bug).
- [app/play/components/ReconnectOnResume.tsx](../../../app/play/components/ReconnectOnResume.tsx) — `gaveUp` guard to stop background retry loops.

The wrapper exposes via `useConnectionReset()`: `triggerReset`, `connectionHealth` ('live' | 'dropped' | 'down'), `gaveUp`, `manualRetry`.

## Deferred issue #1 (BIG) — every retry remounts the entire game subtree

**What's wrong.** The wrapper triggers a retry by bumping `providerInstanceId` → React unmounts `SpacetimeProvider` → the entire `GameInner` subtree unmounts → setTimeout(0) lets SDK cleanup run → React remounts with new key → fresh `retain()` → `build()` creates new connection.

**Impact during a real outage:**
- A 5-second blip with backoff `[0, 500, 1000, 2000, 4000]` cycles the cave loading screen four times.
- A 60-second outage hitting `MAX_ATTEMPTS` wipes: undo stack ([app/play/hooks/useUndoStack.ts](../../../app/play/hooks/useUndoStack.ts)), unread chat count, hoisted image preload cache (the hoist in `client.tsx` deliberately survives `MultiplayerCanvas` remounts — but it doesn't survive a `GameInner` remount), ceremony progress, hotkey state, all `didSubscribe`/`didCallReducer` refs, and re-fires `createGame`/`joinGame` reducers (the `existingGame` reconnect branch at [client.tsx:508-521](../../../app/play/[code]/client.tsx) is the only thing saving us from duplicate-game errors).
- No "Reconnecting…" overlay is shown during retry — the children that the overlay would sit on top of are themselves unmounted. The user sees the cave loading screen, not a status message.

**Why the architecture forces this.** The SDK's `ConnectionManager` (see [spacetimedb/node_modules/spacetimedb/src/sdk/connection_manager.ts](../../../spacetimedb/node_modules/spacetimedb/src/sdk/connection_manager.ts) lines 128-130) cache-hits by `${uri}::${dbName}` and returns the existing connection without calling `builder.build()`. To force a fresh build (necessary for a fresh JWT), the only mechanism currently available is to fully release the connection (refcount → 0, pendingRelease fires) and re-retain — which requires unmounting the React provider. There's no public SDK API to swap the connection in place or re-register handlers on an existing connection (`onConnect`/`onDisconnect`/`onConnectError` are `private` on `DbConnectionImpl`).

**Approaches to consider for a real fix:**

1. **Lift session state above `SpacetimeProvider`.** Move undo stack, chat unread count, image preload cache, etc. up to `GameClient` (outside the wrapper) so they survive provider remounts. Pros: doesn't touch the SDK. Cons: significant refactor — the wrapper's children currently own all that state, and many of them depend on `useSpacetimeDB()` which requires being inside the provider.

2. **Render a "Reconnecting…" overlay outside the wrapped subtree.** The wrapper can render the overlay as a sibling of `<SpacetimeProvider>{children}</SpacetimeProvider>`. Currently the wrapper renders `{isProviderMounted && <SpacetimeProvider>}` — flip that to always render the overlay above. Doesn't fix session-state loss, but at least gives the user a non-blocking status indication.

3. **Vendored SDK patch.** Expose `connection.attachHandlers({ onConnect, onDisconnect, onConnectError })` so the wrapper can re-attach without rebuilding. Then on retry, the wrapper would: (a) call `connection.disconnect()` to force a clean close, (b) wait briefly, (c) trigger the SDK's internal `start()` path — except the SDK doesn't expose a public reconnect-this-connection method either. Likely requires patches to both `db_connection_impl.ts` and `connection_manager.ts`. Significant work; would need to be maintained across SDK upgrades.

4. **Wait for upstream SDK to expose reconnect primitives.** The SpacetimeDB team has acknowledged this is a gap; check whether the SDK has gained a `connection.reconnect()` or equivalent since 2026-05.

**Recommendation if revisiting:** Start with approach 2 (overlay) — it's small and addresses the worst part of the UX (silent broken state). Then approach 1 (lift state) for the session-preservation problem. Avoid approach 3 unless 1 and 2 prove insufficient.

## Deferred issue #2 — `manualRetry` causes a single-frame blank flash

[SpacetimeConnectionResetWrapper.tsx:147-152](../../../app/play/components/SpacetimeConnectionResetWrapper.tsx)

When the user clicks "Try again" on `FatalConnectionScreen`:
1. `setGaveUp(false)` clears the fatal screen
2. `performReset()` sets `resetPhase='restarting'` → wrapper renders `null` for children
3. Result: 1 frame where both fatal screen AND children are gone → user sees background.

**Fix sketch.** Keep the fatal screen visible (with the buttons replaced by a spinner/"Reconnecting…" text) while `resetPhase==='restarting'` even if `gaveUp` was just cleared. Track a brief `isManualRetryInFlight` ref/state.

## Deferred issue #3 — no local "you're disconnected" indicator

The existing `ConnectionStatus` ([app/play/components/ConnectionStatus.tsx](../../../app/play/components/ConnectionStatus.tsx)) and the dot in `TurnIndicator.tsx:299-306` show the **opponent's** state, derived from server-pushed table data. During a local WS drop, the local player sees no indicator that their own connection is dead — they'll drag cards and click reducers that silently fail (or throw `SenderError` that surfaces as Next.js error overlay if not caught).

**Fix sketch.** Plumb `useConnectionReset().connectionHealth` into a small status badge somewhere in the toolbar / TurnIndicator area. Show a yellow "Reconnecting" dot when `connectionHealth !== 'live'` and `!gaveUp`. Pairs naturally with issue #1 approach 2 (the overlay).

## Deferred issue #4 — `FatalConnectionScreen` lacks a11y polish

[SpacetimeConnectionResetWrapper.tsx](../../../app/play/components/SpacetimeConnectionResetWrapper.tsx) — the inline component.

- No `role="alertdialog"` / `aria-modal="true"` / `aria-labelledby`.
- No focus trap — Tab can escape to background content.
- No autofocus on "Try again".

**Fix sketch.** Add a `<dialog>` element with `useEffect` to call `.showModal()`, or use Radix UI's Dialog primitive (already a dep via shadcn). Trivial when revisited.

## Deferred issue #5 — `<a href="/play">` doesn't clear stale session storage

The "Back to lobby" link in `FatalConnectionScreen` is a plain `<a>`. It works, but doesn't clear `sessionStorage[stdb_game_params_${code}]`. If the user immediately rejoins, the stale params get reused. Not currently observed as a bug (the lobby's join flow re-validates), but worth cleaning.

**Fix sketch.** Replace with a `<button onClick>` that clears sessionStorage then calls `router.push('/play')`.

## Deferred issue #6 — dead `connError` branch in GameLobby

[app/play/components/GameLobby.tsx:505-509](../../../app/play/components/GameLobby.tsx) renders a connection-error message based on `connError` from the hook. After the 2026-05-24 refactor, the hook returns `error: null` as a no-op shim, so `connError` is always falsy and the branch is unreachable. Either delete the branch or wire it to a real source (the lobby has no wrapper, so it can't read `connectionHealth` from context).

## Deferred issue #7 — spectator route has no `ReconnectOnResume`

[app/play/spectate/[code]/client.tsx](../../../app/play/spectate/[code]/client.tsx) uses the wrapper (so transient drops self-heal) but lacks the visibility-resume ping in [ReconnectOnResume.tsx](../../../app/play/components/ReconnectOnResume.tsx). A spectator who tabs away for >30 seconds and comes back may have a zombie WS.

Spectator mode is currently disabled at the route level (check the file for comments). When re-enabled, add `<ReconnectOnResume />` next to `<SpectatorInner>`.

## Deferred issue #8 — SDK doesn't expose WebSocket close codes

The wrapper's `onConnectError` log captures only `err.message`, `err.name`, and `attempt`. The actual WebSocket close `code`/`reason` are discarded by the SDK in its `onclose` handler ([spacetimedb/node_modules/spacetimedb/src/sdk/db_connection_impl.ts](../../../spacetimedb/node_modules/spacetimedb/src/sdk/db_connection_impl.ts)) before being emitted as `'disconnect'` or `'connectError'`. So when this reconnect issue recurs and users send us logs, we can't distinguish "auth failed (1008)" vs "policy violation (1008)" vs "abnormal closure (1006)" vs "going away (1001)".

**Fix sketch.** Vendored SDK patch — modify the `onclose`/`onerror` handlers in `db_connection_impl.ts` to forward the `CloseEvent.code` and `.reason` (or `ErrorEvent` details) as additional args on the emitter. Then update the structural type in `SpacetimeConnectionResetWrapper.tsx`'s `ConnectionBuilder` type to accept the new signature.

Risk: maintaining a patch across SDK upgrades. Alternative: file an upstream issue/PR with the SpacetimeDB team.

## Deferred issue #9 — token refresh under 60s JWT lifetime

The fix re-reads the JWT from localStorage on every retry, picking up whatever the server wrote on the last successful `onConnect`. **But** if the user's connection has been dead longer than the JWT lifetime (60s observed in maincloud's tokens), the cached token is itself expired and the retry will fail. We'll gracefully escalate to `gaveUp` after ~60s of failures, but the user genuinely can't reconnect until they reload the page (which re-mints a token from Supabase auth).

**Fix sketch.** Before each retry, call a token-refresh endpoint that uses the user's Supabase session to mint a fresh SpacetimeDB JWT. Requires:
1. A server-side route (e.g. `/api/spacetimedb-token`) that takes the Supabase session and returns a fresh JWT (signed by whatever key SpacetimeDB accepts).
2. The wrapper's retry path awaits the new token before calling `createBuilder()`.
3. Investigate whether the 60s lifetime is intentional on maincloud's side — may be configurable per-database.

This is the closest thing to a "real" root-cause fix. The current code's escalation-after-failures is a workaround.

## Code pointers (for the next agent)

If you're picking this up:

1. Read the original investigation in git log around 2026-05-24 — both the conversation transcript (if available) and the commits/PRs.
2. Read [spacetimedb/node_modules/spacetimedb/src/sdk/connection_manager.ts](../../../spacetimedb/node_modules/spacetimedb/src/sdk/connection_manager.ts) before touching the wrapper — the refcount + pendingRelease + cache-by-key semantics constrain what's possible.
3. Read [spacetimedb/CLAUDE.md](../../../spacetimedb/CLAUDE.md) — SDK gotchas, especially around `withToken` capture and EventEmitter Set-dedup behavior.
4. The original planning + review trail used parallel agents: two Plan agents for design, one synthesizing reviewer, two reviewers (general-purpose) after implementation. The reviewers caught both the cached-connection bug (`ConnectionManager.retain` cache-hits silently discarding the wrapper's builder) and the dead diagnostic-log fields. Worth running them again on any architectural change here.
5. Verify any changes against a real reconnect: kill devtools network briefly during a game; verify backoff fires, "Try again" works, no permanent kick.
