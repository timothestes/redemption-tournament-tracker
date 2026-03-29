'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'redemption-card-scale';
const DEFAULT_SCALE = 1.0;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.4;
const STEP = 0.1;

export function useCardScale() {
  const [cardScale, setCardScale] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_SCALE;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed >= MIN_SCALE && parsed <= MAX_SCALE) return parsed;
    }
    return DEFAULT_SCALE;
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(cardScale));
  }, [cardScale]);

  const zoomIn = useCallback(() => {
    setCardScale(prev => Math.min(MAX_SCALE, Math.round((prev + STEP) * 10) / 10));
  }, []);

  const zoomOut = useCallback(() => {
    setCardScale(prev => Math.max(MIN_SCALE, Math.round((prev - STEP) * 10) / 10));
  }, []);

  const resetScale = useCallback(() => {
    setCardScale(DEFAULT_SCALE);
  }, []);

  return { cardScale, zoomIn, zoomOut, resetScale, MIN_SCALE, MAX_SCALE, STEP, setCardScale };
}
