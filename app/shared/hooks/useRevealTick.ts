'use client';

import { useEffect, useState } from 'react';

/**
 * Forces a re-render once per second as long as `active` is true.
 * Used to drive countdown rendering for per-card hand reveals without
 * mutating shared state. Call sites pass `active = zones.hand.some(c =>
 * c.revealUntil && c.revealUntil > Date.now())` (or the opponent-side
 * equivalent).
 */
export function useRevealTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}
