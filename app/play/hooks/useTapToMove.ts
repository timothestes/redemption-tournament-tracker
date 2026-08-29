'use client';

import { useState, useCallback } from 'react';
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

  const dispatch = useCallback((event: TapMoveEvent) => {
    setState((prev) => {
      const { state: next, commit } = tapMoveReducer(prev, event);
      if (commit) onCommit(commit);
      return next;
    });
  }, [onCommit]);

  const reset = useCallback(() => setState(IDLE), []);

  return { state, dispatch, reset };
}
