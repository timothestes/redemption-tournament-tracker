# Multiplayer Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `useGameHotkeys` into the multiplayer play client so D/Cmd+D draw, S shuffle, R dice, H hand spread, Enter end-turn, and Tab loupe all work during a live game.

**Architecture:** `useGameHotkeys` is the shared keyboard hook already used by goldfish. It accepts `enabled`, `mode`, and `isMyTurn` to gate actions appropriately. Calling it with `enabled={lifecycle === 'playing'}` and `mode="multiplayer"` is sufficient — no changes to the hook logic are needed.

**Tech Stack:** React 19, TypeScript, `useGameHotkeys` (`app/shared/hooks/useGameHotkeys.ts`)

---

## Files

| File | Change |
|------|--------|
| `app/shared/hooks/useGameHotkeys.ts` | Update JSDoc to explicitly list Cmd/Ctrl+D |
| `app/play/[code]/client.tsx` | Add `useGameHotkeys` call in `GameInner` |
| `readme.md` | Remove backlog item |

---

### Task 1: Update JSDoc in useGameHotkeys

**Files:**
- Modify: `app/shared/hooks/useGameHotkeys.ts:46-59`

- [ ] **Step 1: Update the JSDoc keybindings comment**

Replace the existing `* D` line and add Ctrl/Cmd+D as an alias:

```typescript
/**
 * Shared keyboard-shortcut hook for goldfish and multiplayer game modes.
 *
 * Keybindings:
 *   D / Ctrl+D / Cmd+D — draw a card (turn-gated in multiplayer)
 *   S         — shuffle deck (turn-gated in multiplayer)
 *   R         — roll dice (always enabled)
 *   H         — toggle hand spread
 *   Tab       — toggle loupe / card preview
 *   Enter     — advance phase (turn-gated in multiplayer)
 *   +/=       — zoom in (increase card size)
 *   -         — zoom out (decrease card size)
 *   Ctrl/Cmd+Z — undo (goldfish only)
 *   Escape    — handled separately by the selection system
 */
```

---

### Task 2: Wire useGameHotkeys in the multiplayer play client

**Files:**
- Modify: `app/play/[code]/client.tsx`

- [ ] **Step 1: Add import**

After the existing imports at the top of the file, add:

```typescript
import { useGameHotkeys } from '@/app/shared/hooks/useGameHotkeys';
```

- [ ] **Step 2: Add hook call in GameInner**

In `GameInner`, after the existing hooks (after line 137 where `useSpreadHand` and `useCardPreview` are destructured), add a memoised actions object and the hook call:

```typescript
// Keyboard shortcuts — active only during a live game.
// The hook only calls drawCard() and shuffleDeck(); the rest are stubs to
// satisfy the GameActions interface.
const hotkeysActions = useMemo<GameActions>(() => ({
  drawCard: () => gameState.drawCard(),
  shuffleDeck: () => gameState.shuffleDeck(),
  moveCard: () => {},
  moveCardsBatch: () => {},
  flipCard: () => {},
  meekCard: () => {},
  unmeekCard: () => {},
  addCounter: () => {},
  removeCounter: () => {},
  shuffleCardIntoDeck: () => {},
  setNote: () => {},
  exchangeCards: () => {},
  drawMultiple: () => {},
  moveCardToTopOfDeck: () => {},
  moveCardToBottomOfDeck: () => {},
  randomHandToZone: () => {},
  reloadDeck: () => {},
}), [gameState]);

useGameHotkeys({
  actions: hotkeysActions,
  mode: 'multiplayer',
  isMyTurn: gameState.isMyTurn,
  enabled: lifecycle === 'playing',
  handSize: gameState.myCards['hand']?.length ?? 0,
  deckSize: gameState.myCards['deck']?.length ?? 0,
  onRollDice: () => gameState.rollDice(BigInt(20)),
  onToggleSpreadHand: toggleSpreadHand,
  onToggleLoupe: toggleLoupe,
  onAdvancePhase: gameState.endTurn,
});
```

`GameActions` required fields (from `app/shared/types/gameActions.ts`): `moveCard`, `moveCardsBatch`, `flipCard`, `meekCard`, `unmeekCard`, `addCounter`, `removeCounter`, `shuffleCardIntoDeck`, `shuffleDeck`, `randomHandToZone`, `reloadDeck`, `setNote`, `exchangeCards`, `drawCard`, `drawMultiple`, `moveCardToTopOfDeck`, `moveCardToBottomOfDeck`. Optional fields (`spawnLostSoul?`, `removeToken?`, etc.) can be omitted.

- [ ] **Step 4: Build check**

```bash
cd /Users/timestes/projects/redemption-tournament-tracker && npm run build 2>&1 | tail -30
```

Expected: no TypeScript errors in the modified files.

---

### Task 3: Remove backlog item and commit

**Files:**
- Modify: `readme.md`

- [ ] **Step 1: Remove the backlog line from readme.md**

In `readme.md`, under `# play features`, delete this line:
```
allow cmd + d draw option
```

- [ ] **Step 2: Commit**

```bash
git add app/shared/hooks/useGameHotkeys.ts app/play/[code]/client.tsx readme.md docs/superpowers/specs/2026-04-05-multiplayer-keyboard-shortcuts-design.md docs/superpowers/plans/2026-04-05-multiplayer-keyboard-shortcuts.md
git commit -m "feat: wire keyboard shortcuts into multiplayer play mode

D/Cmd+D draws, S shuffles, R rolls dice, H toggles hand spread,
Enter ends turn, Tab toggles loupe — all gated on lifecycle === 'playing'.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
