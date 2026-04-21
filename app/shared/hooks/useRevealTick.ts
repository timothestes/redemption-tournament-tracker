'use client';

import { useEffect, useState } from 'react';

/**
 * Forces a re-render on every animation frame as long as `active` is true.
 * Used to drive smooth countdown rendering for per-card hand reveals
 * without mutating shared state. Call sites pass `active = zones.hand.some(
 * c => c.revealUntil && c.revealUntil > Date.now())` (or the opponent-side
 * equivalent).
 *
 * rAF over setInterval: the browser pauses the loop when the tab is
 * backgrounded, and the cost per frame is tiny (a single setState) — the
 * memoized card nodes only re-render if their derived reveal state actually
 * changes, so the arc animation stays smooth without re-drawing every card.
 */
export function useRevealTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let rafId = 0;
    const loop = () => {
      setTick(t => t + 1);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [active]);
}
