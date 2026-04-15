'use client';

import { useCallback, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UndoEntry {
  /** Human-readable description for the game log, e.g. "Moved Angel of the Lord to territory" */
  description: string;
  /** Function that calls the appropriate SpacetimeDB reducer to reverse this action */
  reverseAction: () => void;
}

export interface UndoStack {
  /** Number of actions that can be undone */
  count: number;
  /** Push a reverse entry onto the stack (call BEFORE the forward action) */
  push: (entry: UndoEntry) => void;
  /** Pop and execute the most recent reverse action. Returns the description or null. */
  undo: () => string | null;
  /** Clear the entire stack (e.g. on turn end, game reset) */
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_UNDO_ENTRIES = 20;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Client-side undo stack for multiplayer mode.
 *
 * Stores reverse-action entries (max 20). Each undoable game action pushes
 * its reverse before executing. Undo pops the stack and runs the reverse
 * reducer call. The stack is ephemeral — lost on page refresh (acceptable).
 */
export function useUndoStack(): UndoStack {
  const stackRef = useRef<UndoEntry[]>([]);
  const [count, setCount] = useState(0);

  const push = useCallback((entry: UndoEntry) => {
    stackRef.current.push(entry);
    if (stackRef.current.length > MAX_UNDO_ENTRIES) {
      stackRef.current.shift();
    }
    setCount(stackRef.current.length);
  }, []);

  const undo = useCallback((): string | null => {
    const entry = stackRef.current.pop();
    if (!entry) return null;
    setCount(stackRef.current.length);
    entry.reverseAction();
    return entry.description;
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    setCount(0);
  }, []);

  return { count, push, undo, clear };
}
