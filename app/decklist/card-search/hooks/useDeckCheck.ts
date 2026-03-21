"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Deck } from "../types/deck";
import type { DeckCheckResult, DeckCheckCard } from "@/utils/deckcheck/types";

const DEBOUNCE_MS = 800;

export function useDeckCheck(deck: Deck) {
  const [result, setResult] = useState<DeckCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runDeckCheck = useCallback(
    async (cards: DeckCheckCard[], reserve: DeckCheckCard[], format: string) => {
      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsChecking(true);

      try {
        const res = await fetch("/api/deckcheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cards, reserve, format }),
          signal: controller.signal,
        });

        if (!res.ok) {
          console.error("Deck check failed:", res.status);
          return;
        }

        const data: DeckCheckResult = await res.json();
        setResult(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Request was cancelled — expected when a newer check supersedes it
          return;
        }
        console.error("Deck check error:", err);
      } finally {
        // Only clear isChecking if this controller wasn't replaced
        if (abortControllerRef.current === controller) {
          setIsChecking(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    // Clear any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // No cards — reset result and skip the check
    if (deck.cards.length === 0) {
      setResult(null);
      setIsChecking(false);
      return;
    }

    // Convert DeckCard[] into the API's DeckCheckCard format
    const mainCards: DeckCheckCard[] = [];
    const reserveCards: DeckCheckCard[] = [];

    for (const dc of deck.cards) {
      const entry: DeckCheckCard = {
        name: dc.card.name,
        set: dc.card.set,
        quantity: dc.quantity,
      };
      if (dc.isReserve) {
        reserveCards.push(entry);
      } else {
        mainCards.push(entry);
      }
    }

    const format = deck.format ?? "Type 1";

    debounceTimerRef.current = setTimeout(() => {
      runDeckCheck(mainCards, reserveCards, format);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [deck.cards, deck.format, runDeckCheck]);

  // Cleanup on unmount: cancel pending timer and in-flight request
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { result, isChecking, setResult };
}
