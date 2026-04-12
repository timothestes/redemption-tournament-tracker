'use client';

import { useState, useEffect, useCallback } from 'react';

export interface CardRuling {
  id: string;
  card_name: string;
  question: string;
  answer: string;
  source: string;
  ruling_date: string | null;
}

// In-memory cache keyed by card_name
const cache = new Map<string, CardRuling[]>();

/**
 * Hook to fetch rulings for a specific card name.
 * Caches results in memory to avoid refetching on modal navigation.
 */
export function useCardRulings(cardName: string | null) {
  const [rulings, setRulings] = useState<CardRuling[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRulings = useCallback((name: string) => {
    setIsLoading(true);
    fetch(`/api/rulings?card_name=${encodeURIComponent(name)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch rulings');
        return res.json();
      })
      .then((data) => {
        const result = data.rulings || [];
        cache.set(name, result);
        setRulings(result);
      })
      .catch(() => {
        setRulings([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!cardName) {
      setRulings([]);
      return;
    }

    const cached = cache.get(cardName);
    if (cached) {
      setRulings(cached);
      return;
    }

    fetchRulings(cardName);
  }, [cardName, fetchRulings]);

  const refetch = useCallback(() => {
    if (!cardName) return;
    cache.delete(cardName);
    fetchRulings(cardName);
  }, [cardName, fetchRulings]);

  return { rulings, isLoading, refetch };
}
