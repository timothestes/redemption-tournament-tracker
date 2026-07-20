# WS-4 — Win Detection & Game-Over End States

**Status:** Design approved in substance (fork answered: auto-end at 5/7 rescued souls, no deck-out). Ready for plan.
**Source:** Workstream 4 of the multiplayer UX audit (PR #221). Covers audit items #18 (no game-rule win detection) and #19 (loser left on a live-looking board).
**Branch:** `feat/ws4-win-detection`.

## Goal

Detect a real Redemption win on the server and give **both** players a persistent victory/defeat screen — closing the product gap where a rescued-5th-soul win produced no payoff and the loser was stranded on a playable-looking board.

## The two problems, one shared fix

- **#18 Win detection:** the module never finishes a game on a rules win; `deriveEndReason` only knows `RESIGN`/`TIMEOUT`. We add server auto-detection + a `WIN` game action.
- **#19 Loser end-state:** the winner gets a persistent blocking modal; the loser gets only a 4-second toast, then a live-looking board. We make the game-over modal **symmetric** so the loser gets an equally persistent screen.

Both are solved by: server finishes the game + logs `WIN`; the client's winner-only modal becomes a two-sided VICTORY/DEFEAT modal.

## Rules

- Win threshold: **5** rescued Lost Souls for T1 and Paragon, **7** for T2. From existing `normalizeFormat(game.format)` (`'T1' | 'T2' | 'Paragon'`).
- Deck-out is **not** a win condition (per product owner) — out of scope.
- A rescued soul = a `CardInstance` with `isLostSoulRow(c) === true`, `zone === 'land-of-redemption'`, owned by the player (rescue transfers `ownerId` to the rescuer/receiver).
- Surrendering your own soul moves it to the **opponent's** LoR and counts toward **their** total — rules-correct, and handled naturally by checking both players.

## Server design (`spacetimedb/src/index.ts`) — logic-only, no schema change

No new table, no new reducer, no `WIN` column. `WIN` is a value of the existing `GameAction.actionType` string; `status:'finished'` uses the existing pattern. **Therefore no bindings regen — just an incremental module publish (no `--clear`).**

**New shared helper** (place near `logAction`/`isLostSoulRow`):

```typescript
// Rescue-win detection. A player wins by rescuing their Nth Lost Soul into
// land-of-redemption (5 for T1/Paragon, 7 for T2). Called after any movement
// of a soul into LoR. Idempotent: only fires while the game is still playing,
// and re-reads the Game row (callers may hold a stale snapshot).
function checkAndApplyWin(ctx: any, gameId: bigint) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game || game.status !== 'playing') return;
  const goal = normalizeFormat(game.format) === 'T2' ? 7 : 5;
  const rows = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
    let count = 0;
    for (const c of rows) {
      if (c.ownerId === player.id && c.zone === 'land-of-redemption' && isLostSoulRow(c)) count++;
    }
    if (count >= goal) {
      ctx.db.Game.id.update({ ...game, status: 'finished' });
      logAction(
        ctx, gameId, player.id, 'WIN',
        JSON.stringify({ winnerName: player.displayName, soulCount: count, format: normalizeFormat(game.format) }),
        game.turnNumber, game.currentPhase,
      );
      return;
    }
  }
}
```

**Call sites** (three, covering both kinds of path):

1. End of `moveLostSoulToLor` (~L5244) — covers all three rescue reducers (`rescue_lost_soul`, `surrender_lost_soul`, `surrender_soul`). `surrender_soul` continues after the primitive (battle auto-return + phase→discard); those spread the re-read Game row so `status:'finished'` is preserved, and the trailing `SET_PHASE` action is non-terminal so `deriveEndReason` still returns the `WIN`.
2. `move_card` (~after L3283 write), guarded `if (toZone === 'land-of-redemption')` — covers dragging a soul into LoR.
3. `move_cards_batch` (~after the L3848 loop), guarded by a `anyToLor` flag set when `cardFinalZone === 'land-of-redemption'` — covers batch drags.

Mirrors the `resign_game` pattern (`ctx.db.Game.id.update({ ...game, status: 'finished' })` + `logAction(..., 'WIN', ...)`), using the existing `logAction(ctx, gameId, playerId, actionType, payload, turnNumber, phase)` helper and the canonical `isLostSoulRow` predicate (`index.ts:2735`).

## Client design

### 1. `deriveEndReason` learns `WIN` (`GameOverOverlay.tsx:34-54`)

Add an `outcome` to the return and a `WIN` branch. The scan already walks `gameActions` newest-first; `WIN` joins `RESIGN`/`TIMEOUT` as terminal:

```typescript
function deriveEndReason(gameActions: any[], myPlayer: any):
  { label: string; winnerName: string; outcome: 'won' | 'lost' | 'ended' } {
  for (let i = gameActions.length - 1; i >= 0; i--) {
    const action = gameActions[i];
    const actionType: string = (action.actionType ?? '').toUpperCase();

    if (actionType === 'WIN') {
      const winnerId = action.playerId ?? action.actorId;
      const iWon = myPlayer?.id !== undefined && winnerId === myPlayer.id;
      return iWon
        ? { label: 'You won', winnerName: myPlayer?.displayName ?? 'You', outcome: 'won' }
        : { label: 'You lost', winnerName: '', outcome: 'lost' };
    }
    if (actionType === 'RESIGN') {
      const actorId = action.playerId ?? action.actorId;
      const iResigned = myPlayer?.id !== undefined && actorId === myPlayer.id;
      return iResigned
        ? { label: 'You resigned', winnerName: '', outcome: 'lost' }
        : { label: 'Opponent resigned', winnerName: myPlayer?.displayName ?? 'You', outcome: 'won' };
    }
    if (actionType === 'TIMEOUT') {
      return { label: 'Opponent disconnected', winnerName: myPlayer?.displayName ?? 'You', outcome: 'won' };
    }
  }
  return { label: 'Game ended', winnerName: '', outcome: 'ended' };
}
```

`client.tsx:1535` destructures `{ label, winnerName }` — still valid (extra field ignored).

### 2. Symmetric GameOverModal (`GameOverOverlay.tsx`)

Generalize the winner-only `OpponentLeftModal` into a persistent modal keyed on `outcome`:

- `outcome === 'won'` → "VICTORY" (existing look), message per reason (soul win vs concede vs disconnect).
- `outcome === 'lost'` → "DEFEAT", message ("Your opponent rescued enough souls." / "You resigned.").
- Show the blocking modal for **both** `won` and `lost` (this replaces the loser's toast-only path — the fix for #19). `ended` (unknown) keeps the existing 4s toast fallback.
- Keep the existing Play-Again vs Back-to-Lobby logic: rematch is offered whenever the opponent is still present (soul win/loss and resign); opponent-disconnect keeps Back-to-Lobby only.
- Persistent standing signal after dismiss is unchanged: `TurnIndicator` already shows the finished state (Play Again + scores) in the top bar.

Styling stays the current amber/inline system — migrating these bespoke dialogs to the design system is **WS-6**, deliberately not here.

### 3. Soul score filtered to Lost Souls

`client.tsx:1562-1563` (and the playing-state score props) count `land-of-redemption`.length, which includes any card dragged there. Filter to `isLostSoulRow` so the on-screen score can't read "5" without a real win. Reuse or add a small client-side Lost-Soul predicate; if `useGameState`'s `soulsRescued` (`useGameState.ts:371`) is the shared source, fix it there so player + spectator views agree.

## Out of scope (deferred)

- Deck-out detection (not a win condition).
- Manual "claim victory" (auto-detection covers the only win condition).
- Migrating game-over dialogs to the design system → **WS-6**.
- Spectator-view game-over polish (spectators still see `status:'finished'`; dedicated victory framing for spectators is a follow-up).

## Deploy & risk

- **Only irreversible step:** publishing the updated **dev** SpacetimeDB module (incremental, no `--clear`, no bindings regen). Everything else is worktree-local. Implement fully, then publish via the `spacetimedb-deploy` skill and verify live before touching prod. Prod publish must pair with a Vercel deploy (per prior module-deploy convention).
- Re-reading the Game row inside `checkAndApplyWin` avoids the stale-snapshot hazard flagged in `surrender_soul`.

## Verification

Driven with the `verify` skill (mint `sb-` cookies, 2-player Playwright; host `baboonytim@gmail.com`, joiner `landofredemption@gmail.com`).

Success criteria:
- Rescue the Nth Lost Soul (5 in a T1 game) → the game ends automatically; the **rescuer** sees VICTORY and the **opponent** sees DEFEAT, both persistent (no live-looking board).
- Surrendering your own soul to the opponent's LoR can trigger the **opponent's** win.
- Resign still works and now shows the loser a persistent DEFEAT modal (not a 4s toast).
- The on-screen soul score matches the rescued-Lost-Soul count.
- `tsc --noEmit` clean for changed client files; module type-checks/publishes.
