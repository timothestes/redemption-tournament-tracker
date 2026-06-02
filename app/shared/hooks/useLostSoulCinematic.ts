'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SoulCinematicCard {
  instanceId: string;
  cardName: string;
  cardImgFile: string;
}

export interface SoulCinematicBatch {
  id: string;
  souls: SoulCinematicCard[];
}

/**
 * Total time an active batch is held before auto-advancing to the next queued
 * batch (or clearing). Matches the CSS animation timeline in globals.css
 * (`@keyframes lsc-card-in` et al). Reduced-motion uses the same wall-clock
 * duration so the queue advances at a predictable rate either way.
 */
const BATCH_HOLD_MS = 900;

/**
 * Detects newly arrived Lost Souls in a Land-of-Bondage zone and emits batched
 * cinematic events. Souls arriving in the same React tick are grouped into a
 * single batch. If a new batch arrives while one is playing, it queues behind it.
 *
 * The caller is responsible for filtering the input to actual Lost Souls — the
 * hook treats every input card as one and triggers on any new arrival.
 *
 * `ready` MUST gate the initial-hydration detection. In multiplayer the
 * SpacetimeDB subscription pushes the entire LOB in one batch on game load /
 * reconnect; without this gate every pre-existing soul would register as a
 * "new arrival" and fire the cinematic on connect. Pass `false` until the
 * subscription has applied (and `myPlayer` is resolved), then `true`.
 *
 * The dismiss timer lives in the hook (not the consumer component) so that
 * React 18 strict-mode's effect double-invocation doesn't cause a premature
 * dismiss when the consumer mounts.
 */
export function useLostSoulCinematic(
  lobSouls: SoulCinematicCard[],
  ready: boolean = true,
) {
  const prevIdsRef = useRef<Set<string>>(new Set());
  const isInitialRef = useRef(true);
  const queueRef = useRef<SoulCinematicBatch[]>([]);
  const activeBatchRef = useRef<SoulCinematicBatch | null>(null);
  const [activeBatch, _setActiveBatch] = useState<SoulCinematicBatch | null>(null);

  const setActiveBatch = useCallback((b: SoulCinematicBatch | null) => {
    activeBatchRef.current = b;
    _setActiveBatch(b);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const currentIds = new Set(lobSouls.map(s => s.instanceId));

    if (isInitialRef.current) {
      prevIdsRef.current = currentIds;
      isInitialRef.current = false;
      return;
    }

    const prev = prevIdsRef.current;
    const newSouls = lobSouls.filter(s => !prev.has(s.instanceId));
    prevIdsRef.current = currentIds;

    if (newSouls.length === 0) return;

    const batch: SoulCinematicBatch = {
      id: `soul-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      souls: newSouls,
    };

    if (activeBatchRef.current) {
      queueRef.current.push(batch);
    } else {
      setActiveBatch(batch);
    }
  }, [lobSouls, ready, setActiveBatch]);

  // Auto-advance the active batch after BATCH_HOLD_MS. Owning this in the
  // hook (vs. the component) avoids strict-mode false dismissal: the
  // component's mount → cleanup → mount cycle would otherwise treat the
  // intermediate cleanup as a "real unmount" and fire onComplete immediately.
  useEffect(() => {
    if (!activeBatch) return;
    const t = setTimeout(() => {
      const next = queueRef.current.shift() ?? null;
      setActiveBatch(next);
    }, BATCH_HOLD_MS);
    return () => clearTimeout(t);
  }, [activeBatch, setActiveBatch]);

  return { activeBatch };
}
