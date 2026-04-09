'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseMultiplayerImagePreloaderReturn {
  getImage: (url: string) => HTMLImageElement | null;
  isReady: boolean;
  progress: number;
}

/**
 * Progressive image preloader for multiplayer games.
 *
 * Phase 1 — mount: loads all URLs in the initial batch (your deck).
 * Phase 2 — urls grows: loads new URLs added after opponent joins.
 * Phase 3 — on demand: lazy-loads any URL not yet cached when getImage() is called.
 *
 * The image map lives in a ref so individual image loads never trigger re-renders.
 * A version counter triggers a single state update when a batch completes.
 */
export function useMultiplayerImagePreloader(
  urls: string[],
): UseMultiplayerImagePreloaderReturn {
  // Stable cache — survives re-renders, never replaced.
  const imageMapRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Counts how many of the *currently known* URLs have finished (load or error).
  const loadedCountRef = useRef(0);

  // Total known URLs (kept in sync with urls.length for progress calculation).
  const totalCountRef = useRef(0);

  // Track whether the initial batch has completed.
  const initialBatchDoneRef = useRef(false);

  // Single numeric state — bumped to force one re-render when a batch finishes.
  const [version, setVersion] = useState(0);

  // Track in-flight batch loads to prevent duplicate requests
  const batchLoadingSetRef = useRef<Set<string>>(new Set());

  // Load a single URL; updates counters and optionally bumps version on batch end.
  const loadUrl = useCallback((url: string, onBatchComplete?: () => void) => {
    if (imageMapRef.current.has(url)) {
      // Already cached — count it immediately.
      loadedCountRef.current++;
      onBatchComplete?.();
      return;
    }

    if (batchLoadingSetRef.current.has(url)) {
      // Already in-flight — count it but don't create another Image
      loadedCountRef.current++;
      onBatchComplete?.();
      return;
    }

    batchLoadingSetRef.current.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const finish = () => {
      batchLoadingSetRef.current.delete(url);
      loadedCountRef.current++;
      onBatchComplete?.();
    };

    img.onload = () => {
      imageMapRef.current.set(url, img);
      finish();
    };
    img.onerror = () => {
      // Don't cache failed images so a future retry is possible.
      finish();
    };

    img.src = url;
  }, []);

  useEffect(() => {
    if (urls.length === 0) return;

    const map = imageMapRef.current;
    const newUrls = urls.filter((url) => !map.has(url));

    if (newUrls.length === 0) {
      // Everything is already cached; mark initial batch done if not yet.
      if (!initialBatchDoneRef.current) {
        initialBatchDoneRef.current = true;
        setVersion((v) => v + 1);
      }
      return;
    }

    // Update the total to cover newly discovered URLs.
    totalCountRef.current = urls.length;

    let batchFinished = 0;
    const batchSize = newUrls.length;

    const onBatchComplete = () => {
      batchFinished++;
      if (batchFinished >= batchSize) {
        // All images in this batch have resolved — trigger one re-render.
        if (!initialBatchDoneRef.current) {
          initialBatchDoneRef.current = true;
        }
        setVersion((v) => v + 1);
      }
    };

    for (const url of newUrls) {
      loadUrl(url, onBatchComplete);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, loadUrl]);

  // Track in-flight loads to prevent duplicate requests
  const loadingSetRef = useRef<Set<string>>(new Set());

  /**
   * Returns the cached HTMLImageElement for a URL, or null if not yet loaded.
   * If the URL is unknown, kicks off a lazy load and returns null immediately.
   * The next batch-complete event will cause a re-render so callers pick it up.
   */
  const getImage = useCallback(
    (url: string): HTMLImageElement | null => {
      const cached = imageMapRef.current.get(url);
      if (cached) return cached;

      // Already loading — don't create another Image
      if (loadingSetRef.current.has(url)) return null;

      // Lazy Phase 3 load — not part of any pre-known batch.
      loadingSetRef.current.add(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageMapRef.current.set(url, img);
        loadingSetRef.current.delete(url);
        setVersion((v) => v + 1);
      };
      img.onerror = () => {
        loadingSetRef.current.delete(url);
      };
      img.src = url;

      return null;
    },
    // version is intentionally not a dep; getImage is stable, re-renders happen via version state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const total = totalCountRef.current || urls.length;
  const loaded = loadedCountRef.current;

  return {
    getImage,
    isReady: initialBatchDoneRef.current,
    // Avoid divide-by-zero; treat zero-URL situation as fully ready.
    progress: total > 0 ? Math.min(loaded / total, 1) : 1,
  };
}
