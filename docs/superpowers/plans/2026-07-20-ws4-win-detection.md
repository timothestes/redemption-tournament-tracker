# WS-4 Win Detection & Game-Over End States — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Auto-detect a rescue win (5 souls T1/Paragon, 7 T2) on the server and give both players a persistent VICTORY/DEFEAT screen. Per `docs/superpowers/specs/2026-07-20-ws4-win-detection-design.md`.

**Architecture:** Logic-only SpacetimeDB change (new `checkAndApplyWin` helper at three soul→LoR choke points; `WIN` is a value of the existing `GameAction.actionType` string — no schema change, no bindings regen). Client teaches `deriveEndReason` about `WIN` and makes the game-over modal symmetric.

**Tech Stack:** SpacetimeDB TS module, Next.js/React client. Verify with `tsc --noEmit` + live 2-player Playwright.

## Global Constraints

- Threshold: `normalizeFormat(game.format) === 'T2' ? 7 : 5` (5 for T1 **and** Paragon).
- Rescued soul = `isLostSoulRow(c) && c.zone === 'land-of-redemption' && c.ownerId === player.id`.
- `WIN` action logged via existing `logAction(ctx, gameId, playerId, actionType, payload, turnNumber, phase)`.
- `checkAndApplyWin` re-reads the Game row and only fires while `status === 'playing'` (idempotent; callers may hold a stale snapshot).
- No schema change → **no `spacetime generate`**; the module still needs an incremental **publish** (no `--clear`) for the new logic to run.
- Keep the amber dialog styling (design-system migration is WS-6).
- Stage only named files; never `git add -A`.

---

### Task 1: Server — `checkAndApplyWin` helper + three call sites

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Define the helper** (immediately after `isLostSoulRow`, which ends at L2737)

```typescript
// Rescue-win detection. A player wins by rescuing their Nth Lost Soul into
// land-of-redemption (5 for T1/Paragon, 7 for T2). Called after any movement
// of a soul into LoR. Idempotent: fires only while the game is still playing,
// and re-reads the Game row because callers may hold a stale snapshot.
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

- [ ] **Step 2: Call site A — `moveLostSoulToLor`** (covers all three rescue reducers). Insert as the last statement before the function's closing `}` (after the `triggeredRefill` block at ~L5243):

```typescript
  if (triggeredRefill) {
    refillSoulDeck(ctx, gameId);
  }

  checkAndApplyWin(ctx, gameId);
}
```

- [ ] **Step 3: Call site B — `move_card`** (drag into LoR). After the `triggeredRefill` block at the end of the reducer (~L3396), before the reducer's closing `}`:

```typescript
    if (triggeredRefill) {
      refillSoulDeck(ctx, game.id);
    }

    if (toZone === 'land-of-redemption') {
      checkAndApplyWin(ctx, gameId);
    }
  }
);
```

- [ ] **Step 4: Call site C — `move_cards_batch`** (batch drag into LoR). Inside the per-card write loop, right after the `ctx.db.CardInstance.id.update({...})` that ends at ~L3861:

```typescript
      ctx.db.CardInstance.id.update({
        ...card,
        zone: cardFinalZone,
        // …unchanged…
      });
      if (cardFinalZone === 'land-of-redemption') {
        checkAndApplyWin(ctx, gameId);
      }
    }
```

`checkAndApplyWin` is idempotent, so calling it per LoR-bound card in the loop is safe (later iterations no-op once finished).

- [ ] **Step 5: Type-check the module**

Run: `cd /Users/timestes/projects/rtt-ws4-win-detection/spacetimedb && npx tsc --noEmit`
Expected: clean (or only pre-existing errors unrelated to these edits).

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-ws4-win-detection
git add spacetimedb/src/index.ts
git commit -m "feat(mp-server): auto-finish on rescue win (5/7 souls) + WIN action

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

*(Module is NOT published yet — that is the gated deploy step, Task 4.)*

---

### Task 2: Client — `deriveEndReason` learns `WIN` + symmetric game-over modal

**Files:**
- Modify: `app/play/components/GameOverOverlay.tsx`

- [ ] **Step 1: Extend `deriveEndReason`** (L34-54) to add `outcome` and a `WIN` branch:

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

- [ ] **Step 2: Drive the modal off `outcome`.** In the component, replace the `isOpponentLeft`-only gating so the persistent blocking modal shows for every real result. Compute:

```typescript
  const { label, winnerName, outcome } = deriveEndReason(gameActions, myPlayer);
  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';
  const mySeat = myPlayer?.seat?.toString() ?? '0';
  const didWin = outcome === 'won';
  const didLose = outcome === 'lost';
  const showResultModal = didWin || didLose; // both sides get a persistent screen
  const isOpponentDisconnected = label === 'Opponent disconnected';
```

- [ ] **Step 3: Render a symmetric `GameOverModal`.** Replace the `{isOpponentLeft && !modalDismissed && (<OpponentLeftModal .../>) }` block with:

```tsx
      {showResultModal && !modalDismissed && (
        <GameOverModal
          didWin={didWin}
          label={label}
          oppName={oppName}
          canRematch={!isOpponentDisconnected}
          isLoupeVisible={isLoupeVisible}
          onPlayAgain={() => {
            setModalDismissed(true);
            if (isForge) { void handleForgeRematch('request'); }
            else { setPickerMode('request'); setPickerOpen(true); }
          }}
          onDismiss={() => setModalDismissed(true)}
        />
      )}
