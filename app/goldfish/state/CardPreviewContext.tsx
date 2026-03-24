'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';

const DEFAULT_STORAGE_KEY = 'goldfish-loupe-visible';

interface PreviewCard {
  cardName: string;
  cardImgFile: string;
  isMeek?: boolean;
}

interface CardPreviewContextValue {
  /** The card currently being previewed (hovered) */
  previewCard: PreviewCard | null;
  /** Set the preview card — called on mouseEnter, cleared on mouseLeave */
  setPreviewCard: (card: PreviewCard | null) => void;
  /** Whether the loupe panel is visible */
  isLoupeVisible: boolean;
  /** Toggle the loupe panel */
  toggleLoupe: () => void;
}

const CardPreviewContext = createContext<CardPreviewContextValue | null>(null);

export function CardPreviewProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY
}: {
  children: ReactNode;
  storageKey?: string;
}) {
  const [previewCard, setPreviewCard] = useState<PreviewCard | null>(null);
  const [isLoupeVisible, setIsLoupeVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(storageKey);
    // Default to true for first-time users on desktop
    if (stored === null) return window.innerWidth >= 1200;
    return stored === 'true';
  });

  const toggleLoupe = useCallback(() => {
    setIsLoupeVisible(prev => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);

  // Auto-hide on narrow viewports
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1200) {
        setIsLoupeVisible(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const value = useMemo(
    () => ({ previewCard, setPreviewCard, isLoupeVisible, toggleLoupe }),
    [previewCard, isLoupeVisible, toggleLoupe]
  );

  return (
    <CardPreviewContext.Provider value={value}>
      {children}
    </CardPreviewContext.Provider>
  );
}

export function useCardPreview() {
  const ctx = useContext(CardPreviewContext);
  if (!ctx) throw new Error('useCardPreview must be used within a CardPreviewProvider');
  return ctx;
}
