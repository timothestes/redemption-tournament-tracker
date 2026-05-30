"use client";

import { useEffect } from "react";

/**
 * Keeps the screen awake while mounted (projector won't sleep mid-event).
 * Re-acquires on tab re-show, since browsers release the lock when hidden.
 * No-ops where the Wake Lock API is unavailable.
 */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        if ("wakeLock" in navigator) {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Denied or unsupported — acceptable, just no lock.
      }
    };

    request();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
    };
  }, []);
}