```

And gate the fallback toast to the unknown case only: change `{!isOpponentLeft && toastVisible && (…)}` to `{outcome === 'ended' && toastVisible && (…)}`, and the auto-dismiss effect guard from `if (isOpponentLeft) return;` to `if (outcome !== 'ended') return;`.

- [ ] **Step 4: Generalize `OpponentLeftModal` → `GameOverModal`.** Rename it and re-key its copy on `didWin` (keep the amber styling and the keyboard-nav hook):
  - Eyebrow: `didWin ? 'Victory' : 'Defeat'`.
  - Title: `didWin ? (label === 'Opponent resigned' ? \`${oppName} Conceded\` : 'You Won') : 'You Lost'`.
  - Subtitle: win → "Your opponent has surrendered." / "You rescued enough souls." ; loss → "Your opponent rescued enough souls." / "You resigned." (pick by `label`).
  - Actions: when `canRematch`, show **Play Again** + **Dismiss** (as today); when `!canRematch` (opponent disconnected), show **Back to Lobby** wired to `onDismiss` semantics is not enough — keep the existing behavior where disconnect routes through `onDismiss`/lobby. For this WS, opponent-disconnect keeps the current Play-Again-hidden behavior in `TurnIndicator`; the modal shows **Dismiss** only.

- [ ] **Step 5: Type-check**

Run: `cd /Users/timestes/projects/rtt-ws4-win-detection && npx tsc --noEmit 2>&1 | grep GameOverOverlay || echo "clean"`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-ws4-win-detection
git add app/play/components/GameOverOverlay.tsx
git commit -m "feat(mp-client): symmetric VICTORY/DEFEAT game-over modal + WIN reason

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Client — soul score filtered to Lost Souls

**Files:**
- Modify: `app/play/hooks/useGameState.ts` (both `soulsRescued` computations, L372 + L1208)
- Modify: `app/play/[code]/client.tsx` (5 score prop pairs)

- [ ] **Step 1: Filter `soulsRescued` in `useGameState`.** In each of the two `soulsRescued` `useMemo`s, filter the LoR arrays before counting. Add a local predicate and apply it:

```typescript
    const isLS = (c: any) =>
      c.cardType === 'LS' || c.cardType === 'TOKEN_LS' || (c.cardName ?? '').toLowerCase().includes('lost soul');
    const myLor = (myCards['land-of-redemption'] ?? []).filter(isLS);
    const oppLor = (opponentCards['land-of-redemption'] ?? []).filter(isLS);
```

(Replace the existing `const myLor = myCards['land-of-redemption'] ?? [];` / `oppLor` lines in both memos; the rest of each memo that reads `myLor.length` / `oppLor.length` is unchanged.)

- [ ] **Step 2: Route the displayed score through the filtered value.** In `client.tsx`, replace all five pairs:

```
myScore={gameState.myCards['land-of-redemption']?.length ?? 0}
opponentScore={gameState.opponentCards['land-of-redemption']?.length ?? 0}
```
with
```
myScore={gameState.soulsRescued.me}
opponentScore={gameState.soulsRescued.opponent}
```

(Two `replace_all` edits — the pairs are byte-identical across all five call sites.)

- [ ] **Step 3: Type-check**

Run: `cd /Users/timestes/projects/rtt-ws4-win-detection && npx tsc --noEmit 2>&1 | grep -E "useGameState|client\.tsx" || echo "clean"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/timestes/projects/rtt-ws4-win-detection
git add app/play/hooks/useGameState.ts "app/play/[code]/client.tsx"
git commit -m "fix(mp-client): count only Lost Souls toward the rescued-souls score

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Deploy dev module + live verification  — **GATED on user confirmation**

- [ ] **Step 1: Confirm with the user** before publishing (module publish affects live dev game state).
- [ ] **Step 2: Publish** the dev module via the `spacetimedb-deploy` skill (incremental publish, **no** `--clear`, **no** `generate` — no schema change). Watch for the known post-publish index panic (`reference_stdb_clear_republish_index_panic`); if it appears, escalate before forcing a `--clear`.
- [ ] **Step 3: Live verify** with the `verify` skill (2-player): rescue the 5th soul in a T1 game → both players get VICTORY / DEFEAT; resign shows the loser a persistent DEFEAT modal; the soul score matches.
- [ ] **Step 4: Prod** — separate, pair the module publish with a Vercel deploy; do only after dev verification and user go-ahead.

---

## Self-review

- **Spec coverage:** #18 win detection → Task 1; symmetric end-state (#19) → Task 2; score filter → Task 3; deploy → Task 4. All spec sections mapped.
- **Placeholders:** none — real code throughout.
- **Type consistency:** `checkAndApplyWin(ctx, gameId)`, `deriveEndReason` returns `{label, winnerName, outcome}`, `GameOverModal` prop names (`didWin`, `canRematch`) consistent across Tasks; `gameState.soulsRescued.{me,opponent}` matches the hook's exposed shape (`useGameState.ts:68,960`).
