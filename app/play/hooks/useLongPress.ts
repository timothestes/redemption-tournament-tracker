'use client';

import { useRef, useCallback, useEffect } from 'react';
import {
  beginPress, shouldCancelForMovement, shouldFireLongPress,
  LONG_PRESS_MS, type PressState,
} from '@/app/play/lib/longPressCore';

export interface LongPressPoint { x: number; y: number }

/**
 * Long-press recognizer for Konva nodes. `onLongPress` receives the press
 * origin in the same coordinate space the caller supplied.
 *
 * The caller cancels any pending Konva drag (node.stopDrag()) inside
 * onLongPress - this hook only decides *when*.
 */
export function useLongPress(onLongPress: (p: LongPressPoint) => void) {
  const stateRef = useRef<PressState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    stateRef.current = null;
  }, [clearTimer]);

  const onPointerDown = useCallback((x: number, y: number) => {
    cancel();
    const state = beginPress(x, y, performance.now());
    stateRef.current = state;
    timerRef.current = setTimeout(() => {
      const s = stateRef.current;
      if (!s) return;
      if (!shouldFireLongPress(s, performance.now())) return;
      s.firedLongPress = true;
      onLongPress({ x: s.startX, y: s.startY });
    }, LONG_PRESS_MS);
  }, [cancel, onLongPress]);

  const onPointerMove = useCallback((x: number, y: number) => {
    const s = stateRef.current;
    if (!s || s.firedLongPress) return;
    if (shouldCancelForMovement(s, x, y)) cancel();
  }, [cancel]);

  const onPointerUp = useCallback(() => cancel(), [cancel]);

  useEffect(() => clearTimer, [clearTimer]);

  return { onPointerDown, onPointerMove, onPointerUp, cancel };
}
