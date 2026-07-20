# WS-3 — Waiting Room → Pre-Game Ceremony

**Status:** Design approved in substance (forks answered: click-to-skip ceremony, brief opponent-joined toast, delete the dead `pregame_ready` reducer too). Ready for plan.
**Source:** Workstream 3 of the multiplayer UX audit (PR #221). Audit §3 + §5.
**Branch:** `feat/ws3-waiting-ceremony`.

## Goal

Fix the waiting→ceremony experience: remove the unreachable "Ready up" dead code (and its fake "Ready" caption), soften the abrupt yank out of practice with an "opponent joined" beat, let players skip the roll animation, and make the "Change deck" link discoverable.

## Scope — six changes

Files: `app/play/components/PregameScreen.tsx`, `app/play/[code]/client.tsx`, `app/play/hooks/useGameState.ts`, `spacetimedb/src/index.ts`, `spacetimedb/src/schema.ts`, regenerated `lib/spacetimedb/module_bindings/`.

### 1. Delete the dead ready-up / `deck_select` UI  (client)

`join_game` sets `pregamePhase:'rolling'` immediately, so `'deck_select'` is never assigned — the whole ready-up path is unreachable. Remove from `PregameScreen.tsx`:
- `isDeckSelect` const (L375) and every `isDeckSelect && …` block: deck-name (L408-412), the Ready button block (L427-456), opponent status (L473-477, L492-498).
- The `phase === 'deck_select'` action-area branch (L190-199) and the `SpectatorPregameView` deck_select sub-blocks (L1281, L1287-1298).
- `handleToggleReady` (L371-373).
- The `myReady` / `opponentReady` / `canReady` plumbing **only** where it fed the dead UI: PlayerCards props/uses at L192, L294/L296, L312/L314, L322, L430, L443, L446-448, L453; the `canReady` prop chain. Keep `game.pregameReady0/1` reads that the **ceremony** uses (L722-723, L879, L1011, and client.tsx L1171) — those fields are reused for roll/reveal ack.
- **`canReady` cleanup in client.tsx:** the separate deck-preload gate that only fed the ready button — `myDeckImagesPreloaded` / `deckPreloadFallback` / `canReady` (L484-498) and the `canReady={canReady}` prop (L1369). Remove; the board-level `imagesGateOpen` (client.tsx L461-482, blocking `ImageLoadingGate` at L1512/L1810) remains the real preload protection.

### 2. Kill the fake "Ready" caption  (client)

Remove the static `<p>Ready</p>` in the `isWaiting` block (`PregameScreen.tsx` L393-396) — it implies a readiness the player never set.

### 3. "Opponent joined" beat  (client)

The host is short-circuited out of practice into an already-resolved roll with no announcement (client.tsx: `isCeremonyPhase` becomes true when the server sets `pregamePhase:'rolling'`). Add a brief, auto-dismissing toast shown to the player who was **waiting** (the host) when the ceremony first starts: e.g. "⚔️ {opponentName} joined — rolling for first player…", ~2.5s.
- Implementation: in client.tsx, track the previous lifecycle with a ref; when we enter `isCeremonyPhase` and the prior lifecycle was `'waiting'`, set a transient `justJoinedToast` state (opponent name) that auto-clears. Render it as an absolutely-positioned toast inside the `if (isCeremonyPhase)` branch (near `PregameCeremonyOverlay`, L1456). The joiner (prior lifecycle `'joining'`) does not get it — they initiated the join.

### 4. Click-to-skip the roll ceremony  (client)

The roll result is server-authoritative (`rollResult0/1`, `rollWinner`); the tumble is a pure client animation. A skip races the local view to the known outcome and triggers the pending auto-ack early — no cross-player sync. The `skipAnimation`/`diceSkipped` plumbing already exists end-to-end (PlayerCards → InlineDie → RitualDie) but is never triggered.

Lift a `skipped` boolean into `PregameCeremonyOverlay` (`PregameScreen.tsx` L702) and thread it + `onSkip` to the three children:
- **PlayerCards** — on `skipped`, `setDiceSkipped(true)` + `setDiceRevealed(true)` (dice land instantly). (Currently `setDiceSkipped` is never called; wire the prop to it.)
- **RollAndChooseArea** — on `skipped`, `setShowResults(true)` immediately (winner announcement + choose buttons + timer bar appear now, cancelling the 1900ms `RITUAL_TUMBLE_MS+700` wait at L886-890); and if the loser is still un-acked in `'rolling'`, call `pregameAcknowledgeRoll()` immediately instead of the 3400ms timer (L898-905). Choosing stays a real decision — skip only reveals the buttons; it never auto-picks.
- **RevealArea** — on `skipped`, call `pregameAcknowledgeFirst()` immediately instead of the 1500ms timer (L1034-1040).

Render a small "Skip ▸" button in the overlay card when `!skipped && (phase === 'rolling' || phase === 'revealing')`. Once clicked (or once the interactive choose buttons are up), hide it. Server-anchored countdown/deadline logic is untouched.

### 5. "Change deck" link discoverability  (client)

The waiting-block link (`PregameScreen.tsx` L396-402) is `text-[10px] text-amber-200/40` — easy to miss. Replace with a small, legible control (an outline/ghost button, `ArrowLeftRight` icon + "Change deck", readable size/contrast), matching the WS-1 verb. This is the only reachable copy after §1 deletes the duplicate.

### 6. Joiner "connected — waiting" copy  (client)

The joiner sees a generic flavor spinner (client.tsx L1133-1160) with a 12s silent-failure timeout. Light touch: once `isConnected` is true while `lifecycle==='joining'`, show a clearer, honest line ("Connected — starting game…") instead of the rotating flavor text, so the joiner sees they're through. No timeout/logic change.

### 7. Delete the dead `pregame_ready` reducer  (server + bindings + client wrapper)

Unreachable (its body is gated on `pregamePhase === 'deck_select'`, L965, which never holds).
- `spacetimedb/src/index.ts`: delete the whole `pregame_ready` reducer (L954-1059). **Keep** `pregameReady0/1` Game fields (reused by `pregame_acknowledge_roll` etc.).
- `spacetimedb/src/schema.ts` L30: drop `deck_select` from the `pregamePhase` comment (→ `"" | "rolling" | "choosing" | "revealing"`).
- `app/play/hooks/useGameState.ts`: remove the `pregameReady` wrapper — interface decl (L140), impl (L776-778), return exposure (L1015), disconnected fallback (L1325).
- Regenerate bindings with `spacetime generate` (removes `pregame_ready_reducer.ts` and its refs in `module_bindings/index.ts` L83/L451 and `types/reducers.ts` L55/L152). Do **not** hand-edit generated files.

## Approach & sequencing

Frontend items (§1-6) land first, entirely in the worktree. The server deletion (§7) is a coordinated server-delete → `spacetime generate` → client-wrapper-delete → **module publish**. Build everything in the worktree; **pause before the dev-module publish** for go-ahead (as WS-4 did). Bindings *do* change this time (a reducer is removed), so `spacetime generate` is required and its diff is committed.

## Out of scope
- Unifying lobbies / design-system dialog migration → WS-6.
- Rematch flow (run-it-back, cancel pending) → WS-5.
- Debug artifacts → kept per user.

## Verification
Driven with the `verify` skill (2-player Playwright, `baboonytim` host + `landofredemption` joiner, both Type 1):
- Waiting room shows **no** "Ready" caption and a clearly-visible "Change deck" control; no ready-up button.
- Host practicing → opponent joins → a brief "{opponent} joined" toast appears, then the roll ceremony.
- Clicking "Skip" during the roll lands the dice instantly and advances (loser acks / winner sees choose buttons now); the reveal can be skipped too. Choosing still requires a real click.
- Joiner sees "Connected — starting game…" once through.
- Module publishes clean (bindings regen diff = the removed `pregame_ready` files); `tsc --noEmit` clean; a full 2-player roll→play still works end-to-end.
