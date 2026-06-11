"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "../../decklist/card-search/utils";
import {
  bulkImportCollectionAction,
  clearCollectionAction,
  loadCollectionAction,
  setCollectionCardQuantityAction,
  type CollectionCardRow,
} from "../actions";

export function cardFullKey(card: Pick<Card, "name" | "set" | "imgFile">): string {
  return `${card.name}|${card.set}|${card.imgFile}`;
}

const PERSIST_DEBOUNCE_MS = 600;

/**
 * Client state for the user's collection: a Map of fullKey -> quantity with
 * optimistic updates and per-card debounced persistence. The full collection
 * is loaded once (server action paginates past the 1000-row limit).
 *
 * Pass `enabled: false` to skip loading (e.g. signed-out users in the deck
 * builder); `isAvailable` is true once a load has succeeded.
 */
export function useCollectionState({ enabled = true }: { enabled?: boolean } = {}) {
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(enabled);
  const [isAvailable, setIsAvailable] = useState(false);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestQtyRef = useRef<Map<string, { card: Card; quantity: number }>>(new Map());

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await loadCollectionAction();
      if (result.success) {
        const map = new Map<string, number>();
        for (const row of result.cards) {
          map.set(`${row.card_name}|${row.card_set}|${row.card_img_file}`, row.quantity);
        }
        setQuantities(map);
        setIsAvailable(true);
        setSyncError(null);
      } else {
        setSyncError(result.error || "Failed to load collection");
      }
    } catch {
      // Aborted (e.g. by a concurrent client navigation) or network error.
      // The watchdog effect below will retry while still enabled.
      setSyncError("Failed to load collection");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on enable, then keep retrying until the collection is actually
  // available. In the deck builder, the first load races with the deck's
  // router.replace navigation, which can abort the server action; a single
  // attempt would leave the collection permanently unavailable. Retry a
  // bounded number of times until isAvailable flips true.
  useEffect(() => {
    if (!enabled || isAvailable) return;
    let attempts = 0;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      attempts++;
      reload();
    };
    run();
    const interval = setInterval(() => {
      if (cancelled || isAvailable || attempts >= 5) {
        clearInterval(interval);
        return;
      }
      run();
    }, 1200);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, isAvailable, reload]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const persistCard = useCallback(async (key: string) => {
    const pending = latestQtyRef.current.get(key);
    if (!pending) return;
    latestQtyRef.current.delete(key);
    setPendingSaves((n) => n + 1);
    const { card, quantity } = pending;
    const result = await setCollectionCardQuantityAction(
      card.name,
      card.set,
      card.imgFile,
      quantity
    );
    setPendingSaves((n) => n - 1);
    if (!result.success) {
      setSyncError(result.error || "Failed to save change");
    }
  }, []);

  const setQuantity = useCallback(
    (card: Card, quantity: number) => {
      const clamped = Math.max(0, Math.min(9999, Math.floor(quantity) || 0));
      const key = cardFullKey(card);

      setQuantities((prev) => {
        const next = new Map(prev);
        if (clamped <= 0) next.delete(key);
        else next.set(key, clamped);
        return next;
      });

      latestQtyRef.current.set(key, { card, quantity: clamped });
      const existing = timersRef.current.get(key);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        key,
        setTimeout(() => {
          timersRef.current.delete(key);
          persistCard(key);
        }, PERSIST_DEBOUNCE_MS)
      );
    },
    [persistCard]
  );

  const adjustQuantity = useCallback(
    (card: Card, delta: number) => {
      const key = cardFullKey(card);
      const current = quantities.get(key) || 0;
      setQuantity(card, current + delta);
    },
    [quantities, setQuantity]
  );

  const importRows = useCallback(
    async (rows: { card: Card; quantity: number }[], mode: "merge" | "replace") => {
      const payload: CollectionCardRow[] = rows.map(({ card, quantity }) => ({
        card_name: card.name,
        card_set: card.set,
        card_img_file: card.imgFile,
        quantity,
      }));
      const result = await bulkImportCollectionAction(payload, mode);
      if (result.success) {
        await reload();
      }
      return result;
    },
    [reload]
  );

  const clearCollection = useCallback(async () => {
    const result = await clearCollectionAction();
    if (result.success) {
      setQuantities(new Map());
    } else {
      setSyncError(result.error || "Failed to clear collection");
    }
    return result;
  }, []);

  return {
    quantities,
    isLoading,
    isAvailable,
    isSaving: pendingSaves > 0,
    syncError,
    setQuantity,
    adjustQuantity,
    importRows,
    clearCollection,
    reload,
  };
}
