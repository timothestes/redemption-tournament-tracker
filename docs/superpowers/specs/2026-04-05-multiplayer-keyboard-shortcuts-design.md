# Multiplayer Keyboard Shortcuts

**Date:** 2026-04-05

## Problem

`useGameHotkeys` was designed with multiplayer in mind (it accepts `mode` and `isMyTurn`), but was never wired up in the multiplayer play client. As a result, none of the shared keyboard shortcuts (draw, shuffle, dice, etc.) work during a live game. The play features backlog tracks this as "allow cmd + d draw option."

## Design

Wire `useGameHotkeys` into `app/play/[code]/client.tsx` at the component level.

### Gate

`enabled={lifecycle === 'playing'}` — shortcuts are suppressed during pregame, lobby, finished, and error states. The hook's own `enabled` prop already handles this cleanly.

### Actions

| Key | Action | Turn-gated |
|-----|--------|-----------|
| D / Cmd+D / Ctrl+D | Draw card | Yes |
| S | Shuffle deck | Yes |
| R | Roll dice (d20) | No |
| H | Toggle hand spread | No |
| Tab | Toggle card loupe | No |
| Enter | End turn | Yes |
| +/= | Zoom in | No |
| - | Zoom out | No |
| Cmd/Ctrl+Z | Undo | Goldfish only (no-op in multiplayer) |

**Cmd+D / Ctrl+D specifically:** The existing `case 'd':` in `useGameHotkeys` fires for both bare `D` and `Cmd+D` (since `e.key` is `'d'` regardless of modifier). `e.preventDefault()` runs unconditionally in that case, preventing the browser's default bookmark dialog. No changes are needed to the hook itself.

### Callbacks wired up

- `drawCard` / `shuffleDeck` → `gameState.*`
- `onRollDice` → `() => gameState.rollDice(BigInt(20))`
- `onToggleSpreadHand` → `toggleSpreadHand` (from `useSpreadHand`)
- `onToggleLoupe` → not available in multiplayer client; omit
- `onAdvancePhase` → `gameState.endTurn`
- `onZoomIn` / `onZoomOut` → card scale callbacks from `useCardScale`

### State passed

- `handSize`: `gameState.myCards['hand']?.length ?? 0`
- `deckSize`: `gameState.myCards['deck']?.length ?? 0`

## Files Changed

| File | Change |
|------|--------|
| `app/play/[code]/client.tsx` | Add `useGameHotkeys` call with multiplayer config |
| `app/shared/hooks/useGameHotkeys.ts` | Update JSDoc to explicitly list Cmd/Ctrl+D |
| `readme.md` | Remove "allow cmd + d draw option" from play features backlog |

## Out of Scope

- Adding zoom callbacks (useCardScale is not yet used in the multiplayer client)
- Loupe toggle (CardPreviewProvider is available but no toggle callback is threaded through)
