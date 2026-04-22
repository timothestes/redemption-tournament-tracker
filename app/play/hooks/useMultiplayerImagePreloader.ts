'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseMultiplayerImagePreloaderReturn {
  getImage: (url: string) => HTMLImageElement | null;
  isReady: boolean;
  progress: number;
  /**
   * Returns true iff every URL in the given subset has settled — either
   * cached successfully, or failed past its retry budget. Useful for gating
   * UI on "the cards the user actually needs to see" rather than every
   * card in the game.
   */
  areUrlsLoaded: (subsetUrls: string[]) => boolean;
}

// Max parallel image requests. Browsers cap concurrent connections per host
// (~6 for HTTP/1.1, higher for HTTP/2) — staying low keeps slow-wifi users
// from drowning in a request queue where everything times out together.
const MAX_CONCURRENT = 6;

// Per-image load timeout. On slow connections `new Image()` requests can sit
// pending for 30s+ without ever firing onload/onerror; we'd rather abort and
// retry. 10s is long enough for a genuinely slow fetch, short enough that a
// stuck request doesn't block the queue.
const LOAD_TIMEOUT_MS = 10_000;

// Max retries after timeout or network error. Two extra attempts recovers
// from transient blob-CDN hiccups without hammering a truly-missing URL.
const MAX_RETRIES = 2;

// Backoff before retry (ms, indexed by attempt number after the first).
const RETRY_BACKOFF_MS = [1_500, 4_000];

/**
 * Progressive image preloader for multiplayer games.
 *
 * Accepts URLs ordered by priority (earlier = higher). Maintains a throttled
 * queue that never exceeds MAX_CONCURRENT in-flight requests, with per-image
 * timeout and exponential-backoff retry on failure. Once an image finishes,
 * a version counter bumps so consumers pick up the new `getImage(url)` result.
 */
export function useMultiplayerImagePreloader(
  urls: string[],
): UseMultiplayerImagePreloaderReturn {
  // Successful loads — survives re-renders, never replaced.
  const imageMapRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // URLs waiting for a slot. Drained by pump() in insertion order.
  const queueRef = useRef<string[]>([]);

  // URLs currently in-flight (their slot in the MAX_CONCURRENT budget).
  const runningRef = useRef<Set<string>>(new Set());

  // How many times each URL has failed so far.
  const failureCountRef = useRef<Map<string, number>>(new Map());

  // Pending retry timers so we can clear them on unmount.
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Every URL we've ever seen — lets us detect new URLs in later renders.
  const knownUrlsRef = useRef<Set<string>>(new Set());

  // Counters for progress/isReady.
  const loadedCountRef = useRef(0);
  const totalCountRef = useRef(0);

  const [version, setVersion] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // pump() is defined below but called from startLoad's callbacks. Using a ref
  // lets startLoad's closures call whichever version of pump is current.
  const pumpRef = useRef<() => void>(() => {});

  const startLoad = useCallback((url: string) => {
    if (imageMapRef.current.has(url) || runningRef.current.has(url)) return;
    runningRef.current.add(url);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;

    const finishSuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      imageMapRef.current.set(url, img);
      runningRef.current.delete(url);
      failureCountRef.current.delete(url);
      loadedCountRef.current++;
      setVersion((v) => v + 1);
      pumpRef.current();
    };

    const finishFailure = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      runningRef.current.delete(url);

      const attempts = (failureCountRef.current.get(url) ?? 0) + 1;
      failureCountRef.current.set(url, attempts);

      if (attempts <= MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[attempts - 1] ?? 4_000;
        const timer = setTimeout(() => {
          retryTimersRef.current.delete(url);
          if (!imageMapRef.current.has(url) && !runningRef.current.has(url)) {
            queueRef.current.push(url);
            pumpRef.current();
          }
        }, backoff);
        retryTimersRef.current.set(url, timer);
      } else {
        // Gave up. Count toward total so progress/isReady can still settle.
        loadedCountRef.current++;
        setVersion((v) => v + 1);
      }
      pumpRef.current();
    };

    const timeoutId = setTimeout(() => {
      // Best-effort abort: clearing src signals the browser to cancel.
      img.src = '';
      finishFailure();
    }, LOAD_TIMEOUT_MS);

    img.onload = finishSuccess;
    img.onerror = finishFailure;
    img.src = url;
  }, []);

  const pump = useCallback(() => {
    while (
      runningRef.current.size < MAX_CONCURRENT &&
      queueRef.current.length > 0
    ) {
      const url = queueRef.current.shift()!;
      if (imageMapRef.current.has(url) || runningRef.current.has(url)) continue;
      startLoad(url);
    }
  }, [startLoad]);
  pumpRef.current = pump;

  // Enqueue newly-seen URLs (preserving caller-provided priority order).
  useEffect(() => {
    if (urls.length === 0) return;

    let addedToTotal = 0;
    for (const url of urls) {
      if (knownUrlsRef.current.has(url)) continue;
      knownUrlsRef.current.add(url);
      addedToTotal++;

      if (imageMapRef.current.has(url) || runningRef.current.has(url)) continue;
      queueRef.current.push(url);
    }

    if (addedToTotal > 0) {
      totalCountRef.current += addedToTotal;
      pump();
      // Bump version so consumers relying on progress re-read.
      setVersion((v) => v + 1);
    }
  }, [urls, pump]);

  // Flip isReady once the initial batch settles (covers every URL we know
  // about). `version` is the trigger — it bumps whenever a load finishes.
  useEffect(() => {
    void version;
    if (isReady) return;
    if (totalCountRef.current === 0) return;
    if (loadedCountRef.current >= totalCountRef.current) {
      setIsReady(true);
    }
  }, [isReady, version]);

  // Cancel pending retry timers on unmount.
  useEffect(() => {
    const timers = retryTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const areUrlsLoaded = useCallback((subsetUrls: string[]): boolean => {
    for (const url of subsetUrls) {
      if (imageMapRef.current.has(url)) continue;
      // Given up after exhausting retries counts as "settled" — we can't
      // wait forever for a URL that's going to keep 404ing.
      const failures = failureCountRef.current.get(url) ?? 0;
      if (failures > MAX_RETRIES) continue;
      return false;
    }
    return true;
  }, []);

  const getImage = useCallback((url: string): HTMLImageElement | null => {
    const cached = imageMapRef.current.get(url);
    if (cached) return cached;

    // Unknown URL — enqueue it at the front of the queue (on-demand lookups
    // are inherently high-priority: a consumer is asking about it *right now*).
    if (!knownUrlsRef.current.has(url)) {
      knownUrlsRef.current.add(url);
      totalCountRef.current++;
      queueRef.current.unshift(url);
      pumpRef.current();
    }
    return null;
  }, []);

  return {
    getImage,
    isReady,
    progress:
      totalCountRef.current > 0
        ? Math.min(loadedCountRef.current / totalCountRef.current, 1)
        : 1,
    areUrlsLoaded,
  };
}
