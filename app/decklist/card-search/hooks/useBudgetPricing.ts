'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  fetchDuplicateGroups,
  type DuplicateGroupIndex,
} from '@/lib/duplicateCards';
import {
  findCheapestEquivalent,
  buildCardNameIndex,
  type BudgetCard,
} from '@/lib/pricing/budgetPricing';
import { useCardPrices } from './useCardPrices';
import type { Deck } from '../types/deck';

// ---------------------------------------------------------------------------
// Module-level cache for the duplicate group index
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BudgetPricingResult {
  budgetTotal: number | null;
  savings: number | null;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Computes the budget total for a deck by finding the cheapest equivalent
 * printing for each card (same canonical identity, same ability text).
 *
 * Returns:
 * - `budgetTotal` — total cost using cheapest printings
 * - `savings` — how much cheaper that is vs. the deck's own printings
 * - `isLoading` — true while prices or duplicate index are still loading
 */
export function useBudgetPricing(deck: Deck, allCards: BudgetCard[]): BudgetPricingResult {
  const { prices, isLoading: pricesLoading, getPrice } = useCardPrices();

  const [dupIndex, setDupIndex] = useState<DuplicateGroupIndex | null>(cachedIndex);
  const [indexLoading, setIndexLoading] = useState(!cachedIndex);

  // Load duplicate group index once
  useEffect(() => {
    if (cachedIndex) {
      setDupIndex(cachedIndex);
      setIndexLoading(false);
      return;
    }

    let cancelled = false;
    loadIndex().then((index) => {
      if (cancelled) return;
      setDupIndex(index);
      setIndexLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Build the card name index once per allCards reference — O(1) lookups
  const cardNameIndex = useMemo(
    () => buildCardNameIndex(allCards),
    [allCards],
  );

  // Wrap getPrice so it matches the (key) => number | null signature that
  // findCheapestEquivalent expects (rather than returning a CardPriceInfo object).
  // Using `prices` as the memo dependency instead of `getPrice` (which is a new
  // function reference on every render) keeps this stable after prices load.
  const getPriceNumber = useMemo(
    () => (cardKey: string): number | null => getPrice(cardKey)?.price ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prices],
  );

  const result = useMemo<BudgetPricingResult>(() => {
    const isLoading = pricesLoading || indexLoading;

    if (isLoading || !dupIndex) {
      return { budgetTotal: null, savings: null, isLoading: true };
    }

    let exactTotal = 0;
    let budgetTotal = 0;
    let hasPricedCard = false;

    for (const deckCard of deck.cards) {
      const { card, quantity } = deckCard;

      const budgetCard: BudgetCard = {
        name: card.name,
        set: card.set,
        imgFile: card.imgFile,
        specialAbility: card.specialAbility,
      };

      const { ownPrice, cheapestPrice } = findCheapestEquivalent(
        budgetCard,
        allCards,
        dupIndex,
        getPriceNumber,
        cardNameIndex,
      );

      if (ownPrice !== null) {
        // Card itself has a price — use it for exact total; use min for budget
        exactTotal += ownPrice * quantity;
        budgetTotal += Math.min(ownPrice, cheapestPrice ?? ownPrice) * quantity;
        hasPricedCard = true;
      } else if (cheapestPrice !== null) {
        // Card has no own price but a sibling does — add sibling price to BOTH
        // so the comparison is apples-to-apples
        exactTotal += cheapestPrice * quantity;
        budgetTotal += cheapestPrice * quantity;
        hasPricedCard = true;
      }
      // If neither has a price, skip this card entirely in both totals
    }

    if (!hasPricedCard) {
      return { budgetTotal: null, savings: null, isLoading: false };
    }

    const rawSavings = exactTotal - budgetTotal;
    const savings = rawSavings > 0.005 ? rawSavings : null;

    return { budgetTotal, savings, isLoading: false };
  }, [deck, allCards, dupIndex, getPriceNumber, cardNameIndex, pricesLoading, indexLoading]);

  return result;
}
