'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { diffDealtSouls } from '../utils/lostSoulDeal';

export interface SoulDealState {
  /** Souls currently in flight → their stagger seq within the arrival batch. */
  inFlight: Map<string, number>;
  /** Call when a flyer finishes; reveals the settled node (removes from set). */
  onLand: (id: string) => void;
}

/**
 * Detects Lost Souls dealt from the deck into a Land-of-Bondage zone and tracks
 * which are mid-flight. A soul only "deals" when its previous zone was a deck
 * source (`deckSourceIds`) — a draw or auto-route. Souls dragged in from hand /
 * reserve / territory don't fly from the deck; they just appear where dropped.
 * The consumer:
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
 * `onArrive` fires once per detected batch with the dealt ids (for a single
 * summarizing toast). It fires as the souls begin dealing (~one flight ahead of
 * landing) — close enough to "on land" without coordinating N flyer landings.
 *
 * Strict-mode safe: detection lives in refs (prev-ids + is-initial gate).
 */
export function useLostSoulDeals(
  soulIds: string[],
  deckSourceIds: string[],
  ready: boolean,
  onArrive?: (newIds: string[]) => void,
): SoulDealState {
  const prevLobIdsRef = useRef<Set<string>>(new Set());
  const prevDeckIdsRef = useRef<Set<string>>(new Set());
  const isInitialRef = useRef(true);
  const [inFlight, setInFlight] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!ready) return;

    const currentIds = new Set(soulIds);

    if (isInitialRef.current) {
      prevLobIdsRef.current = currentIds;
      prevDeckIdsRef.current = new Set(deckSourceIds);
      isInitialRef.current = false;
      return;
    }

    // Only souls that were in the deck last frame count as dealt — excludes
    // drags in from hand/reserve/territory (see diffDealtSouls).
    const newIds = diffDealtSouls(prevLobIdsRef.current, prevDeckIdsRef.current, soulIds);
    prevLobIdsRef.current = currentIds;
    prevDeckIdsRef.current = new Set(deckSourceIds);

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
  }, [soulIds, deckSourceIds, ready, onArrive]);

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
