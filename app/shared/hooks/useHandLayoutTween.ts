'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type Konva from 'konva';
import KonvaLib from 'konva';

export interface HandSlot {
  x: number;
  y: number;
  rotation: number;
}

/** How long existing cards glide to their new slot when the hand re-lays out. */
const HAND_REFLOW_MS = 200;

// Must run before paint: React commits the new slot positions onto the Konva
// nodes (an instant snap); this effect moves each node back to where it
// visually was and starts the glide — all in the same frame.
const useBeforePaintEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * FLIP-style smoothing for hand re-layout. When cards enter or leave the hand
 * (draws, plays, discards, fan/spread toggle), the remaining cards' slots all
 * shift and React snaps the nodes there instantly — a jerky lurch. This hook
 * glides each existing card from where it visually was to its new slot.
 *
 * How it works, per render:
 * 1. RENDER PHASE (hook body): snapshot every hand node's current position —
 *    at this point the commit hasn't run, so nodes still sit at their old
 *    slot, mid-glide position, or drag-drop point.
 * 2. COMMIT: react-konva applies the new slot props (instant snap, unpainted).
 * 3. LAYOUT EFFECT (pre-paint): any card whose slot changed is moved back to
 *    its snapshot position and tweened to the new slot.
 *
 * Cards without a registered node (mid-deal, face-down spectator backs) and
 * cards actively being dragged are left alone. A card's first appearance
 * never tweens — it simply renders in place (the deal sprite already animated
 * its arrival).
 */
export function useHandLayoutTween(
  slots: Map<string, HandSlot>,
  nodesRef: RefObject<Map<string, Konva.Group>>,
  enabled: boolean = true,
) {
  const prevTargetsRef = useRef<Map<string, HandSlot>>(new Map());
  const visualRef = useRef<Map<string, HandSlot>>(new Map());
  const tweensRef = useRef<Map<string, Konva.Tween>>(new Map());

  // Render-phase snapshot (see step 1 above). Reading external mutable Konva
  // state here is deliberate — it's the only moment the pre-commit positions
  // still exist. Idempotent, so strict-mode double renders are harmless.
  for (const id of slots.keys()) {
    const node = nodesRef.current?.get(id);
    if (node) {
      visualRef.current.set(id, { x: node.x(), y: node.y(), rotation: node.rotation() });
    }
  }

  useEffect(() => {
    return () => {
      for (const t of tweensRef.current.values()) t.destroy();
      tweensRef.current.clear();
    };
  }, []);

  useBeforePaintEffect(() => {
    const prevTargets = prevTargetsRef.current;
    const reduceMotion = prefersReducedMotion();

    for (const [id, target] of slots) {
      const prev = prevTargets.get(id);
      prevTargets.set(id, target);
      if (!prev) continue; // first appearance — no glide
      if (prev.x === target.x && prev.y === target.y && prev.rotation === target.rotation) {
        continue; // slot unchanged — leave any in-flight glide running
      }

      const node = nodesRef.current?.get(id);
      if (!node || node.isDragging() || !enabled || reduceMotion) continue;

      const from = visualRef.current.get(id) ?? prev;
      const existing = tweensRef.current.get(id);
      if (existing) existing.destroy();

      node.position({ x: from.x, y: from.y });
      node.rotation(from.rotation);
      const tween = new KonvaLib.Tween({
        node,
        duration: HAND_REFLOW_MS / 1000,
        x: target.x,
        y: target.y,
        rotation: target.rotation,
        easing: KonvaLib.Easings.EaseOut,
        onFinish: () => {
          tweensRef.current.delete(id);
        },
      });
      tweensRef.current.set(id, tween);
      tween.play();
    }

    // Drop bookkeeping for cards that left the hand.
    for (const id of [...prevTargets.keys()]) {
      if (!slots.has(id)) {
        prevTargets.delete(id);
        visualRef.current.delete(id);
        const t = tweensRef.current.get(id);
        if (t) {
          t.destroy();
          tweensRef.current.delete(id);
        }
      }
    }
  });
}
