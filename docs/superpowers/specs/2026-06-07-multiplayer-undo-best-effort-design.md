# Multiplayer Undo — Best-Effort Redesign

- **Date:** 2026-06-07
- **Status:** Approved, ready for implementation
- **Scope:** Client-side only. No server / reducer / schema changes.
- **Supersedes:** the strict-guard and consume-on-refusal rulings (decisions #2, #3, #11) of `2026-06-01-multiplayer-undo-fix.md`. All other rulings from that spec (turn-gating, turn-end clearing, key-repeat guard, which actions push entries) stand unchanged.

---

## Problem

The current undo guard (`reverseIsSafe`) refuses any reverse unless the card is still **exactly** where the forward action left it — same zone *and* same owner. In a live game the board changes constantly, so undo refuses far more often than it works and shows "Can't undo — the board changed." On top of that, a refused undo is still **popped** from the stack, so one failed press silently burns a step of history. The result: undo is effectively unusable.

Key realization: the SpacetimeDB reducer is the authority on what moves are legal. The client guard is redundant defensive code — if a reverse is genuinely illegal, the server rejects it and the existing `try/catch` reports it (`threw`). So the client can be permissive and lean on the server.

## Desired semantics

Undo is a **best-effort "put it back," not a transactional rollback.** Pressing undo moves the card back to where it came from as long as the card still exists. The only hard stop is a card that no longer exists at all (deleted/merged token). History is never silently eaten.

## Changes

### Change 1 — Relax the guard to existence-only
**File:** `app/play/hooks/undoStackCore.ts`

`reverseIsSafe` becomes an existence check only:

```ts
/** Best-effort guard: the card still exists. Zone/owner are no longer compared —
 *  the server reducer is the authority on whether the reverse move is legal. */
export function reverseIsSafe(
  current: { zone: string; ownerId: string } | undefined,
): boolean {
  return !!current;
}
```

- Remove the `expectedZone` / `expectedOwnerId` fields from `Captured`, and from `makeReverseAction` / `makeBatchReverseAction` (they only fed the dropped comparison).
- Update the ~10 construction sites in `MultiplayerCanvas.tsx` that set `expectedZone` / `expectedOwnerId` to stop passing them. The inline `reverseIsSafe(captured, lookupForUndo(...))` call sites (e.g. the `moveCardToBottomOfDeck` deck branch ~`:1423`, the exchange batch ~`:1568`) update to the new single-arg signature.
- Counter/flip/meek entries already guard on existence only — they need no change beyond the signature update if they call `reverseIsSafe` (they currently call `lookupForUndo` directly, so likely untouched).

This is the chokepoint: moves, shuffles, and deck-ops all flow through `makeReverseAction` / `makeBatchReverseAction`, so relaxing it here fixes them all at once.

### Change 2 — Don't silently eat history; fall through dead entries
**File:** `app/play/hooks/undoStackCore.ts` — `undoEntry`

On an undo press, walk the stack from the top and apply the **first entry whose reverse succeeds**, removing only that one. Entries whose card is gone are passed over (left in place) rather than jamming the top of the stack. If no entry in the stack can be applied, return `refused` and remove nothing.

```ts
export function undoEntry(stack: UndoEntry[]): { next: UndoEntry[]; result: UndoResult } {
  if (stack.length === 0) return { next: stack, result: { status: 'empty' } };
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    try {
      if (entry.reverseAction()) {
        const next = [...stack.slice(0, i), ...stack.slice(i + 1)]; // remove only the applied entry
        return { next, result: { status: 'applied', description: entry.description } };
      }
      // returned false (card gone) → leave it, keep scanning downward
    } catch (error) {
      const next = [...stack.slice(0, i), ...stack.slice(i + 1)]; // a throw is unrecoverable → consume
      return { next, result: { status: 'threw', description: entry.description, error } };
    }
  }
  return { next: stack, result: { status: 'refused', description: stack[stack.length - 1].description } };
}
```

Rationale: best-effort makes a `false` return mean "card genuinely gone" (permanent), so keeping it on top would freeze undo forever — fall-through avoids that while still never discarding a still-valid entry. A `throw` is a real failure of that specific reverse, so it's consumed (matches prior behavior).

### Change 3 — Toast wording
**File:** `app/play/[code]/client.tsx` — `handleUndo`

`refused` now means "nothing in the stack could be undone — those cards are gone." Update the toast:

```ts
case 'refused': showGameToast("Nothing left to undo on the board"); break;
```

`applied` / `empty` / `threw` toasts unchanged.

## Out of scope (unchanged from prior spec)
- No server / reducer / schema changes. "Applied" means dispatched, never server-confirmed.
- No deck-order (`zoneIndex`) restoration; reverse restores zone + owner only.
- Lossy restore accepted: counters/notes/meek/weapons are not rebuilt on undo of a leaving-play move.
- Turn-gating, turn-end clearing, and key-repeat guard stay exactly as they are.

## Consequence to note
With the owner check gone, best-effort will move a card back even if the opponent now controls it. This was chosen deliberately over an owner-guard; the server still rejects any reverse that is actually illegal, so it is safe.

## Test plan
`undoStackCore.ts` has existing pure-function unit tests (`vitest`, node env). Update and extend:

1. **`reverseIsSafe`** — true when `current` defined, false when `undefined`. (Remove zone/owner-mismatch cases — those no longer refuse.)
2. **`makeReverseAction`** — calls `move` and returns true when the card exists regardless of its current zone/owner; returns false and does not dispatch only when the card is gone.
3. **`makeBatchReverseAction`** — restores every still-existing card; skips only the gone ones; true iff ≥1 restored.
4. **`undoEntry` fall-through** — applies the top entry when it succeeds (removes only it); when the top entry's card is gone, skips it and applies the next applicable entry, leaving the dead one in the stack; returns `refused` removing nothing when all entries are dead; `empty` on empty stack; consumes (removes) an entry that throws.

## Verification checklist
- [ ] `npm test` green; updated/new tests cover the four cases above.
- [ ] `tsc --noEmit` clean.
- [ ] Manual 2-client: move a card then immediately Ctrl+Z → card returns (the case that used to fail). Move a card, have it removed, Ctrl+Z → falls through to the previous undoable action or reports nothing left. Hold Ctrl+Z → one undo (key-repeat guard still works).
