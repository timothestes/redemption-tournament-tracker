'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

const STORAGE_KEY = 'lor-spread-hand';

interface SpreadHandContextValue {
  isSpreadHand: boolean;
  toggleSpreadHand: () => void;
}

const SpreadHandContext = createContext<SpreadHandContextValue>({
  isSpreadHand: false,
  toggleSpreadHand: () => {},
});

export function SpreadHandProvider({ children }: { children: ReactNode }) {
  const [isSpreadHand, setIsSpreadHand] = useState(false);

  useEffect(() => {
    try {
      setIsSpreadHand(localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // ignore storage errors
    }
  }, []);

  const toggleSpreadHand = useCallback(() => {
    setIsSpreadHand((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  return (
    <SpreadHandContext.Provider value={{ isSpreadHand, toggleSpreadHand }}>
      {children}
    </SpreadHandContext.Provider>
  );
}

export function useSpreadHand() {
  return useContext(SpreadHandContext);
}
