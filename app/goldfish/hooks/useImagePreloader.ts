'use client';

import { useState, useEffect, useRef } from 'react';

export function useImagePreloader(urls: string[]): {
  imageMap: Map<string, HTMLImageElement>;
  isReady: boolean;
  progress: number;
} {
  const [imageMap] = useState(() => new Map<string, HTMLImageElement>());
  const [loaded, setLoaded] = useState(0);
  const total = urls.length;
  const loadedRef = useRef(0);

  useEffect(() => {
    if (total === 0) {
      setLoaded(0);
      return;
    }

    let mounted = true;
    loadedRef.current = 0;

    urls.forEach((url) => {
      if (imageMap.has(url)) {
        loadedRef.current++;
        if (mounted) setLoaded(loadedRef.current);
        return;
      }
      const img = new Image();
      img.onload = () => {
        imageMap.set(url, img);
        loadedRef.current++;
        if (mounted) setLoaded(loadedRef.current);
      };
      img.onerror = () => {
        loadedRef.current++;
        if (mounted) setLoaded(loadedRef.current);
      };
      img.crossOrigin = 'anonymous';
      img.src = url;
    });

    return () => {
      mounted = false;
    };
  }, [urls, imageMap, total]);

  return {
    imageMap,
    isReady: total === 0 || loaded >= total,
    progress: total > 0 ? loaded / total : 1,
  };
}
