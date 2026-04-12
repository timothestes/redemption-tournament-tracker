'use client';

import { useState, useEffect } from 'react';
import {
  fetchDuplicateGroups,
  getSiblings,
  type DuplicateGroupIndex,
  type DuplicateSibling,
} from '@/lib/duplicateCards';

// Module-level cache — loaded once, shared across all hook instances
let cachedIndex: DuplicateGroupIndex | null = null;
let loadPromise: Promise<DuplicateGroupIndex> | null = null;

function loadIndex(): Promise<DuplicateGroupIndex> {
  if (cachedIndex) return Promise.resolve(cachedIndex);
  if (loadPromise) return loadPromise;
  loadPromise = fetchDuplicateGroups().then((index) => {
    cachedIndex = index;
    loadPromise = null;
    return index;
  });
  return loadPromise;
}

/**
 * Hook to get duplicate card siblings for a given card name.
 * Loads the full duplicate groups index once (cached), then does
 * instant local lookups per card.
 */
export function useDuplicateCards(cardName: string | null) {
  const [siblings, setSiblings] = useState<DuplicateSibling[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!cardName) {
      setSiblings(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    loadIndex().then((index) => {
      if (cancelled) return;
      const result = getSiblings(cardName, index);
      setSiblings(result);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cardName]);

  return { siblings, isLoading };
}
