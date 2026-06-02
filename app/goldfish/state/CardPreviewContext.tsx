'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';

const DEFAULT_STORAGE_KEY = 'goldfish-loupe-visible';

interface PreviewCard {
  cardName: string;
  cardImgFile: string;
  isMeek?: boolean;
  notes?: string;
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
  /** When true, suppress the 180° rotation applied to meek cards in previews so
   *  the opponent can read the card right-side-up. Toggled momentarily by the
   *  eye-icon overlay rendered on hovered meek cards. */
  isPreviewFlipped: boolean;
  setPreviewFlipped: (flipped: boolean) => void;
}

const CardPreviewContext = createContext<CardPreviewContextValue | null>(null);

export function CardPreviewProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY,
  defaultVisible,
}: {
  children: ReactNode;
  storageKey?: string;
  /** When true, always start expanded (on desktop) regardless of stored preference */
  defaultVisible?: boolean;
}) {
  const [previewCard, setPreviewCard] = useState<PreviewCard | null>(null);
  const [isPreviewFlipped, setIsPreviewFlipped] = useState(false);
  const [isLoupeVisible, setIsLoupeVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (defaultVisible) return window.innerWidth >= 1200;
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

  // Reset the flip when the previewed card goes away (e.g. cursor leaves the
  // canvas). Switching between meek cards is handled by the eye icon's own
  // mouseLeave, so we don't reset on every preview-card change.
  useEffect(() => {
    if (!previewCard) setIsPreviewFlipped(false);
  }, [previewCard]);

  const value = useMemo(
    () => ({
      previewCard,
      setPreviewCard,
      isLoupeVisible,
      toggleLoupe,
      isPreviewFlipped,
      setPreviewFlipped: setIsPreviewFlipped,
    }),
    [previewCard, isLoupeVisible, toggleLoupe, isPreviewFlipped]
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
