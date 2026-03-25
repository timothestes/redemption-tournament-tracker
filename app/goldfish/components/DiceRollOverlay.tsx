'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { DiceOverlay } from '../../shared/components/DiceOverlay';

// --- Global event system (preserved for goldfish keyboard shortcuts + toolbar) ---
type RollListener = (value: number) => void;
const rollListeners: RollListener[] = [];

export function triggerDiceRoll() {
  const result = Math.floor(Math.random() * 6) + 1;
  rollListeners.forEach(fn => fn(result));
  return result;
}

/**
 * Goldfish adapter — listens for the global `triggerDiceRoll()` event
 * and feeds results into the shared DiceOverlay component.
 */
export function DiceRollOverlay() {
  const [result, setResult] = useState<number | null>(null);
  const rollCountRef = useRef(0);

  useEffect(() => {
    const handler: RollListener = (value) => {
      // Increment roll count so the shared component sees a new result even
      // if the same number is rolled twice in a row.
      rollCountRef.current++;
      setResult(value);
    };

    rollListeners.push(handler);
    return () => {
      const idx = rollListeners.indexOf(handler);
      if (idx >= 0) rollListeners.splice(idx, 1);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setResult(null);
  }, []);

  return (
    <DiceOverlay
      result={result}
      sides={6}
      onDismiss={handleDismiss}
    />
  );
}
