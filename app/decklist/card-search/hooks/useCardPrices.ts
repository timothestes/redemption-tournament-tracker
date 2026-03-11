'use client';

import { useState, useEffect } from 'react';
import type { PricesResponse } from '@/lib/pricing/types';

interface CardPriceInfo {
  price: number;
  shopify_handle: string;
  shopify_title: string;
}

let cachedPrices: PricesResponse['prices'] | null = null;
let fetchPromise: Promise<PricesResponse['prices']> | null = null;

async function fetchPrices(): Promise<PricesResponse['prices']> {
  if (cachedPrices) return cachedPrices;
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch('/api/prices')
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch prices');
      return res.json();
    })
    .then((data: PricesResponse) => {
      cachedPrices = data.prices;
      return data.prices;
    })
    .catch(() => {
      fetchPromise = null;
      return {} as PricesResponse['prices'];
    });

  return fetchPromise;
}

/**
 * Hook to access card prices. Fetches from /api/prices once and caches in memory.
 */
export function useCardPrices() {
  const [prices, setPrices] = useState<PricesResponse['prices']>(cachedPrices ?? {});
  const [isLoading, setIsLoading] = useState(!cachedPrices);

  useEffect(() => {
    if (cachedPrices) {
      setPrices(cachedPrices);
      setIsLoading(false);
      return;
    }

    fetchPrices().then(p => {
      setPrices(p);
      setIsLoading(false);
    });
  }, []);

  /**
   * Look up price info for a card by its key (name|set_code|img_file).
   */
  function getPrice(cardKey: string): CardPriceInfo | null {
    return prices[cardKey] ?? null;
  }

  /**
   * Get the YTG product URL for a card if we have a confirmed handle.
   */
  function getProductUrl(cardKey: string): string | null {
    const info = prices[cardKey];
    if (!info?.shopify_handle) return null;
    return `https://www.yourturngames.biz/products/${info.shopify_handle}`;
  }

  return { prices, isLoading, getPrice, getProductUrl };
}
