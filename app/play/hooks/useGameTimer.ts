'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const LOCALSTORAGE_KEY = 'game-timer-visible';

/**
 * Game timer anchored to a server timestamp so the elapsed value survives
 * navigation away and back.
 *
 * Pass `anchorMicros` = the server-recorded `playingStartedAtMicros` (u64
 * microseconds since the unix epoch). Pass `0n` / `null` when the game is not
 * yet in the 'playing' state; the display stays at 0.
 *
 * `pauseStartedAtMicros` and `totalPausedMicros` are server-authoritative
 * pause state (mutually-agreed pause feature). When `pauseStartedAtMicros > 0n`
 * the game is currently paused; `totalPausedMicros` is the accumulated paused
 * duration across the whole game.
 *
 * Local pause/resume (e.g. deck search open) only affects the current session;
 * it resets on navigation. Layered on top of the server pause.
 */
export function useGameTimer(
  anchorMicros: bigint | null,
  pauseStartedAtMicros: bigint = 0n,
  totalPausedMicros: bigint = 0n,
) {
  const [elapsed, setElapsed] = useState(0);

  // Local pause bookkeeping (session-only)
  const pauseStartRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);

  const [isTimerVisible, setIsTimerVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_KEY, String(isTimerVisible));
  }, [isTimerVisible]);

  const toggleTimerVisibility = useCallback(() => {
    setIsTimerVisible((v) => !v);
  }, []);

  const computeElapsed = useCallback(() => {
    if (anchorMicros === null || anchorMicros === 0n) return 0;
    const anchorMs = Number(anchorMicros / 1000n);
    const now = Date.now();
    const activePauseMs = pauseStartRef.current !== null ? now - pauseStartRef.current : 0;
    const serverTotalPausedMs = Number(totalPausedMicros / 1000n);
    const serverActivePauseMs = pauseStartedAtMicros > 0n
      ? Math.max(0, now - Number(pauseStartedAtMicros / 1000n))
      : 0;
    const elapsedMs =
      now - anchorMs
      - totalPausedMsRef.current - activePauseMs
      - serverTotalPausedMs - serverActivePauseMs;
    return Math.max(0, Math.floor(elapsedMs / 1000));
  }, [anchorMicros, pauseStartedAtMicros, totalPausedMicros]);

  useEffect(() => {
    // Reset session pause state when anchor changes (new game / rematch)
    pauseStartRef.current = null;
    totalPausedMsRef.current = 0;

    if (anchorMicros === null || anchorMicros === 0n) {
      setElapsed(0);
      return;
    }

    setElapsed(computeElapsed());
    const interval = setInterval(() => setElapsed(computeElapsed()), 1000);
    return () => clearInterval(interval);
  }, [anchorMicros, computeElapsed]);

  const pause = useCallback(() => {
    if (pauseStartRef.current !== null) return;
    pauseStartRef.current = Date.now();
  }, []);

  const resume = useCallback(() => {
    if (pauseStartRef.current === null) return;
    totalPausedMsRef.current += Date.now() - pauseStartRef.current;
    pauseStartRef.current = null;
  }, []);

  return {
    elapsed,
    formatted: formatElapsed(elapsed),
    pause,
    resume,
    isTimerVisible,
    toggleTimerVisibility,
  };
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}
