'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Duration (ms) that the glow stays marked on an arriving card. The Konva tween
 * in GameCardNode animates the visuals; this just clears the flag afterwards.
 */
const GLOW_DURATION_MS = 2000;

/**
 * Tracks cards arriving in the Land of Bondage zone and returns a glow flag
 * per instance ID. No toasts are emitted — the card's visual arrival plus the
 * glow (and the game log entry for the MOVE_CARD action) are sufficient signal.
 *
 * Works for both goldfish (string IDs) and multiplayer (bigint IDs converted to string).
 *
 * @param lobCardIds - Current array of card instance IDs in the LOB zone
 * @param options.enabled - Whether to track arrivals (default true)
 */
export function useLobArrivalEffect(
  lobCardIds: string[],
  options?: {
    enabled?: boolean;
  },
) {
  const enabled = options?.enabled ?? true;

  // Track which IDs we've seen before, so we can detect new arrivals
  const prevIdsRef = useRef<Set<string>>(new Set());
  // Whether this is the first render (skip glow on initial load)
  const isInitialRef = useRef(true);

  // Set of instance IDs that are currently glowing
  const [glowingIds, setGlowingIds] = useState<Set<string>>(new Set());

  // Stable ref for timeout cleanup
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      for (const t of timeoutsRef.current.values()) {
        clearTimeout(t);
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      prevIdsRef.current = new Set(lobCardIds);
      isInitialRef.current = false;
      return;
    }

    const currentIds = new Set(lobCardIds);
    const prevIds = prevIdsRef.current;

    // On initial render, just record the IDs without triggering effects
    if (isInitialRef.current) {
      prevIdsRef.current = currentIds;
      isInitialRef.current = false;
      return;
    }

    // Find newly arrived cards (in current but not in previous)
    const newArrivals: string[] = [];
    for (const id of currentIds) {
      if (!prevIds.has(id)) {
        newArrivals.push(id);
      }
    }

    if (newArrivals.length > 0) {
      // Add to glowing set
      setGlowingIds(prev => {
        const next = new Set(prev);
        for (const id of newArrivals) {
          next.add(id);
        }
        return next;
      });

      // Schedule removal after animation duration
      for (const id of newArrivals) {
        // Clear existing timeout for this ID if re-triggered
        const existing = timeoutsRef.current.get(id);
        if (existing) clearTimeout(existing);

        const t = setTimeout(() => {
          setGlowingIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          timeoutsRef.current.delete(id);
        }, GLOW_DURATION_MS);

        timeoutsRef.current.set(id, t);
      }
    }

    prevIdsRef.current = currentIds;
  }, [lobCardIds, enabled]);

  /**
   * Returns a glow intensity (0-1) for a given card instance ID.
   * 0 = no glow, 1 = full glow. The actual animation is handled by
   * the Konva Tween in GameCardNode.
   */
  const getGlowIntensity = useCallback(
    (instanceId: string): number => {
      return glowingIds.has(instanceId) ? 1 : 0;
    },
    [glowingIds],
  );

  return { glowingIds, getGlowIntensity };
}
