"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * App-wide "show prices" preference, shared between the deck builder and the
 * collection page. Backed by a single localStorage key and synced live across
 * components in the same tab (custom event) and across tabs (storage event).
 */
const KEY = "show-prices";
const EVENT = "show-prices-change";

// One-time migration: seed the unified key from the older per-feature keys so
// existing users keep their preference.
if (typeof window !== "undefined" && localStorage.getItem(KEY) === null) {
  const legacy =
    localStorage.getItem("deck-show-prices") === "true" ||
    localStorage.getItem("collection-show-prices") === "1";
  if (legacy) localStorage.setItem(KEY, "true");
}

function getSnapshot(): boolean {
  return localStorage.getItem(KEY) === "true";
}

// Server render and first client render both return false → no hydration mismatch.
function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useShowPrices(): [boolean, (value: boolean) => void] {
  const showPrices = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setShowPrices = useCallback((value: boolean) => {
    localStorage.setItem(KEY, String(value));
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [showPrices, setShowPrices];
}
