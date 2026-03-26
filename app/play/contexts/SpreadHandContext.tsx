'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

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
  const toggleSpreadHand = useCallback(() => setIsSpreadHand((v) => !v), []);
  return (
    <SpreadHandContext.Provider value={{ isSpreadHand, toggleSpreadHand }}>
      {children}
    </SpreadHandContext.Provider>
  );
}

export function useSpreadHand() {
  return useContext(SpreadHandContext);
}
