"use client";

import { useCallback, useEffect, useState } from "react";

// Remembers one boolean per key. Server render and the first client render both
// return `initial` (no hydration mismatch); the stored value is adopted in an
// effect. Blocked storage (private mode) keeps the default.
export function useLocalStorageFlag(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(stored === "1");
    } catch {
      // storage blocked — keep the default
    }
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // storage blocked — state still flips for this session
      }
    },
    [key]
  );
  return [value, set];
}
