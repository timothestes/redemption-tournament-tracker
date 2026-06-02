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
 * Peek the top entry, run its reverse inside try/catch, and ALWAYS consume it
 * on any non-empty outcome (applied | refused | threw). Consuming on failure
 * prevents Ctrl+Z from retrying the same stale reverse forever — the user
 * falls through to the previous entry instead.
 */
export function undoEntry(stack: UndoEntry[]): { next: UndoEntry[]; result: UndoResult } {
  if (stack.length === 0) {
    return { next: stack, result: { status: 'empty' } };
  }
  const entry = stack[stack.length - 1];
  const next = stack.slice(0, -1);
  try {
    const applied = entry.reverseAction();
    return {
      next,
      result: applied
        ? { status: 'applied', description: entry.description }
        : { status: 'refused', description: entry.description },
    };
  } catch (error) {
    return { next, result: { status: 'threw', description: entry.description, error } };
  }
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
  posX?: string;        // courtesy restore, not guarded
  posY?: string;        // courtesy restore, not guarded
  expectedZone: string;    // == forward toZone — guard compares live zone to THIS
  expectedOwnerId: string; // == owner the card has AFTER the forward move
}

/** reverseIsSafe: the card still exists AND is still where the forward move left it. */
export function reverseIsSafe(
  captured: Pick<Captured, 'expectedZone' | 'expectedOwnerId'>,
  current: { zone: string; ownerId: string } | undefined,
): boolean {
  if (!current) return false;                       // deleted token → refuse
  return current.zone === captured.expectedZone
      && current.ownerId === captured.expectedOwnerId;
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
    if (!reverseIsSafe(args.captured, current)) return false; // refuse, dispatch nothing
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
      if (!reverseIsSafe(captured, current)) continue;
      args.move(captured.cardId, captured.fromZone, captured.posX, captured.posY, captured.prevOwnerId);
      any = true;
    }
    return any;
  };
}
