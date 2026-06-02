'use client';

import { useCallback, useRef, useState } from 'react';
import {
  pushEntry,
  undoEntry,
  type UndoEntry,
  type UndoResult,
} from './undoStackCore';

// Re-export the contract types so existing imports of `UndoEntry` keep working.
export type { UndoEntry, UndoResult } from './undoStackCore';
export { reverseIsSafe, makeReverseAction, makeBatchReverseAction } from './undoStackCore';
export type { Captured } from './undoStackCore';

// ---------------------------------------------------------------------------
// Hook contract
// ---------------------------------------------------------------------------

export interface UndoStack {
  /** Number of actions that can be undone */
  count: number;
  /** Push a reverse entry onto the stack (call BEFORE the forward action) */
  push: (entry: UndoEntry) => void;
  /** Run the most recent reverse action and consume it. Returns a richer result. */
  undo: () => UndoResult;
  /** Clear the entire stack (e.g. on turn end, game reset) */
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Client-side undo stack for multiplayer mode.
 *
 * A thin React wrapper over the pure functions in `undoStackCore.ts`. Each
 * undoable game action pushes its reverse before executing. Undo runs the
 * top reverse, which guards against stale/deleted targets before dispatching;
 * the stack is consumed on every non-empty outcome. Ephemeral — lost on page
 * refresh (acceptable).
 */
export function useUndoStack(): UndoStack {
  const stackRef = useRef<UndoEntry[]>([]);
  const [count, setCount] = useState(0);

  const push = useCallback((entry: UndoEntry) => {
    stackRef.current = pushEntry(stackRef.current, entry);
    setCount(stackRef.current.length);
  }, []);

  const undo = useCallback((): UndoResult => {
    const { next, result } = undoEntry(stackRef.current);
    stackRef.current = next;
    setCount(next.length);
    return result;
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    setCount(0);
  }, []);

  return { count, push, undo, clear };
}
