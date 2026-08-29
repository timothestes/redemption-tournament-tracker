'use client';

import { useState, useEffect } from 'react';
import { resolveInputMode, parseInputOverride, type InputMode } from '@/app/shared/layout/inputMode';

export type { InputMode };

const COARSE_QUERY = '(pointer: coarse)';

/**
 * Reactive pointer/touch detection.
 *
 * Uses `(pointer: coarse)` rather than UA sniffing so hybrid devices (iPad
 * with a trackpad, Surface) resolve correctly and can change mid-session.
 * SSR-safe: returns 'pointer' until mounted.
 */
export function useInputMode(): InputMode {
  const [mode, setMode] = useState<InputMode>('pointer');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const override = parseInputOverride(window.location.search);
    const mq = window.matchMedia(COARSE_QUERY);
    const update = () => setMode(resolveInputMode(mq.matches, override));
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return mode;
}
