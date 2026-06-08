// ---------------------------------------------------------------------------
// Pure, framework-free core of the multiplayer undo stack.
//
// The React hook (useUndoStack.ts) is a thin wrapper over these functions so
// the interesting logic — eviction, LIFO consume semantics, and the
// live-state safety guard — can be unit-tested in the node test env without
// jsdom or @testing-library/react.
// ---------------------------------------------------------------------------

export const MAX_UNDO_ENTRIES = 20;

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
  | { status: 'threw'; description: string; error: unknown }; // unexpected throw

// ---------------------------------------------------------------------------
// Stack operations (return new arrays — never mutate the input)
// ---------------------------------------------------------------------------

/** Append an entry, evicting the oldest once the stack exceeds `max`. */
export function pushEntry(
  stack: UndoEntry[],
  entry: UndoEntry,
  max: number = MAX_UNDO_ENTRIES,
): UndoEntry[] {
  const next = [...stack, entry];
  if (next.length > max) next.shift();
  return next;
}

/**
 * Walk the stack from the top and apply the first entry whose reverse succeeds,
 * removing only that entry. An entry that returns false (its card is gone) is
 * passed over and LEFT IN PLACE — so a single dead entry can't jam Ctrl+Z, and
 * still-valid history below it is never silently discarded. If nothing in the
 * stack can be applied, the stack is left untouched and the result is `refused`.
 * A reverse that throws is treated as an unrecoverable failure of that specific
 * entry: it is consumed and reported as `threw`.
 */
export function undoEntry(stack: UndoEntry[]): { next: UndoEntry[]; result: UndoResult } {
  if (stack.length === 0) {
    return { next: stack, result: { status: 'empty' } };
  }
  const without = (i: number) => [...stack.slice(0, i), ...stack.slice(i + 1)];
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    try {
      if (entry.reverseAction()) {
        return { next: without(i), result: { status: 'applied', description: entry.description } };
      }
      // returned false (card gone) — leave it and keep scanning downward
    } catch (error) {
      return { next: without(i), result: { status: 'threw', description: entry.description, error } };
    }
  }
  return { next: stack, result: { status: 'refused', description: stack[stack.length - 1].description } };
}

/**
 * Clear the undo stack only on the local player's turn *ending* — the
 * `isMyTurn` edge from true → false. Any other transition keeps the stack.
 */
export function shouldClearUndoStack(prev: boolean | undefined, current: boolean | undefined): boolean {
  return prev === true && current === false;
}

// ---------------------------------------------------------------------------
// Live-state safety guard
// ---------------------------------------------------------------------------

export interface Captured {
  cardId: string;
  fromZone: string;     // restore target (pre-forward)
  prevOwnerId: string;  // restore target owner (pre-forward)
  posX?: string;        // courtesy restore
  posY?: string;        // courtesy restore
}

/**
 * Best-effort guard: refuse only if the card no longer exists. Zone/owner are
 * NOT compared — undo means "put it back," and the SpacetimeDB reducer is the
 * authority on whether the reverse move is actually legal.
 */
export function reverseIsSafe(
  current: { zone: string; ownerId: string } | undefined,
): boolean {
  return !!current;
}

type LiveLookup = (id: string) => { zone: string; ownerId: string } | undefined;
type MoveFn = (id: string, toZone: string, posX?: string, posY?: string, ownerId?: string) => void;

/** Bind the guard to a live lookup + the move dispatcher for a single card. */
export function makeReverseAction(args: {
  captured: Captured;
  lookup: LiveLookup;
  move: MoveFn;
}): () => boolean {
  return () => {
    const current = args.lookup(args.captured.cardId);
    if (!reverseIsSafe(current)) return false; // card gone → refuse, dispatch nothing
    args.move(
      args.captured.cardId, args.captured.fromZone,
      args.captured.posX, args.captured.posY, args.captured.prevOwnerId,
    );
    return true;
  };
}

/**
 * Batch variant: guard each card independently, dispatch only the safe ones,
 * and return true if at least one card was restored (false if none).
 * Partial batch undo is acceptable best-effort.
 */
export function makeBatchReverseAction(args: {
  items: Captured[];
  lookup: LiveLookup;
  move: MoveFn;
}): () => boolean {
  return () => {
    let any = false;
    for (const captured of args.items) {
      const current = args.lookup(captured.cardId);
      if (!reverseIsSafe(current)) continue;
      args.move(captured.cardId, captured.fromZone, captured.posX, captured.posY, captured.prevOwnerId);
      any = true;
    }
    return any;
  };
}
