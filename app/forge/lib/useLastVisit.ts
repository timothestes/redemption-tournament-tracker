"use client";

import { useEffect, useState } from "react";

// Epoch ms of the viewer's PREVIOUS visit to `key`, or null on a first visit.
// Drives "New" markers only — never a default filter, which would blank the
// view the moment you looked at it.
//
// The value is pinned in sessionStorage so the markers survive clicking into a
// card and coming back; localStorage advances once per browser session.
export function useLastVisit(key: string): number | null {
  const [lastVisit, setLastVisit] = useState<number | null>(null);
  useEffect(() => {
    try {
      const pinned = window.sessionStorage.getItem(key);
      if (pinned !== null) {
        setLastVisit(pinned === "" ? null : Number(pinned));
        return; // also makes StrictMode's second effect run a no-op
      }
      const stored = window.localStorage.getItem(key);
      const ms = stored ? Date.parse(stored) : NaN;
      const previous = Number.isFinite(ms) ? ms : null;
      window.sessionStorage.setItem(key, previous === null ? "" : String(previous));
      window.localStorage.setItem(key, new Date().toISOString());
      setLastVisit(previous);
    } catch {}
  }, [key]);
  return lastVisit;
}
