'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'redemption-chat-scale';
const DEFAULT_SCALE = 1.0;
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.6;
const STEP = 0.1;

export function useChatScale() {
  const [chatScale, setChatScale] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_SCALE;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed >= MIN_SCALE && parsed <= MAX_SCALE) return parsed;
    }
    return DEFAULT_SCALE;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(chatScale));
  }, [chatScale]);

  const resetChatScale = useCallback(() => {
    setChatScale(DEFAULT_SCALE);
  }, []);

  return { chatScale, setChatScale, resetChatScale, MIN_SCALE, MAX_SCALE, STEP };
}
