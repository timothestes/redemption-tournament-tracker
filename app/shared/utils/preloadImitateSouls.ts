import { IMITATE_SOUL_IMAGES } from '@/lib/cards/cardAbilities';

// Idempotent. Browser dedups identical img.src loads, but we also guard
// at the module level so we only create the Image() objects once per session.
let warmed = false;
const cache: HTMLImageElement[] = [];

/**
 * Eagerly fetch every image in IMITATE_SOUL_IMAGES into the browser cache.
 *
 * The Imitate ability swaps a card's cardImgFile to a new path at reducer
 * time; Konva then has to fetch that path before the swap actually appears.
 * On a cold cache that's a visible 1s flash of the fallback card back.
 * Call this once the moment an Imitate Lost Soul appears in play — by the
 * time the user finishes navigating the menu and clicking a target, the
 * cache is warm and the swap is instant.
 *
 * Safe to call on every state change; the `warmed` flag short-circuits
 * subsequent calls. No-op on the server.
 */
export function preloadImitateSouls(): void {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  for (const url of Object.values(IMITATE_SOUL_IMAGES)) {
    const img = new window.Image();
    img.src = url;
    // Hold a reference so the browser doesn't garbage-collect the Image
    // (and the underlying decoded bitmap) before we need it.
    cache.push(img);
  }
}
