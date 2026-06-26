/**
 * Card image URL strategies.
 * 'local'  - Serve from /public/card-images/ (after running download script)
 * 'proxy'  - Use Next.js API proxy with caching
 * 'direct' - Direct from GitHub (original, slower)
 * 'blob'   - Vercel Blob CDN (fast, no GitHub dependency)
 */
const STRATEGY = 'blob' as 'local' | 'proxy' | 'direct' | 'blob';

/**
 * Pure mapping from a card's `imgFile` to its public image URL.
 * Extracted from the hook so non-hook code (e.g. the deck builder config seam)
 * can build the same URL. Returns identical output to the old hook.
 */
export function getPublicImageUrl(imgFile: string): string {
  // Sanitize imgFile to avoid duplicate extensions
  const sanitizedImgFile = imgFile.replace(/\.jpe?g$/i, "");

  switch (STRATEGY) {
    case 'local':
      return `/card-images/${sanitizedImgFile}.jpg`;
    case 'proxy':
      return `/api/card-image/${sanitizedImgFile}.jpg`;
    case 'blob':
      return `${process.env.NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${sanitizedImgFile}.jpg`;
    case 'direct':
      return `https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/${sanitizedImgFile}.jpg`;
    default:
      return `https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/${sanitizedImgFile}.jpg`;
  }
}

/**
 * Hook to manage card image URLs. Thin wrapper around `getPublicImageUrl` kept
 * for the existing call sites; behavior is unchanged.
 */
export function useCardImageUrl() {
  return { getImageUrl: getPublicImageUrl, strategy: STRATEGY };
}
