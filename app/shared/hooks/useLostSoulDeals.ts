'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { diffNewArrivals } from '../utils/lostSoulDeal';

export interface SoulDealState {
  /** Souls currently in flight → their stagger seq within the arrival batch. */
  inFlight: Map<string, number>;
  /** Call when a flyer finishes; reveals the settled node (removes from set). */
  onLand: (id: string) => void;
}

/**
 * Detects Lost Souls newly arriving in a Land-of-Bondage zone and tracks which
 * are mid-flight. The consumer:
 *   - hides the settled node for any id in `inFlight` (the flyer shows it),
 *   - renders a flyer per `inFlight` entry and calls `onLand(id)` when its
 *     tween finishes,
 *   - routes the arrival glow to the *visible* ids (lobIds minus inFlight) so
 *     the glow fires on landing, not on server placement.
 *
 * `ready` MUST gate initial-hydration detection: the SpacetimeDB subscription
 * pushes the whole LOB on load/reconnect; without the gate every pre-existing
 * soul would register as a new arrival. Pass `false` until subscription applied
 * (and `myPlayer` resolved), then `true`. Goldfish passes `true`.
 *
 * `onArrive` fires once per detected batch with the new ids (for a single
 * summarizing toast). It fires as the souls begin dealing (~one flight ahead of
 * landing) — close enough to "on land" without coordinating N flyer landings.
 *
 * Strict-mode safe: detection lives in refs, mirroring useLostSoulCinematic.
 */
export function useLostSoulDeals(
  soulIds: string[],
  ready: boolean,
  onArrive?: (newIds: string[]) => void,
): SoulDealState {
  const prevIdsRef = useRef<Set<string>>(new Set());
  const isInitialRef = useRef(true);
  const [inFlight, setInFlight] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!ready) return;

    const currentIds = new Set(soulIds);

    if (isInitialRef.current) {
      prevIdsRef.current = currentIds;
      isInitialRef.current = false;
      return;
    }

    const newIds = diffNewArrivals(prevIdsRef.current, soulIds);
    prevIdsRef.current = currentIds;

    // Prune any in-flight souls that left the LOB before landing (e.g. rescued
    // mid-flight) so we never leave a permanently hidden settled node.
    setInFlight((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of next.keys()) {
        if (!currentIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      newIds.forEach((id, i) => {
        if (!next.has(id)) {
          next.set(id, i);
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    if (newIds.length > 0) onArrive?.(newIds);
  }, [soulIds, ready, onArrive]);

  const onLand = useCallback((id: string) => {
    setInFlight((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return { inFlight, onLand };
}
