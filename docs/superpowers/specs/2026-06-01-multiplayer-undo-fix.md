# Multiplayer UNDO Fix — Consolidated Implementation Spec

- **Date:** 2026-06-01
- **Status:** Ready for implementation
- **Scope:** Client-side only (Next.js 15 / React 19 / SpacetimeDB). No server / reducer / schema changes.

---

## Problem statement

The multiplayer client-side undo stack reverses an action by re-dispatching a SpacetimeDB reducer, but reducer calls are **fire-and-forget** (`conn?.reducers.moveCard(...)` — no `await`, no throw; verified `useGameState.ts:389–402`). When the targeted card has since moved or been deleted, the reverse silently clobbers live state or no-ops: the server rejects it asynchronously via `SenderError`, which is dropped client-side, so the user sees a misleading "Undo: …" toast and possibly a corrupted board. Undo is also not turn-gated and the stack is cleared on the wrong signal (`turnNumber` change rather than the local player's turn ending).

---

## Scope & non-goals

**In scope:** unified undo contract; a client-side live-state guard that refuses unsafe reverses *before* dispatch; turn-gating undo; correct turn-end / lifecycle clearing; toast wording; extraction of pure logic for unit testing.

**Non-goals / explicitly dropped:**
- **No server changes.** We cannot make reducers throw synchronously or confirm success; "success" means *dispatched without a client-side guard refusal*, never server-confirmed.
- **Exact `zoneIndex` / deck-order restoration is dropped** (out of scope, intentional). Reverse leaves `zoneIndex` undefined; the card returns to the zone, not its prior slot.
- **Best-effort lossy restore is accepted.** Reverse restores **zone + ownerId only**. Side effects of leaving play (counters, notes, meek flag wiped; a warrior dropping its weapons) are **not** restored. This is intentional; do not attempt to rebuild them.
- Position (`posX`/`posY`) is still *passed through* to the reverse reducer as a courtesy (existing behavior) but is **not** part of the safety guard.

---

## The unified undo contract (centerpiece)

This resolves the Section 1 (try/catch + discriminated union) vs Section 2 (boolean guard + `string | null`) conflict. The two are **not** alternatives — they are **two layers** of one contract: the guard decides *applied vs refused* before dispatch; the try/catch is *defense-in-depth* around dispatch. `undo()` collapses all four possible outcomes into one richer result type that both the toast caller and the tests consume.

### Types (`useUndoStack.ts`)

```ts
/** A reverse closure returns whether it actually dispatched a reducer.
 *  true  = guard passed, reverse was applied (dispatched).
 *  false = guard refused (card moved/deleted since); nothing dispatched. */
export interface UndoEntry {
  description: string;
  reverseAction: () => boolean;
}

export type UndoResult =
  | { status: 'applied'; description: string }   // guard passed, reverse dispatched
  | { status: 'refused'; description: string }   // guard refused (stale/deleted target)
  | { status: 'empty' }                          // stack was empty
  | { status: 'threw';  description: string; error: unknown }; // unexpected throw

export interface UndoStack {
  count: number;
  push: (entry: UndoEntry) => void;
  undo: () => UndoResult;
  clear: () => void;
}
```

### `undo()` semantics (resolved)

`undo()` **peeks** the top entry, runs `reverseAction()` inside `try/catch`, and resolves to exactly one `UndoResult`:

| Outcome of `reverseAction()`       | `UndoResult`                 | Pop the entry? |
|------------------------------------|------------------------------|----------------|
| returns `true`                     | `applied`                    | **yes**        |
| returns `false`                    | `refused`                    | **yes (consume)** |
| throws                             | `threw`                      | **yes (consume)** |
| stack empty (nothing to peek)      | `empty`                      | n/a            |

**Consume-vs-keep ruling: CONSUME on every non-empty outcome** (Section 2 / Test OQ-2 win over Section 1's "keep on failure"). Rationale: keeping a refused/threw entry means the next Ctrl+Z retries the *same* stale reverse forever — the target only gets more stale, never less. The whole point of the guard is that this action is no longer safely reversible; the user should fall through to the *previous* entry. Tests assert the stack shrinks by one on `applied`, `refused`, and `threw` alike.

### Capture shape (resolved — Section 2 finding, verified)

Verified against `MultiplayerCanvas.tsx:341–420, 1082–1262`: every push site currently captures the **pre-forward** zone (`card.zone`, i.e. `fromZone`) and both *restores to it* and would compare against it. That is wrong for the guard — at undo time we must ask **"is the card still where my forward action *put* it?"**, i.e. compare live zone against the **post-forward `toZone`**, then restore to `fromZone`. So every undoable push site must capture both ends:

```ts
interface Captured {
  cardId: string;
  fromZone: string;     // restore target (pre-forward)
  prevOwnerId: string;  // restore target owner (pre-forward)
  posX?: string;        // courtesy restore, not guarded
  posY?: string;        // courtesy restore, not guarded
  expectedZone: string;    // == forward toZone — guard compares live zone to THIS
  expectedOwnerId: string; // == owner the card has AFTER the forward move
}
```

The guard is pure:

```ts
// reverseIsSafe(captured, current): the card still exists AND is still where we left it.
export function reverseIsSafe(
  captured: Pick<Captured, 'expectedZone' | 'expectedOwnerId'>,
  current: { zone: string; ownerId: string } | undefined,
): boolean {
  if (!current) return false;                       // deleted token → refuse
  return current.zone === captured.expectedZone
      && current.ownerId === captured.expectedOwnerId;
}
```

```ts
// makeReverseAction binds the guard to a live lookup + the move dispatcher.
// Returns the boolean reverseAction the stack stores.
export function makeReverseAction(args: {
  captured: Captured;
  lookup: (id: string) => { zone: string; ownerId: string } | undefined;
  move: (id: string, toZone: string, posX?: string, posY?: string, ownerId?: string) => void;
}): () => boolean {
  return () => {
    const current = args.lookup(args.captured.cardId);
    if (!reverseIsSafe(args.captured, current)) return false; // refuse, dispatch nothing
    args.move(
      args.captured.cardId, args.captured.fromZone,
      args.captured.posX, args.captured.posY, args.captured.prevOwnerId,
    );
    return true;
  };
}
```

For **batch / multi-card** reverses: guard **per card**, dispatch only the safe ones, and return `true` if **at least one** card was restored, `false` if **none** were. (Partial batch undo is acceptable best-effort.)

`expectedOwnerId` note (Open Q resolved): for *taken opponent cards*, the forward move routes ownership via `move_card`'s `targetOwnerId`. The captured `expectedOwnerId` must be the owner the card has **after** the forward move (the acting player for a "take"), which is the same `ownerId` the live lookup will report — so the existing `prevOwnerId`-vs-new-owner distinction the push sites already track (`MultiplayerCanvas.tsx:1088–1098`) maps cleanly: `prevOwnerId` = restore target, `expectedOwnerId` = post-move owner.

---

## Fixes

### Fix 1 — `useUndoStack.ts`: contract + consume-on-undo
- **File:** `app/play/hooks/useUndoStack.ts:9–14, 56–62`
- **Before:** `reverseAction: () => void`; `undo()` pops, runs, returns `string | null`.
- **After:** `reverseAction: () => boolean`; `UndoResult` union; `undo()` peeks → `try { applied? } catch { threw }` → **always pops on non-empty** → returns `UndoResult`.
- **Pure fn:** `undoStackCore.ts` — `pushEntry(stack, entry, MAX=20)` (returns new array, evicts oldest past 20) and `undoEntry(stack)` (returns `{ next, result }`). The hook becomes a thin `useRef`/`useState` wrapper over these.

### Fix 2 — `useGameHotkeys.ts`: turn-gate undo + key-repeat guard
- **File:** `app/shared/hooks/useGameHotkeys.ts:94–101`
- **Before:** Ctrl/Cmd+Z fires `onUndo()` whenever it exists, no turn gate, no repeat guard.
- **After:**
  ```ts
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();              // unconditional (also swallows Shift+Cmd+Z; see decisions)
    if (e.repeat) return;            // ignore held-key autorepeat
    if (!canAct) { showGameToast("Wait for your turn"); return; }
    onUndo?.();
    return;
  }
  ```
  `canAct = mode === 'goldfish' || isMyTurn` already exists at line 81 — reuse it.
- **Pure fn:** `shouldRunUndo({ mode, isMyTurn, repeat }): boolean` (truth table: goldfish always true unless repeat; multiplayer true only when `isMyTurn && !repeat`).

### Fix 3 — `client.tsx`: clear stack on the local player's turn *ending*, not on turnNumber change
- **File:** `app/play/[code]/client.tsx:427–442`
- **Before:** effect keyed on `gameState.game?.turnNumber`; clears whenever the number changes (fires for both players, and on reconnect snapshots).
- **After:** edge-detect `isMyTurn` going **true → false**, guarded by `lifecycle === 'playing'` **and** game presence (`hasGame = !!gameState.game`) to avoid reconnect flicker. Keep the existing `lifecycle !== 'playing'` clear (`437–442`) unchanged.
  ```ts
  const prevIsMyTurnRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const hasGame = !!gameState.game;
    const isMyTurn = gameState.isMyTurn;
    if (lifecycle === 'playing' && hasGame &&
        prevIsMyTurnRef.current === true && isMyTurn === false) {
      undoStack.clear();
    }
    if (lifecycle === 'playing' && hasGame) prevIsMyTurnRef.current = isMyTurn;
  }, [gameState.isMyTurn, gameState.game, lifecycle, undoStack]);
  ```
  Only update `prevIsMyTurnRef` while a game is present/playing so a reconnect that momentarily drops `game` to `undefined` can't synthesize a false `true → false` edge.
- **Pure fn:** `shouldClearUndoStack(prev, current): boolean` → `prev === true && current === false`.

### Fix 4 — `client.tsx`: undo handler maps `UndoResult` → toast
- **File:** `app/play/[code]/client.tsx:419–425`
- **Before:** `if (description) showGameToast('Undo: ' + description)`.
- **After:**
  ```ts
  const handleUndo = useCallback(() => {
    const r = undoStack.undo();
    switch (r.status) {
      case 'applied': showGameToast(`Undo: ${r.description}`); break;
      case 'empty':   showGameToast('Nothing to undo'); break;
      case 'refused': showGameToast("Can't undo — the board changed"); break;
      case 'threw':
        console.warn('Undo threw', r.error);
        showGameToast("Couldn't undo — the action can't be reversed");
        break;
    }
  }, [undoStack]);
  ```

### Fix 5 — `MultiplayerCanvas.tsx`: rewrite every push site to capture both ends + use `makeReverseAction`
- **Files / sites (verified):**
  - drag wrappers `moveCard` / `moveCardsBatch` — `:341–401`
  - opponent-card move `recordOpponentCardUndo` — `:406–420`
  - main `multiplayerActions`: `moveCard` `:1084–1104`, `moveCardsBatch` `:1105–1153`, `flipCard` `:1154–1164`, `meekCard`/`unmeekCard` `:1170–1189`, `addCounter`/`removeCounter` `:1190–1209`, `shuffleCardIntoDeck` `:1210–1223`, `moveCardToTopOfDeck` `:1229–1242`, `moveCardToBottomOfDeck` `:1243–1262`
  - "play all Lost Souls" batch — `:1357–1396`
  - modal actions block: `moveCardToTopOfDeck` `:1497`, `moveCardToBottomOfDeck` `:1511`, `shuffleCardIntoDeck` `:1529`, `exchangeFromDeck` `:1543–1576`
- **Before:** each captures `card.zone` (`fromZone`) only and pushes `reverseAction: () => void` that re-dispatches unconditionally.
- **After:** each captures `Captured` with `expectedZone = toZone` (the destination it's about to move to) and `expectedOwnerId` = post-move owner, then `reverseAction: makeReverseAction({ captured, lookup: findCardForUndo, move: gameState.moveCard })`. Zone-only toggles (`flipCard`, `meekCard`, `addCounter`, …) wrap their reverse to **return `true`** (no positional guard meaningful) — keep them as trivially-safe `() => { reverse(); return true; }`. Counters/meek/flip are pure toggles whose target is identified by `cardId`; guard them only on **existence** (refuse if `findCardForUndo` returns undefined), not on zone.
- **Pure fn:** `makeReverseAction` + `reverseIsSafe` (above). `findCardForUndo` (`:318–328`) stays as the live `lookup`.

---

## Push-site policy (carried over, with rulings)

| Action (site) | Push entry? | Guard basis | Reverse reducer | Notes |
|---|---|---|---|---|
| Drag `moveCard` (`:341`) | yes | zone+owner | `moveCard` → `fromZone` | capture `expectedZone=toZone` |
| Drag `moveCardsBatch` (`:357`) | yes | per-card zone+owner | `moveCard`/`moveCardsBatch` | true if ≥1 restored |
| `recordOpponentCardUndo` (`:406`) | yes | zone+owner | `moveCard` | post-move owner = acting player |
| `multiplayerActions.moveCard` (`:1084`) | yes | zone+owner | `moveCard` | |
| `multiplayerActions.moveCardsBatch` (`:1105`) | yes | per-card | grouped `moveCard`/batch | |
| `flipCard` (`:1154`) | yes | existence only | `flipCard` (toggle) | side-effect-free toggle |
| `meekCard` / `unmeekCard` (`:1170`) | yes | existence only | inverse | |
| `addCounter` / `removeCounter` (`:1190`) | yes | existence only | inverse | |
| `shuffleCardIntoDeck` (`:1210`, `:1529`) | yes | zone+owner | `moveCard` → `fromZone` | guard: live zone must still be `deck` |
| `moveCardToTopOfDeck` (`:1229`, `:1497`) | yes | zone+owner | `moveCard` → `fromZone` | |
| `moveCardToBottomOfDeck` (`:1243`, `:1511`) | yes | zone+owner | `moveCard` / `moveCardToTopOfDeck` | |
| `exchangeFromDeck` (`:1543`) | yes | per-card existence/zone | replacements→deck, originals→source | best-effort |
| "Play all Lost Souls" (`:1357`) | yes | per-card | grouped shuffle/move | best-effort batch |
| **Modal `moveCard` / `moveCardsBatch` (`:1485–1496`)** | **NO** | — | — | **see decision** |
| `removeToken` (`:1265`) | **NO** | — | — | row deleted, unrestorable |
| `setNote` (`:1225`) | **NO** | — | — | non-undoable |
| `attachCard` | **NO** | — | — | non-undoable |
| `exchangeCards` (random draw, `:1226`) | **NO** | — | — | not cleanly reversible |
| `revealCardInHand` (`:1165`) | **NO** | — | — | re-click resets timer; not useful |

**Modal moveCard decision (resolved): keep NON-undoable** (Section 2 wins over Section 1's "Phase 0 fix #4: make modal moves push"). The modal `moveCard`/`moveCardsBatch` at `:1485–1496` overlap with the already-undoable deck-specific modal paths (`moveCardToTopOfDeck`, `exchangeFromDeck`, etc.) right beside them; deck order is already dropped from scope; and these are the highest-clobber surface (bulk moves out of/within the deck modal). Adding a guarded entry here buys little and risks double-entries with the deck-specific paths. Leave them as plain dispatches.

**`removeToken` (resolved): push NO entry.** The token row is deleted; nothing to restore. If desired later, the *creating* action can own the undo — out of scope here.

---

## Test plan

Repo facts (verified by Section 3): Vitest 4, `npm test` = `vitest run`, `vitest.config.mts` runs in **`node`** env, **no jsdom, no setupFiles, no @testing-library/react**, include glob `**/__tests__/**/*.test.ts` (`.ts`, not `.tsx`). All existing tests are pure-function unit tests. **We do NOT adopt jsdom** — we extract pure logic and unit-test it.

### Extracted pure modules + their tests (`*/__tests__/*.test.ts`)
1. **`undoStackCore.ts`** — `pushEntry`, `undoEntry`, `MAX_UNDO_ENTRIES=20`.
   - eviction: 21st push drops the oldest, length stays 20.
   - LIFO order on successive `undoEntry`.
   - `undoEntry` on `applied`/`refused`/`threw` all shrink the stack by 1; on empty returns `{ status:'empty' }` and unchanged stack.
   - `reverseAction` returning `true` → `applied`; `false` → `refused`; throwing → `threw` with `error`.
2. **`shouldRunUndo({ mode, isMyTurn, repeat })`** — truth table: goldfish/!repeat=true, goldfish/repeat=false, mp/myTurn/!repeat=true, mp/!myTurn=false, mp/repeat=false.
3. **`shouldClearUndoStack(prev, current)`** — only `true→false` returns true; `undefined→false`, `false→false`, `true→true`, `false→true` all false.
4. **`reverseIsSafe(captured, current)`** — true when zone+owner match; false on zone change, owner change, and `current===undefined` (deleted token).
5. **`makeReverseAction(...)`** — does **NOT** call `move` and returns `false` when unsafe; calls `move` once with `fromZone`/`prevOwnerId` and returns `true` when safe; batch variant returns `true` iff ≥1 safe.

### Manual 2-client matrix (capture evidence for R1 + T2)
- **R1 anti-clobber:** move card A→hand, opponent/you move A elsewhere, Ctrl+Z → refused toast, board unchanged.
- **R2 clean undo:** move A→territory, Ctrl+Z → A back, "Undo: …".
- **T1 turn-gate:** not your turn, Ctrl+Z → "Wait for your turn", no dispatch.
- **T2 clear on turn end:** make a move, end your turn, regain turn, Ctrl+Z → "Nothing to undo".
- **T3 no mid-round clear:** your move persists undoable across the *opponent's* turn passing (turnNumber changes but your turn didn't end on you — verify edge logic).
- **K1 key-repeat:** hold Ctrl+Z → exactly one undo.
- **M1 modal move:** bulk move in deck modal → not undoable (no entry).
- **D1 deleted token:** create token, move it, remove it, Ctrl+Z on the move → refused, no crash.
- **C1 reconnect:** disconnect/reconnect mid-turn → stack empty, no spurious clear/edge.
- **S1 spectator:** spectator Ctrl+Z → no effect.
- **B1 batch:** multi-select move, alter one card, Ctrl+Z → others restored, altered one skipped.

---

## Verification checklist
- [ ] `npm test` green; new test count strictly higher than before.
- [ ] The two anti-regression tests run in isolation and pass: (a) `undoEntry` reports `applied` only when `reverseAction` returns true (false-success regression); (b) `reverseIsSafe`/`makeReverseAction` refuses + does not dispatch on zone/owner change and on not-found.
- [ ] `tsc --noEmit` clean; `npm run build` clean.
- [ ] Manual matrix run on 2 clients; R1 (anti-clobber) and T2 (clear on turn end) evidence captured.

---

## Resolved decisions (every open question → one ruling)
1. **Contract:** `reverseAction: () => boolean` (guard layer) **AND** `undo()` try/catch (defense-in-depth), collapsed into `UndoResult = applied | refused | empty | threw`.
2. **Consume vs keep failed entry:** **CONSUME** on `applied`, `refused`, and `threw`. Justified above; tests assert shrink-by-one.
3. **Capture shape:** capture both `fromZone` (restore) and `expectedZone = toZone` (guard) + `prevOwnerId` / `expectedOwnerId`. Real and required — verified push sites currently capture only `fromZone`.
4. **Modal moveCard / moveCardsBatch (`:1485`):** **NON-undoable** (no push).
5. **`removeToken`:** **NON-undoable** (no push; row deleted).
6. **`setNote` / `attachCard` / `exchangeCards` (random):** stay **non-undoable**.
7. **Turn-end clear:** edge-detect `isMyTurn` **true→false**, guarded by `lifecycle==='playing'` + `hasGame`. Replaces the `turnNumber`-keyed effect. Keep the `lifecycle!=='playing'` clear.
8. **Reconnect guard:** `hasGame` (`!!gameState.game`) gating both the edge check and the `prevIsMyTurnRef` update is sufficient — a reconnect that nulls `game` cannot manufacture a false edge.
9. **Key-repeat:** `if (e.repeat) return` after `preventDefault`.
10. **Shift+Cmd+Z (redo):** **swallow it** (no redo feature). `preventDefault` is unconditional on Cmd/Ctrl+Z, so Shift+Cmd+Z is also suppressed and does nothing. Do not implement redo.
11. **Toast on refusal:** **show** a quiet toast ("Can't undo — the board changed") rather than silence, so the user understands why nothing happened. (Resolves Section 2's "rec quiet/null" toward a visible-but-quiet message; Section 1's distinct toast styling stays out of scope.)
12. **`expectedOwnerId` for taken opponent cards:** post-move owner = acting player; matches live lookup. Captured separately from `prevOwnerId` (restore target).
13. **`zoneIndex` / deck order:** stays `undefined`, intentionally dropped.
14. **jsdom / hook tests:** **not adopted**; extract pure logic instead. Existing `.ts` include glob already covers new tests.
15. **Auto-discard after N failures:** **no** — consume-on-undo already prevents infinite retry of one stale entry.

---

## Risks
- **"applied" ≠ server-confirmed.** Fire-and-forget means a guard-passing reverse can still be rejected server-side (race between live snapshot and dispatch). The guard shrinks this window but cannot close it without server changes (out of scope). Acceptable.
- **Lossy restore** (counters/notes/meek/weapons not rebuilt) may surprise users on undo of a leaving-play move. Mitigated by toast wording and accepted per scope.
- **Edge-detection correctness for T3** (opponent's turn passing must not look like *your* turn ending). The `true→false` edge on `isMyTurn` specifically — not `turnNumber` — addresses this; verify in manual T3.
- **Batch partial undo** may leave a confusing half-restored state; accepted as best-effort, surfaced only via the description toast.
