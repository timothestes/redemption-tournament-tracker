'use client';

import { useState, useCallback, useRef } from 'react';
import {
  tapMoveReducer, type TapMoveState, type TapMoveEvent, type CommitMove,
} from '@/app/play/lib/tapToMoveCore';

const IDLE: TapMoveState = { kind: 'idle' };

/**
 * Thin React wrapper over the pure tapMoveReducer. All decision logic lives in
 * tapToMoveCore.ts so it stays unit-testable (vitest has no jsdom here).
 */
export function useTapToMove(onCommit: (move: CommitMove) => void) {
  const [state, setState] = useState<TapMoveState>(IDLE);

  // The reducer runs OUTSIDE setState against a ref mirror. Running it inside
  // the updater made onCommit a side effect in an updater, which React
  // StrictMode double-invokes - firing moveCard (and pushing an undo entry)
  // twice for every tap in development.
  const stateRef = useRef<TapMoveState>(IDLE);

  const dispatch = useCallback((event: TapMoveEvent) => {
    const { state: next, commit } = tapMoveReducer(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    if (commit) onCommit(commit);
  }, [onCommit]);

  const reset = useCallback(() => { stateRef.current = IDLE; setState(IDLE); }, []);

  return { state, dispatch, reset };
}
