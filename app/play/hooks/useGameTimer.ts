'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const LOCALSTORAGE_KEY = 'game-timer-visible';

/**
 * Client-side game timer that tracks elapsed play time.
 *
 * - Ticks once per second via setInterval (interval stored in a ref to avoid
 *   re-renders on start/stop).
 * - Only the displayed `elapsed` state triggers a re-render, once per second.
 * - Supports pause (deck search open), resume, and reset.
 * - The visibility preference is persisted to localStorage.
 */
export function useGameTimer() {
  // Elapsed seconds displayed to the user
  const [elapsed, setElapsed] = useState(0);

  // Whether the timer is currently ticking
  const isRunningRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track when the timer was last "started" so we can compute drift-corrected
  // elapsed time, but a simple 1s tick is fine for a casual game timer.
  const startTimeRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0); // seconds accumulated before the latest pause

  // Visibility preference
  const [isTimerVisible, setIsTimerVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  // Persist visibility to localStorage
  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_KEY, String(isTimerVisible));
  }, [isTimerVisible]);

  const toggleTimerVisibility = useCallback(() => {
    setIsTimerVisible((v) => !v);
  }, []);

  // --- Core timer controls ---

  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTicking = useCallback(() => {
    clearTick();
    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      if (startTimeRef.current === null) return;
      const secondsSinceResume = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(accumulatedRef.current + secondsSinceResume);
    }, 1000);
  }, [clearTick]);

  /** Start or resume the timer. */
  const start = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    startTicking();
  }, [startTicking]);

  /** Pause the timer (e.g. deck search open). */
  const pause = useCallback(() => {
    if (!isRunningRef.current) return;
    isRunningRef.current = false;
    // Accumulate the time from this run segment
    if (startTimeRef.current !== null) {
      accumulatedRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
      startTimeRef.current = null;
    }
    clearTick();
  }, [clearTick]);

  /** Resume after a pause. */
  const resume = useCallback(() => {
    start();
  }, [start]);

  /** Reset elapsed to zero and stop the timer. */
  const reset = useCallback(() => {
    isRunningRef.current = false;
    accumulatedRef.current = 0;
    startTimeRef.current = null;
    clearTick();
    setElapsed(0);
  }, [clearTick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTick();
  }, [clearTick]);

  // --- Formatted display ---

  const formatted = formatElapsed(elapsed);

  return {
    /** Elapsed seconds. */
    elapsed,
    /** Human-readable MM:SS or H:MM:SS string. */
    formatted,
    /** Whether the timer is currently ticking. */
    isRunning: isRunningRef.current,
    /** Start / resume the timer. */
    start,
    /** Pause the timer. */
    pause,
    /** Resume the timer (alias for start). */
    resume,
    /** Reset the timer to 0 and stop. */
    reset,
    /** Whether the timer display is visible. */
    isTimerVisible,
    /** Toggle timer visibility (persisted to localStorage). */
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
